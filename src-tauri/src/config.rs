//! URLs de la API y de la web. Por defecto, producción (API en Railway, web en selyh.fun).
//! Se pueden cambiar al compilar o al arrancar con `SELYH_API_URL` / `SELYH_WEB_URL`,
//! p. ej. `SELYH_API_URL=http://localhost:3000` para probar contra la API local.

/// API de producción (dominio por defecto de Railway; cambiar a `https://api.selyh.fun` cuando se asigne).
pub const DEFAULT_API_URL: &str = "https://selyhbackend-production.up.railway.app";
/// Web de producción (aprobar el código de vinculación y abrir el panel).
pub const DEFAULT_WEB_URL: &str = "https://selyh.fun";

pub fn api_url() -> String {
    std::env::var("SELYH_API_URL")
        .ok()
        .or_else(|| option_env!("SELYH_API_URL").map(str::to_owned))
        .unwrap_or_else(|| DEFAULT_API_URL.into())
        .trim_end_matches('/')
        .to_owned()
}

pub fn web_url() -> String {
    std::env::var("SELYH_WEB_URL")
        .ok()
        .or_else(|| option_env!("SELYH_WEB_URL").map(str::to_owned))
        .unwrap_or_else(|| DEFAULT_WEB_URL.into())
        .trim_end_matches('/')
        .to_owned()
}

/// Perfil de desarrollo (`SELYH_PROFILE=prueba`): usa otra entrada del llavero y otra base local,
/// para probar con otra cuenta sin tocar la sesión real. Vacío en uso normal.
pub fn profile() -> Option<String> {
    std::env::var("SELYH_PROFILE").ok().filter(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
}

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
