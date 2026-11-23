//! Sesión guardada en el llavero del sistema (Credential Manager, Keychain o Secret Service).
//! Nunca en archivos planos. Se guarda todo en una sola entrada para que cada rotación sea atómica.

use serde::{Deserialize, Serialize};

const SERVICE: &str = "app.selyh.agent";

#[derive(Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub access_token: String,
    pub refresh_token: String,
    pub device_id: String,
    pub user_name: String,
}

fn entry() -> keyring::Result<keyring::Entry> {
    let account = crate::config::profile().map_or_else(|| "session".to_owned(), |p| format!("session-{p}"));
    keyring::Entry::new(SERVICE, &account)
}

pub fn load() -> Option<Credentials> {
    let raw = entry().ok()?.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn save(c: &Credentials) -> Result<(), String> {
    let raw = serde_json::to_string(c).map_err(|e| e.to_string())?;
    entry().and_then(|e| e.set_password(&raw)).map_err(|e| e.to_string())
}

pub fn clear() {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
}
