//! Detección de actividad e inactividad SIN contenido: solo cuántos segundos pasaron desde la
//! última entrada de teclado o ratón. Nunca qué tecla, qué ventana ni qué app.

/// Segundos desde la última entrada del usuario, o `None` si el sistema no lo permite.
#[cfg(windows)]
pub fn idle_seconds() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: estructura inicializada con su tamaño, como pide la API.
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return None;
    }
    let now = unsafe { GetTickCount() };
    Some(u64::from(now.wrapping_sub(info.dwTime)) / 1000)
}

/// "No molestar": pantalla completa (juegos, videollamadas), modo presentación, horas
/// silenciosas del sistema o pantalla bloqueada.
#[cfg(windows)]
pub fn busy() -> bool {
    use windows_sys::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUERY_USER_NOTIFICATION_STATE, QUNS_BUSY, QUNS_NOT_PRESENT, QUNS_PRESENTATION_MODE, QUNS_QUIET_TIME,
        QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    let mut state: QUERY_USER_NOTIFICATION_STATE = 0;
    // SAFETY: puntero válido a una variable local.
    if unsafe { SHQueryUserNotificationState(&mut state) } != 0 {
        return false;
    }
    matches!(state, QUNS_NOT_PRESENT | QUNS_BUSY | QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE | QUNS_QUIET_TIME)
}

// macOS (IOKit, HIDIdleTime) y Linux (X11 XScreenSaver; en Wayland depende del compositor) quedan
// pendientes. Mientras tanto el agente no detecta pausas ahí y se apoya solo en /prompts/next.
#[cfg(not(windows))]
pub fn idle_seconds() -> Option<u64> {
    None
}

#[cfg(not(windows))]
pub fn busy() -> bool {
    false
}
