use chrono::{DateTime, Local};
use std::sync::Mutex;

use crate::{api::Api, sync::Store};

/// Estado compartido entre comandos, bandeja y programador.
pub struct AppState {
    pub api: Api,
    pub store: Store,
    pub rt: Mutex<Runtime>,
}

#[derive(Default)]
pub struct Runtime {
    /// Hay un check-in pendiente según /prompts/next (punto en la bandeja).
    pub checkin_due: bool,
    /// Copia local de la preferencia de modo foco (para la bandeja).
    pub focus_mode: bool,
    /// Pestaña que debe abrir el panel la próxima vez que se muestre.
    pub dashboard_tab: Option<String>,
    /// Permiso DESKTOP vigente: sin él el sensor no calcula nada.
    pub desktop_consent: bool,
    /// Tanda de escala sugerida por /prompts/next (código), si hay.
    pub scale_due: Option<String>,
    /// Sugerencia de ejercicio en curso (la última de POST /interventions/suggestions/next).
    pub suggestion: Option<serde_json::Value>,
}

impl AppState {
    pub fn rt(&self) -> std::sync::MutexGuard<'_, Runtime> {
        self.rt.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn paused_until(&self) -> Option<DateTime<Local>> {
        let raw = self.store.get("paused_until")?;
        let at = DateTime::parse_from_rfc3339(&raw).ok()?.with_timezone(&Local);
        (at > Local::now()).then_some(at)
    }

    pub fn pause_until(&self, at: Option<DateTime<Local>>) {
        match at {
            Some(t) => self.store.set("paused_until", &t.to_rfc3339()),
            None => self.store.del("paused_until"),
        }
    }

    pub fn onboarded(&self) -> bool {
        self.store.get("onboarded").is_some()
    }
}
