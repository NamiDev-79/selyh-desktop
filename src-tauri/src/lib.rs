//! Agente de escritorio de Selyh: vive en la bandeja del sistema y aparece solo en pausas naturales.

mod activity;
mod api;
mod auth;
mod commands;
mod config;
mod icon;
mod keychain;
mod scheduler;
mod sensor;
mod state;
mod sync;
mod tray;
mod windows;

use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Una sola instancia: abrir el agente otra vez muestra el panel en vez de duplicarlo.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let state = app.state::<state::AppState>();
            let _ = if state.onboarded() { windows::show_dashboard(app) } else { windows::show_onboarding(app) };
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let mut dir = app.path().app_data_dir()?;
            if let Some(p) = config::profile() {
                dir.push(format!("profile-{p}"));
            }
            let store = sync::Store::open(&dir).map_err(|e| format!("No se pudo abrir la base local: {e}"))?;
            app.manage(state::AppState { api: api::Api::new(config::api_url()), store, rt: Mutex::new(state::Runtime::default()) });

            tray::build(app.handle())?;
            scheduler::spawn(app.handle().clone());
            sensor::spawn(app.handle().clone());

            // Primer arranque (o sesión cerrada): bienvenida. Si no, el agente arranca invisible.
            let state = app.state::<state::AppState>();
            let linked = tauri::async_runtime::block_on(state.api.linked());
            if !linked || !state.onboarded() {
                windows::show_onboarding(app.handle())?;
            }
            tray::refresh(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_status,
            commands::pairing_start,
            commands::finish_onboarding,
            commands::logout,
            commands::submit_checkin,
            commands::open_checkin,
            commands::dismiss_checkin,
            commands::close_checkin,
            commands::local_checkins,
            commands::sync_now,
            commands::get_analytics,
            commands::get_consent,
            commands::sleep_prompt,
            commands::log_sleep,
            commands::set_consent,
            commands::get_preferences,
            commands::patch_preferences,
            commands::set_autostart,
            commands::pause,
            commands::open_web,
            commands::take_dashboard_tab,
            commands::scale_batch,
            commands::scale_answer,
            commands::scale_complete,
            commands::scale_later,
            commands::open_scale,
            commands::open_exercise,
            commands::exercise_current,
            commands::exercise_respond,
            commands::exercise_feedback,
            commands::close_floating,
            commands::signals_overview,
            commands::set_work_hours,
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar Selyh")
        .run(|_app, event| {
            // Cerrar todas las ventanas no cierra el agente: sigue en la bandeja.
            if let RunEvent::ExitRequested { api, code: None, .. } = event {
                api.prevent_exit();
            }
        });
}
