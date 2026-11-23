//! Vinculación con código (flujo de dispositivo). Nadie escribe su contraseña en el agente:
//! el agente muestra un código, la persona lo aprueba en la web y el agente recibe sus tokens.

use reqwest::Method;
use serde::Serialize;
use serde_json::json;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::{api::ApiError, keychain::Credentials, state::AppState};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PairingStart {
    pub user_code: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
}

/// Estado que recibe la ventana de bienvenida por el evento `pairing`.
#[derive(Serialize, Clone)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PairingEvent {
    Approved { name: String },
    Denied,
    Expired,
    Error { message: String },
}

fn device_name() -> String {
    let host = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default();
    let os = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        other => other,
    };
    let name = if host.is_empty() { format!("Escritorio {os}") } else { format!("{host} ({os})") };
    name.chars().take(60).collect()
}

pub async fn start(app: AppHandle) -> Result<PairingStart, ApiError> {
    let state = app.state::<AppState>();
    let v = state
        .api
        .public(Method::POST, "/auth/device/start", Some(&json!({ "platform": "desktop-tauri", "deviceName": device_name() })))
        .await?;
    let device_code = v["deviceCode"].as_str().unwrap_or_default().to_owned();
    let interval = v["interval"].as_u64().unwrap_or(5).max(2);
    let expires_in = v["expiresIn"].as_u64().unwrap_or(600);
    let start = PairingStart {
        user_code: v["userCode"].as_str().unwrap_or_default().to_owned(),
        verification_uri_complete: v["verificationUriComplete"].as_str().unwrap_or_default().to_owned(),
        expires_in,
    };
    state.store.set("pairing_code", &device_code);
    tauri::async_runtime::spawn(poll(app.clone(), device_code, interval, expires_in));
    Ok(start)
}

/// Consulta cada `interval` segundos hasta que la persona aprueba, rechaza o vence el código.
async fn poll(app: AppHandle, device_code: String, mut interval: u64, expires_in: u64) {
    let state = app.state::<AppState>();
    let deadline = std::time::Instant::now() + Duration::from_secs(expires_in);
    let event = loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if std::time::Instant::now() > deadline {
            break PairingEvent::Expired;
        }
        // Si se pidió otro código, este sondeo deja de importar.
        if state.store.get("pairing_code").as_deref() != Some(device_code.as_str()) {
            return;
        }
        match state.api.public(Method::POST, "/auth/device/token", Some(&json!({ "deviceCode": device_code }))).await {
            Ok(v) => {
                let creds = Credentials {
                    access_token: v["accessToken"].as_str().unwrap_or_default().to_owned(),
                    refresh_token: v["refreshToken"].as_str().unwrap_or_default().to_owned(),
                    device_id: v["deviceId"].as_str().unwrap_or_default().to_owned(),
                    user_name: v["user"]["name"].as_str().unwrap_or_default().to_owned(),
                };
                let name = creds.user_name.clone();
                match state.api.set_session(creds).await {
                    Ok(()) => {
                        register_device(&app).await;
                        break PairingEvent::Approved { name };
                    }
                    Err(e) => break PairingEvent::Error { message: format!("No se pudo guardar la sesión en el llavero: {e}") },
                }
            }
            Err(e) => match e.code() {
                Some("authorization_pending") => continue,
                Some("slow_down") => interval += 5,
                Some("access_denied") => break PairingEvent::Denied,
                Some("expired_token") | Some("invalid_device_code") => break PairingEvent::Expired,
                _ if matches!(e, ApiError::Network(_)) => continue, // sin red: se reintenta
                _ => break PairingEvent::Error { message: e.to_string() },
            },
        }
    };
    state.store.del("pairing_code");
    let _ = app.emit("pairing", event);
}

/// Nombre y versión del agente en la lista de dispositivos de la web.
async fn register_device(app: &AppHandle) {
    let state = app.state::<AppState>();
    if let Some(id) = state.api.device_id().await {
        let body = json!({ "name": device_name(), "appVersion": crate::config::APP_VERSION });
        let _ = state.api.call(Method::PATCH, &format!("/devices/{id}"), Some(&body)).await;
    }
}

