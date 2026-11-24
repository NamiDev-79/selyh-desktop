//! Comandos que la interfaz puede invocar. Solo exponen lo que cada ventana necesita:
//! la interfaz nunca recibe tokens ni puede llamar rutas arbitrarias de la API.

use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;

use crate::{
    activity,
    api::ApiError,
    sensor::{self, WorkHours},
    auth::{self, PairingStart},
    config, scheduler,
    state::AppState,
    sync::{self, LocalCheckin},
    tray, windows,
};

type R<T> = Result<T, ApiError>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    linked: bool,
    onboarded: bool,
    user_name: Option<String>,
    pending: i64,
    paused_until: Option<String>,
    autostart: bool,
    web_url: String,
    passive_signals: bool,
    idle_detection: bool,
}

#[tauri::command]
pub async fn app_status(app: AppHandle, state: State<'_, AppState>) -> R<Status> {
    Ok(Status {
        linked: state.api.linked().await,
        onboarded: state.onboarded(),
        user_name: state.api.user_name().await,
        pending: state.store.pending_count(),
        paused_until: state.paused_until().map(|t| t.to_rfc3339()),
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        web_url: config::web_url(),
        passive_signals: state.rt().desktop_consent,
        idle_detection: crate::activity::idle_seconds().is_some(),
    })
}

// ───── vinculación y bienvenida ─────

#[tauri::command]
pub async fn pairing_start(app: AppHandle) -> R<PairingStart> {
    auth::start(app).await
}

#[tauri::command]
pub async fn finish_onboarding(app: AppHandle, state: State<'_, AppState>) -> R<()> {
    state.store.set("onboarded", "1");
    if let Some(w) = app.get_webview_window("onboarding") {
        let _ = w.destroy();
    }
    tray::refresh(&app);
    Ok(())
}

/// Cierra la sesión, borra el llavero y la cola local, y vuelve a la bienvenida.
pub async fn sign_out(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.api.logout().await;
    state.store.wipe();
    windows::close_floating(app);
    if let Some(w) = app.get_webview_window("dashboard") {
        let _ = w.destroy();
    }
    let _ = windows::show_onboarding(app);
    tray::refresh(app);
}

#[tauri::command]
pub async fn logout(app: AppHandle) -> R<()> {
    sign_out(&app).await;
    Ok(())
}

// ───── check-in ─────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckinResult {
    checkin: LocalCheckin,
    /// true si ya llegó al servidor; false si quedó en la cola local.
    synced: bool,
    waiting_consent: bool,
}

const TAGS: [&str; 6] = ["meeting", "bug", "deadline", "oncall", "review", "other"];

#[tauri::command]
pub async fn submit_checkin(app: AppHandle, state: State<'_, AppState>, score: u8, tag: Option<String>) -> R<CheckinResult> {
    if !(1..=5).contains(&score) || tag.as_deref().is_some_and(|t| !TAGS.contains(&t)) {
        return Err(ApiError::Http { status: 400, code: Some("INVALID".into()), message: "Check-in inválido".into() });
    }
    let checkin = state.store.enqueue(score, tag.as_deref()).map_err(|e| ApiError::Network(e.to_string()))?;
    scheduler::snooze(&app);
    // Se intenta enviar al momento; si no hay red, queda en la cola y se reintenta solo.
    let report = sync::flush(&state.api, &state.store).await.unwrap_or_default();
    let synced = state.store.recent(20).iter().any(|c| c.client_id == checkin.client_id && c.status == "synced");
    Ok(CheckinResult { checkin, synced, waiting_consent: report.waiting_consent > 0 })
}

// Asíncrono a propósito: en Windows, crear una ventana desde un comando síncrono la bloquea.
#[tauri::command]
pub async fn open_checkin(app: AppHandle) -> Result<(), String> {
    windows::show_checkin(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dismiss_checkin(app: AppHandle) {
    scheduler::snooze(&app);
    windows::close_checkin(&app);
}

#[tauri::command]
pub fn close_checkin(app: AppHandle) {
    windows::close_checkin(&app);
}

#[tauri::command]
pub fn local_checkins(state: State<'_, AppState>) -> Vec<LocalCheckin> {
    state.store.recent(30)
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> R<sync::FlushReport> {
    sync::flush(&state.api, &state.store).await
}

// ───── datos del servidor que muestran las ventanas ─────

#[tauri::command]
pub async fn get_analytics(state: State<'_, AppState>) -> R<Value> {
    state.api.call(Method::GET, "/analytics/me", None).await
}

fn valid_date(d: &str) -> bool {
    d.len() == 10 && d.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() })
}

/// ¿Preguntar hoy cómo dormiste? Solo con el permiso SLEEP y si aún no se registró hoy en ningún dispositivo.
/// `date` es el día local (AAAA-MM-DD) en que te despertaste.
#[tauri::command]
pub async fn sleep_prompt(state: State<'_, AppState>, date: String) -> R<bool> {
    if !valid_date(&date) {
        return Ok(false);
    }
    let consent = state.api.call(Method::GET, "/consent", None).await?;
    let granted = consent.as_array().is_some_and(|a| a.iter().any(|r| r["dataSource"] == "SLEEP" && r["granted"] == true));
    if !granted {
        return Ok(false);
    }
    let rows = state.api.call(Method::GET, "/signals?days=2", None).await?;
    let done = rows.as_array().is_some_and(|a| a.iter().any(|r| r["sourceType"] == "SLEEP" && r["date"] == date.as_str()));
    Ok(!done)
}

/// Guarda cómo dormiste: calidad 1–5 y horas aproximadas (opcional).
#[tauri::command]
pub async fn log_sleep(state: State<'_, AppState>, date: String, quality: u8, hours: Option<f64>) -> R<Value> {
    if !valid_date(&date) || !(1..=5).contains(&quality) || hours.is_some_and(|h| !(0.0..=16.0).contains(&h)) {
        return Err(ApiError::Http { status: 400, code: Some("INVALID".into()), message: "Dato de sueño inválido".into() });
    }
    let mut metrics = json!({ "quality": quality });
    if let Some(h) = hours {
        metrics["hours"] = json!(h);
    }
    state.api.call(Method::POST, "/signals", Some(&json!({ "date": date, "sourceType": "SLEEP", "metrics": metrics }))).await
}

#[tauri::command]
pub async fn get_consent(state: State<'_, AppState>) -> R<Value> {
    state.api.call(Method::GET, "/consent", None).await
}

const SOURCES: [&str; 7] = ["CHECKIN", "CALENDAR", "IDE_GIT", "WEARABLE", "BIOMETRIC", "DESKTOP", "SLEEP"];

#[tauri::command]
pub async fn set_consent(app: AppHandle, state: State<'_, AppState>, source: String, granted: bool) -> R<Value> {
    if !SOURCES.contains(&source.as_str()) {
        return Err(ApiError::Http { status: 400, code: Some("INVALID".into()), message: "Fuente desconocida".into() });
    }
    let v = state.api.call(Method::PUT, &format!("/consent/{source}"), Some(&json!({ "granted": granted }))).await?;
    // Los check-ins que esperaban este permiso se envían ahora.
    if granted && source == "CHECKIN" {
        let _ = sync::flush(&state.api, &state.store).await;
        tray::refresh(&app);
    }
    // El sensor arranca o se detiene al instante; al revocar se borra lo que no se envió.
    if source == "DESKTOP" {
        state.rt().desktop_consent = granted;
        if !granted {
            state.store.drop_unsent_signals();
        }
    }
    Ok(v)
}

#[tauri::command]
pub async fn get_preferences(state: State<'_, AppState>) -> R<Value> {
    state.api.call(Method::GET, "/preferences", None).await
}

/// Solo se reenvían las claves que el agente maneja.
#[tauri::command]
pub async fn patch_preferences(app: AppHandle, state: State<'_, AppState>, patch: Value) -> R<Value> {
    const KEYS: [&str; 5] = ["reminderTimes", "quietHoursStart", "quietHoursEnd", "focusMode", "checkinReminders"];
    let body: serde_json::Map<String, Value> = patch.as_object().into_iter().flatten().filter(|(k, _)| KEYS.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect();
    let v = state.api.call(Method::PATCH, "/preferences", Some(&Value::Object(body))).await?;
    state.rt().focus_mode = v["focusMode"].as_bool().unwrap_or(false);
    tray::refresh(&app);
    Ok(v)
}

// ───── agente local ─────

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let l = app.autolaunch();
    if enabled { l.enable() } else { l.disable() }.map_err(|e| e.to_string())?;
    l.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pause(app: AppHandle, state: State<'_, AppState>, minutes: Option<i64>) {
    state.pause_until(minutes.map(|m| chrono::Local::now() + chrono::Duration::minutes(m)));
    tray::refresh(&app);
}

/// Abre una ruta de la web (por ejemplo `/panel` o `/device?code=…`) en el navegador.
#[tauri::command]
pub fn open_web(app: AppHandle, path: String) -> Result<(), String> {
    if !path.starts_with('/') || path.starts_with("//") {
        return Err("Ruta inválida".into());
    }
    app.opener().open_url(format!("{}{}", config::web_url(), path), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn take_dashboard_tab(state: State<'_, AppState>) -> Option<String> {
    state.rt().dashboard_tab.take()
}

// ───── escalas por partes ─────

fn valid_code(code: &str) -> R<()> {
    if !code.is_empty() && code.len() <= 12 && code.chars().all(|c| c.is_ascii_alphanumeric()) {
        Ok(())
    } else {
        Err(ApiError::Http { status: 400, code: Some("INVALID".into()), message: "Escala desconocida".into() })
    }
}

/// La tanda que toca ahora (`/prompts/next`) junto con el rango de respuestas de esa escala.
#[tauri::command]
pub async fn scale_batch(state: State<'_, AppState>) -> R<Value> {
    let prompt = state.api.call(Method::GET, "/prompts/next", None).await?;
    let scale = prompt["scale"].clone();
    if scale.is_null() {
        return Ok(json!({ "scale": null }));
    }
    let catalog = state.api.call(Method::GET, "/scales", None).await?;
    let meta = catalog.as_array().and_then(|a| a.iter().find(|s| s["code"] == scale["code"]).cloned()).unwrap_or(Value::Null);
    Ok(json!({ "scale": scale, "meta": meta }))
}

/// Guarda UNA respuesta al momento: así, si el ítem de seguridad del PHQ-9 es mayor que 0, la API
/// devuelve los recursos de ayuda en esta misma llamada y se muestran de inmediato.
#[tauri::command]
pub async fn scale_answer(state: State<'_, AppState>, code: String, index: u8, value: i64) -> R<Value> {
    valid_code(&code)?;
    let body = json!({ "answers": [{ "index": index, "value": value }] });
    state.api.call(Method::PUT, &format!("/scales/{code}/progress?region=PE"), Some(&body)).await
}

#[tauri::command]
pub async fn scale_complete(app: AppHandle, state: State<'_, AppState>, code: String) -> R<Value> {
    valid_code(&code)?;
    let v = state.api.call(Method::POST, &format!("/scales/{code}/progress/complete?region=PE"), Some(&json!({ "source": "desktop" }))).await?;
    state.rt().scale_due = None;
    tray::refresh(&app);
    Ok(v)
}

/// Marca la tanda de hoy como ofrecida: no vuelve a aparecer sola hasta mañana.
#[tauri::command]
pub fn scale_later(app: AppHandle, state: State<'_, AppState>) {
    state.store.set("scale_shown_date", &chrono::Local::now().date_naive().to_string());
    state.rt().scale_due = None;
    tray::refresh(&app);
    windows::close(&app, "scale");
}

#[tauri::command]
pub async fn open_scale(app: AppHandle) -> Result<(), String> {
    windows::show_scale(&app).map_err(|e| e.to_string())
}

// ───── micro-intervenciones ─────

/// Pide una sugerencia al servidor. `manual`: la persona la pidió (igual respeta el tope diario).
pub async fn request_suggestion(app: &AppHandle, manual: bool) -> R<Value> {
    let state = app.state::<AppState>();
    let path = format!("/interventions/suggestions/next?region=PE{}", if manual { "&manual=true" } else { "" });
    let v = state.api.call(Method::POST, &path, None).await?;
    state.rt().suggestion = (!v["suggestion"].is_null()).then(|| v["suggestion"].clone());
    Ok(v)
}

/// Abre el ejercicio si el servidor tiene uno para ahora; si no, devuelve el motivo.
#[tauri::command]
pub async fn open_exercise(app: AppHandle) -> R<Value> {
    let v = request_suggestion(&app, true).await?;
    let opened = !v["suggestion"].is_null();
    if opened {
        let _ = windows::show_exercise(&app);
    }
    Ok(json!({ "reason": v["reason"], "opened": opened }))
}

#[tauri::command]
pub fn exercise_current(state: State<'_, AppState>) -> Option<Value> {
    state.rt().suggestion.clone()
}

#[tauri::command]
pub async fn exercise_respond(state: State<'_, AppState>, id: String, response: String) -> R<Value> {
    if !["ACCEPTED", "POSTPONED", "DISMISSED"].contains(&response.as_str()) || uuid::Uuid::parse_str(&id).is_err() {
        return Err(ApiError::Http { status: 400, code: Some("INVALID".into()), message: "Respuesta inválida".into() });
    }
    state.api.call(Method::POST, &format!("/interventions/suggestions/{id}/respond"), Some(&json!({ "response": response }))).await
}

#[tauri::command]
pub async fn exercise_feedback(state: State<'_, AppState>, id: String, helpful: bool) -> R<Value> {
    if uuid::Uuid::parse_str(&id).is_err() {
        return Err(ApiError::Http { status: 400, code: Some("INVALID".into()), message: "Sugerencia inválida".into() });
    }
    let feedback = if helpful { "HELPFUL" } else { "NOT_HELPFUL" };
    let v = state.api.call(Method::POST, &format!("/interventions/suggestions/{id}/feedback"), Some(&json!({ "feedback": feedback }))).await?;
    state.rt().suggestion = None;
    Ok(v)
}

#[tauri::command]
pub fn close_floating(app: AppHandle, label: String) {
    if windows::FLOATING.contains(&label.as_str()) {
        windows::close(&app, &label);
    }
}

// ───── sensor pasivo y transparencia ─────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayView {
    date: String,
    status: String,
    sent_at: Option<String>,
    metrics: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalsOverview {
    consent: bool,
    supported: bool,
    work_hours: WorkHours,
    /// Lo que lleva hoy (aún no se envió: se envía cuando el día termina).
    today: Option<DayView>,
    /// Días anteriores, con lo que se envió exactamente.
    days: Vec<DayView>,
}

#[tauri::command]
pub fn signals_overview(state: State<'_, AppState>) -> SignalsOverview {
    let today = chrono::Local::now().date_naive().to_string();
    let view = |d: &sensor::Day| DayView { date: d.date.clone(), status: d.status.clone(), sent_at: d.sent_at.clone(), metrics: d.metrics() };
    let all = state.store.recent_signal_days();
    SignalsOverview {
        consent: state.rt().desktop_consent,
        supported: activity::idle_seconds().is_some(),
        work_hours: WorkHours::load(&state),
        today: all.iter().find(|d| d.date == today).map(view),
        days: all.iter().filter(|d| d.date != today).map(view).collect(),
    }
}

#[tauri::command]
pub fn set_work_hours(state: State<'_, AppState>, hours: WorkHours) -> Result<WorkHours, String> {
    let ok = |s: &str| chrono::NaiveTime::parse_from_str(s, "%H:%M").is_ok();
    if !ok(&hours.start) || !ok(&hours.end) {
        return Err("Hora inválida".into());
    }
    state.store.set("work_hours", &serde_json::to_string(&hours).map_err(|e| e.to_string())?);
    Ok(hours)
}
