//! Sensor pasivo (opcional, apagado hasta que la persona dé el permiso DESKTOP).
//!
//! Cada 15 segundos mira SOLO cuántos segundos pasaron desde la última entrada de teclado o ratón y
//! acumula, en el propio equipo, un resumen del día: horas activas, trabajo fuera de horario, pausas,
//! sesión continua más larga e inicio y fin de la jornada. Nunca teclas, ventanas, apps ni archivos.
//! Al servidor solo llega el resumen de los días ya cerrados, una vez al día.

use chrono::{Datelike, Local, NaiveTime, Timelike, Weekday};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::{activity, state::AppState};

const SAMPLE: Duration = Duration::from_secs(15);
/// Un hueco sin actividad de al menos esto cuenta como pausa (y corta la sesión continua).
pub const BREAK_SECS: f64 = 5.0 * 60.0;
/// Si entre dos muestras pasó más que esto (suspensión, hibernación), ese tramo no se cuenta.
const MAX_STEP: f64 = 90.0;

/// Resumen local de un día. Los campos `cur_*` y `gap_secs` son estado interno y no se envían.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub date: String,
    pub active_secs: f64,
    pub after_hours_secs: f64,
    pub breaks: i64,
    pub break_secs: f64,
    pub longest_session_secs: f64,
    pub cur_session_secs: f64,
    pub gap_secs: f64,
    pub first_min: Option<i64>,
    pub last_min: Option<i64>,
    /// open (hoy) | pending (cerrado, por enviar) | sent | rejected
    pub status: String,
    pub sent_at: Option<String>,
}

impl Day {
    /// Los índices que se envían. Mismas claves que usa el estimado del servidor (`desktop.*`).
    pub fn metrics(&self) -> Value {
        let mut m = json!({
            "hoursActive": (self.active_secs / 36.0).round() / 100.0,
            "afterHoursMinutes": (self.after_hours_secs / 60.0).round(),
            "breaks": self.breaks,
            "breakMinutes": (self.break_secs / 60.0).round(),
            "longestSessionMinutes": (self.longest_session_secs.max(self.cur_session_secs) / 60.0).round(),
        });
        if let (Some(f), Some(l)) = (self.first_min, self.last_min) {
            m["firstActivityMinute"] = json!(f);
            m["lastActivityMinute"] = json!(l);
        }
        m
    }

    /// Avanza `dt` segundos. `active`: hubo teclado o ratón en ese tramo.
    fn step(&mut self, dt: f64, active: bool, after_hours: bool, minute_of_day: i64) {
        if !active {
            self.gap_secs += dt;
            return;
        }
        if self.first_min.is_some() && self.gap_secs >= BREAK_SECS {
            self.breaks += 1;
            self.break_secs += self.gap_secs;
            self.cur_session_secs = 0.0;
        }
        self.gap_secs = 0.0;
        self.active_secs += dt;
        self.cur_session_secs += dt;
        self.longest_session_secs = self.longest_session_secs.max(self.cur_session_secs);
        if after_hours {
            self.after_hours_secs += dt;
        }
        self.first_min.get_or_insert(minute_of_day);
        self.last_min = Some(minute_of_day);
    }
}

/// Horario laboral local (solo vive en el equipo; sirve para separar el trabajo fuera de horario).
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkHours {
    pub start: String,
    pub end: String,
    pub weekends: bool,
}

impl Default for WorkHours {
    fn default() -> Self {
        Self { start: "09:00".into(), end: "18:00".into(), weekends: false }
    }
}

impl WorkHours {
    pub fn load(state: &AppState) -> Self {
        state.store.get("work_hours").and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    fn is_after_hours(&self, now: chrono::DateTime<Local>) -> bool {
        let weekend = matches!(now.weekday(), Weekday::Sat | Weekday::Sun);
        if weekend && !self.weekends {
            return true;
        }
        let parse = |s: &str| NaiveTime::parse_from_str(s, "%H:%M").ok();
        let (Some(a), Some(b)) = (parse(&self.start), parse(&self.end)) else { return false };
        let t = now.time();
        if a <= b {
            t < a || t >= b
        } else {
            t >= b && t < a // horario que cruza la medianoche
        }
    }
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last = Instant::now();
        loop {
            tokio::time::sleep(SAMPLE).await;
            let dt = last.elapsed().as_secs_f64();
            last = Instant::now();
            sample(&app, dt);
        }
    });
}

fn sample(app: &AppHandle, dt: f64) {
    let state = app.state::<AppState>();
    if !state.rt().desktop_consent || state.paused_until().is_some() || dt > MAX_STEP {
        return;
    }
    let Some(idle) = activity::idle_seconds() else { return };
    let now = Local::now();
    let date = now.date_naive().to_string();
    let mut day = state.store.signal_day(&date).unwrap_or_else(|| Day { date: date.clone(), status: "open".into(), ..Default::default() });
    let active = (idle as f64) < dt;
    let minute = i64::from(now.hour() * 60 + now.minute());
    day.step(dt, active, WorkHours::load(&state).is_after_hours(now), minute);
    state.store.save_signal_day(&day);
    // Los días anteriores que quedaron abiertos pasan a "por enviar".
    state.store.close_signal_days_before(&date);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuenta_pausas_y_sesion_continua() {
        let mut d = Day::default();
        for _ in 0..8 {
            d.step(15.0, true, false, 600); // 2 min activos
        }
        for _ in 0..24 {
            d.step(15.0, false, false, 602); // 6 min sin actividad: pausa
        }
        for _ in 0..4 {
            d.step(15.0, true, true, 608); // 1 min activo fuera de horario
        }
        assert_eq!(d.breaks, 1);
        assert_eq!(d.active_secs, 180.0);
        assert_eq!(d.after_hours_secs, 60.0);
        assert_eq!(d.longest_session_secs, 120.0);
        assert_eq!(d.metrics()["breakMinutes"], json!(6.0));
        assert_eq!(d.first_min, Some(600));
    }

    #[test]
    fn huecos_cortos_no_son_pausas() {
        let mut d = Day::default();
        d.step(15.0, true, false, 0);
        for _ in 0..10 {
            d.step(15.0, false, false, 0); // 2,5 min: no llega a pausa
        }
        d.step(15.0, true, false, 3);
        assert_eq!(d.breaks, 0);
        assert_eq!(d.cur_session_secs, 30.0);
    }
}
