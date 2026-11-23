//! Icono y menú de la bandeja del sistema.

use chrono::{Duration, Local, NaiveTime};
use reqwest::Method;
use serde_json::json;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Wry,
};
use tauri_plugin_opener::OpenerExt;

use crate::{config, icon, state::AppState, windows};

pub struct TrayHandles {
    focus: CheckMenuItem<Wry>,
    resume: MenuItem<Wry>,
    scale: MenuItem<Wry>,
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let checkin = MenuItem::with_id(app, "checkin", "Hacer check-in ahora", true, None::<&str>)?;
    let scale = MenuItem::with_id(app, "scale", "Responder la escala de hoy", false, None::<&str>)?;
    let exercise = MenuItem::with_id(app, "exercise", "Una pausa guiada ahora", true, None::<&str>)?;
    let pause_1h = MenuItem::with_id(app, "pause_1h", "1 hora", true, None::<&str>)?;
    let pause_tomorrow = MenuItem::with_id(app, "pause_tomorrow", "Hasta mañana", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Reanudar", false, None::<&str>)?;
    let pause = Submenu::with_items(app, "Pausar el agente", true, &[&pause_1h, &pause_tomorrow, &resume])?;
    let focus = CheckMenuItem::with_id(app, "focus", "Modo foco", true, false, None::<&str>)?;
    let panel = MenuItem::with_id(app, "panel", "Ver mi panel en la web", true, None::<&str>)?;
    let today = MenuItem::with_id(app, "today", "Hoy y últimos check-ins", true, None::<&str>)?;
    let sent = MenuItem::with_id(app, "transparency", "Qué se está enviando", true, None::<&str>)?;
    let prefs = MenuItem::with_id(app, "preferences", "Preferencias", true, None::<&str>)?;
    let logout = MenuItem::with_id(app, "logout", "Cerrar sesión", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir de Selyh", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);

    let menu = Menu::with_items(app, &[&checkin, &scale, &exercise, &sep()?, &pause, &focus, &sep()?, &today, &sent, &prefs, &panel, &sep()?, &logout, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(icon::tray(false))
        .tooltip("Selyh")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .build(app)?;

    app.manage(TrayHandles { focus, resume, scale });
    Ok(())
}

/// Actualiza icono, texto de ayuda y menú según el estado actual.
pub fn refresh(app: &AppHandle) {
    let state = app.state::<AppState>();
    let paused = state.paused_until();
    let (due, focus, scale) = {
        let rt = state.rt();
        (rt.checkin_due, rt.focus_mode, rt.scale_due.is_some())
    };
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_icon(Some(icon::tray(due && paused.is_none())));
        let tip = match paused {
            Some(t) => format!("Selyh · en pausa hasta las {}", t.format("%H:%M")),
            None if due => "Selyh · ¿Cómo vas? Tienes un check-in pendiente".into(),
            None => "Selyh".into(),
        };
        let _ = tray.set_tooltip(Some(tip));
    }
    let h = app.state::<TrayHandles>();
    let _ = h.focus.set_checked(focus);
    let _ = h.resume.set_enabled(paused.is_some());
    let _ = h.scale.set_enabled(scale);
}

fn open_dashboard(app: &AppHandle, tab: &str) {
    app.state::<AppState>().rt().dashboard_tab = Some(tab.to_owned());
    let _ = windows::show_dashboard(app);
    let _ = app.emit_to("dashboard", "dashboard-tab", tab);
}

fn on_menu(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    // Sin vinculación, cualquier opción (salvo salir) lleva a la bienvenida.
    if id != "quit" && !state.onboarded() {
        let _ = windows::show_onboarding(app);
        return;
    }
    match id {
        "checkin" => {
            let _ = windows::show_checkin(app);
        }
        "scale" => {
            let _ = windows::show_scale(app);
        }
        "exercise" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let opened = crate::commands::request_suggestion(&app, true).await.is_ok_and(|v| !v["suggestion"].is_null());
                // Sin sugerencia disponible (tope diario, sin contenido): se explica en el panel.
                if opened {
                    let _ = windows::show_exercise(&app);
                } else {
                    open_dashboard(&app, "today");
                }
            });
        }
        "pause_1h" => {
            state.pause_until(Some(Local::now() + Duration::hours(1)));
            windows::close_floating(app);
            refresh(app);
        }
        "pause_tomorrow" => {
            let tomorrow = (Local::now() + Duration::days(1)).date_naive().and_time(NaiveTime::from_hms_opt(8, 0, 0).unwrap_or_default());
            state.pause_until(tomorrow.and_local_timezone(Local).single());
            windows::close_floating(app);
            refresh(app);
        }
        "resume" => {
            state.pause_until(None);
            refresh(app);
        }
        "focus" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<AppState>();
                let next = !state.rt().focus_mode;
                if state.api.call(Method::PATCH, "/preferences", Some(&json!({ "focusMode": next }))).await.is_ok() {
                    state.rt().focus_mode = next;
                }
                refresh(&app); // si falló, vuelve a mostrar el valor real
            });
        }
        "panel" => {
            let _ = app.opener().open_url(format!("{}/panel", config::web_url()), None::<&str>);
        }
        "today" => open_dashboard(app, "today"),
        "transparency" => open_dashboard(app, "transparency"),
        "preferences" => open_dashboard(app, "preferences"),
        "logout" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { crate::commands::sign_out(&app).await });
        }
        "quit" => app.exit(0),
        _ => {}
    }
}
