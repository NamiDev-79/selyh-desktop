//! Ventanas del agente. Todas cargan la misma interfaz; React elige la vista según la etiqueta.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const MARGIN: f64 = 16.0;

/// Ventanas flotantes que aparecen solas (check-in, escala, ejercicio): una a la vez.
pub const FLOATING: [&str; 3] = ["checkin", "scale", "exercise"];

pub fn floating_open(app: &AppHandle) -> bool {
    FLOATING.iter().any(|l| app.get_webview_window(l).is_some())
}

/// Mini ventana flotante del check-in, en la esquina inferior derecha.
/// Se crea sin foco: nunca le roba el teclado a quien está trabajando.
pub fn show_checkin(app: &AppHandle) -> tauri::Result<()> {
    show_floating(app, "checkin", "Selyh · ¿Cómo vas?", (360.0, 252.0))
}

/// Tanda de escala (2 o 3 preguntas) y, si hace falta, los recursos de ayuda.
pub fn show_scale(app: &AppHandle) -> tauri::Result<()> {
    show_floating(app, "scale", "Selyh · Unas preguntas", (400.0, 500.0))
}

/// Propuesta de micro-intervención y el ejercicio guiado.
pub fn show_exercise(app: &AppHandle) -> tauri::Result<()> {
    show_floating(app, "exercise", "Selyh · Una pausa", (380.0, 420.0))
}

fn show_floating(app: &AppHandle, label: &str, title: &str, (w, h): (f64, f64)) -> tauri::Result<()> {
    if app.get_webview_window(label).is_some() {
        return Ok(());
    }
    let mut b = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title(title)
        .inner_size(w, h)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(true)
        .focused(false);
    if let Some(m) = app.primary_monitor()? {
        let area = m.work_area();
        let scale = m.scale_factor();
        let x = (area.position.x as f64 + area.size.width as f64) / scale - w - MARGIN;
        let y = (area.position.y as f64 + area.size.height as f64) / scale - h - MARGIN;
        b = b.position(x, y);
    }
    b.build()?;
    Ok(())
}

pub fn close(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.destroy();
    }
}

pub fn close_checkin(app: &AppHandle) {
    close(app, "checkin");
}

pub fn close_floating(app: &AppHandle) {
    for l in FLOATING {
        close(app, l);
    }
}

fn show_or_create(app: &AppHandle, label: &str, title: &str, size: (f64, f64)) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(label) {
        w.unminimize()?;
        w.show()?;
        w.set_focus()?;
        return Ok(());
    }
    WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title(title)
        .inner_size(size.0, size.1)
        .min_inner_size(size.0 * 0.85, size.1 * 0.85)
        .center()
        .build()?;
    Ok(())
}

/// Bienvenida, vinculación con código, consentimientos y preferencias.
pub fn show_onboarding(app: &AppHandle) -> tauri::Result<()> {
    show_or_create(app, "onboarding", "Bienvenida a Selyh", (480.0, 640.0))
}

/// Panel mínimo: hoy, últimos check-ins, transparencia y preferencias.
pub fn show_dashboard(app: &AppHandle) -> tauri::Result<()> {
    show_or_create(app, "dashboard", "Selyh", (760.0, 600.0))
}
