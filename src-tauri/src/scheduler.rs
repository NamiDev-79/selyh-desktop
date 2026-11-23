//! Decide cuándo mostrar algo: en una pausa natural (volver tras unos minutos sin usar el equipo)
//! y, solo para el check-in y fuera del modo foco, de vez en cuando. El servidor (`GET /prompts/next`)
//! tiene la última palabra: horas de silencio, tope diario y si ya respondiste hoy.
//!
//! En cada pausa natural se muestra UNA cosa, en este orden: check-in, tanda de escala (máximo una
//! al día) o un ejercicio breve si el servidor lo sugiere (máximo uno cada 2 horas).
//! Nunca aparece mientras escribes, con una app en pantalla completa ni con "no molestar".

use chrono::{DateTime, Local};
use reqwest::Method;
use serde_json::Value;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::{activity, commands, state::AppState, sync, tray, windows};

const TICK: Duration = Duration::from_secs(20);
/// Tiempo sin actividad que cuenta como pausa real.
const BREAK_SECS: u64 = 5 * 60;
/// Tras volver de una pausa, la oportunidad de mostrar el check-in dura esto.
const BREAK_WINDOW: Duration = Duration::from_secs(3 * 60);
/// Segundos sin teclear antes de mostrar algo (nunca a mitad de una frase).
const LULL_SECS: u64 = 4;
/// Fuera del modo foco, cada cuánto se reconsidera mostrarlo aunque no haya pausa.
const PERIODIC: Duration = Duration::from_secs(45 * 60);
/// Si la persona no responde o lo cierra, no se insiste durante este tiempo.
const COOLDOWN_MIN: i64 = 120;
const PROMPT_TTL: Duration = Duration::from_secs(15 * 60);
const FLUSH_EVERY: Duration = Duration::from_secs(5 * 60);
/// Entre dos ejercicios propuestos por el agente (además del tope diario del servidor).
const EXERCISE_GAP_MIN: i64 = 120;

struct Clock {
    linked: bool,
    prev_idle: u64,
    break_ended: Option<Instant>,
    last_periodic: Instant,
    prompt: Option<(Instant, Value)>,
    last_flush: Option<Instant>,
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut c = Clock { linked: false, prev_idle: 0, break_ended: None, last_periodic: Instant::now(), prompt: None, last_flush: None };
        loop {
            tick(&app, &mut c).await;
            tokio::time::sleep(TICK).await;
        }
    });
}

/// El check-in recién enviado o cerrado: recalcular el aviso y no insistir por un rato.
pub fn snooze(app: &AppHandle) {
    let state = app.state::<AppState>();
    let until = Local::now() + chrono::Duration::minutes(COOLDOWN_MIN);
    state.store.set("cooldown_until", &until.to_rfc3339());
    state.rt().checkin_due = false;
    tray::refresh(app);
}

fn after(state: &AppState, key: &str) -> bool {
    state.store.get(key).and_then(|s| DateTime::parse_from_rfc3339(&s).ok()).is_some_and(|t| t > Local::now())
}

fn cooling_down(state: &AppState) -> bool {
    after(state, "cooldown_until")
}

fn today() -> String {
    Local::now().date_naive().to_string()
}

async fn tick(app: &AppHandle, c: &mut Clock) {
    let state = app.state::<AppState>();

    // La sesión pudo vencer (refresh rechazado): borrar lo local y volver a la bienvenida.
    let linked = state.api.linked().await;
    if c.linked && !linked {
        state.store.wipe();
        windows::close_floating(app);
        let _ = windows::show_onboarding(app);
        tray::refresh(app);
    }
    c.linked = linked;
    if !linked || !state.onboarded() {
        return;
    }

    // Cola offline: cada 5 minutos, o antes si hay algo pendiente.
    let pending = state.store.pending_count() > 0;
    if c.last_flush.is_none_or(|t| t.elapsed() >= if pending { TICK * 3 } else { FLUSH_EVERY }) {
        c.last_flush = Some(Instant::now());
        let _ = sync::flush(&state.api, &state.store).await;
    }

    if state.paused_until().is_some() {
        return;
    }

    // Pausa natural: estuvo inactivo al menos 5 minutos y acaba de volver.
    let idle = activity::idle_seconds();
    if let Some(now) = idle {
        if c.prev_idle >= BREAK_SECS && now < 60 {
            c.break_ended = Some(Instant::now());
        }
        c.prev_idle = now;
    }
    let after_break = c.break_ended.is_some_and(|t| t.elapsed() < BREAK_WINDOW);
    let periodic = c.last_periodic.elapsed() >= PERIODIC;

    // Preguntar al servidor qué toca (con caché).
    let stale = c.prompt.as_ref().is_none_or(|(t, _)| t.elapsed() >= PROMPT_TTL);
    if after_break || stale {
        if let Ok(v) = state.api.call(Method::GET, "/prompts/next", None).await {
            let shown_today = state.store.get("scale_shown_date").as_deref() == Some(today().as_str());
            {
                let mut rt = state.rt();
                rt.checkin_due = v["checkIn"]["due"].as_bool().unwrap_or(false) && !v["quiet"].as_bool().unwrap_or(false);
                rt.focus_mode = v["focusMode"].as_bool().unwrap_or(false);
                rt.scale_due = if shown_today { None } else { v["scale"]["code"].as_str().map(str::to_owned) };
            }
            c.prompt = Some((Instant::now(), v));
            tray::refresh(app);
        }
        // El permiso del sensor pudo cambiar desde la web.
        if let Ok(consent) = state.api.call(Method::GET, "/consent", None).await {
            let granted = consent.as_array().is_some_and(|a| a.iter().any(|r| r["dataSource"] == "DESKTOP" && r["granted"] == true));
            let was = std::mem::replace(&mut state.rt().desktop_consent, granted);
            if was && !granted {
                state.store.drop_unsent_signals();
            }
        }
    }
    let Some((_, prompt)) = &c.prompt else { return };

    let (due, focus, scale_due) = {
        let rt = state.rt();
        (rt.checkin_due, rt.focus_mode, rt.scale_due.clone())
    };
    let quiet = prompt["quiet"].as_bool().unwrap_or(false);
    let checkin_now = due && !cooling_down(&state) && (after_break || (periodic && !focus));
    let scale_now = !checkin_now && after_break && scale_due.is_some();
    let exercise_now = !checkin_now && !scale_now && after_break && !after(&state, "exercise_after");
    if quiet || windows::floating_open(app) || !(checkin_now || scale_now || exercise_now) {
        if periodic && !after_break {
            c.last_periodic = Instant::now();
        }
        return;
    }
    // Esperar un respiro en el tecleo y no aparecer con pantalla completa o "no molestar".
    if activity::busy() || idle.is_some_and(|s| s < LULL_SECS) {
        return; // se reintenta en el siguiente tick
    }
    c.break_ended = None;
    c.last_periodic = Instant::now();

    if checkin_now {
        if windows::show_checkin(app).is_ok() {
            snooze(app);
            state.rt().checkin_due = true; // el punto sigue hasta que se responda
            tray::refresh(app);
        }
    } else if scale_now {
        // Una tanda al día como máximo, se responda o no.
        state.store.set("scale_shown_date", &today());
        state.rt().scale_due = None;
        let _ = windows::show_scale(app);
    } else if exercise_now {
        let next = Local::now() + chrono::Duration::minutes(EXERCISE_GAP_MIN);
        state.store.set("exercise_after", &next.to_rfc3339());
        // El servidor decide si hace falta (tendencia en aumento, tope diario, horas de silencio).
        if let Ok(v) = commands::request_suggestion(app, false).await {
            if !v["suggestion"].is_null() {
                let _ = windows::show_exercise(app);
            }
        }
    }
}
