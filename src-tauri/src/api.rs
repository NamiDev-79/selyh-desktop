//! Cliente HTTP de la API de Selyh. Los tokens solo viven aquí (y en el llavero): la interfaz
//! nunca los ve. Ante un 401 se rota el refresh token una sola vez, aunque haya varias
//! peticiones en paralelo: la API revoca toda la sesión si un refresh token se reutiliza.

use reqwest::{Method, StatusCode};
use serde::ser::SerializeStruct;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::Mutex;

use crate::keychain::{self, Credentials};

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Sin conexión con Selyh")]
    Network(String),
    #[error("El agente no está vinculado")]
    Unlinked,
    #[error("{message}")]
    Http { status: u16, code: Option<String>, message: String },
}

impl ApiError {
    pub fn code(&self) -> Option<&str> {
        match self {
            ApiError::Http { code, .. } => code.as_deref(),
            _ => None,
        }
    }
}

// La interfaz recibe { kind, status, code, message } y decide el texto a mostrar.
impl serde::Serialize for ApiError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("ApiError", 4)?;
        let (kind, status, code) = match self {
            ApiError::Network(_) => ("network", None, None),
            ApiError::Unlinked => ("unlinked", None, None),
            ApiError::Http { status, code, .. } => ("http", Some(*status), code.clone()),
        };
        st.serialize_field("kind", kind)?;
        st.serialize_field("status", &status)?;
        st.serialize_field("code", &code)?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub struct Api {
    http: reqwest::Client,
    base: String,
    session: Mutex<Option<Credentials>>,
}

impl Api {
    pub fn new(base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(format!("SelyhAgent/{} ({})", crate::config::APP_VERSION, std::env::consts::OS))
            .build()
            .expect("cliente HTTP");
        Self { http, base, session: Mutex::new(keychain::load()) }
    }

    pub async fn linked(&self) -> bool {
        self.session.lock().await.is_some()
    }

    pub async fn device_id(&self) -> Option<String> {
        self.session.lock().await.as_ref().map(|c| c.device_id.clone())
    }

    pub async fn user_name(&self) -> Option<String> {
        self.session.lock().await.as_ref().map(|c| c.user_name.clone())
    }

    /// Guarda una sesión nueva (tras la vinculación) en memoria y en el llavero.
    pub async fn set_session(&self, c: Credentials) -> Result<(), String> {
        keychain::save(&c)?;
        *self.session.lock().await = Some(c);
        Ok(())
    }

    /// Cierra la sesión en el servidor (si se puede) y borra el llavero.
    pub async fn logout(&self) {
        let refresh = self.session.lock().await.take().map(|c| c.refresh_token);
        keychain::clear();
        if let Some(r) = refresh {
            let _ = self.send(Method::POST, "/auth/logout", Some(&json!({ "refreshToken": r })), None).await;
        }
    }

    /// Petición sin sesión (vinculación con código).
    pub async fn public(&self, method: Method, path: &str, body: Option<&Value>) -> Result<Value, ApiError> {
        let res = self.send(method, path, body, None).await?;
        Self::parse(res).await
    }

    /// Petición autenticada, con una rotación del refresh token si el access token venció.
    pub async fn call(&self, method: Method, path: &str, body: Option<&Value>) -> Result<Value, ApiError> {
        let (access, refresh) = match &*self.session.lock().await {
            Some(c) => (c.access_token.clone(), c.refresh_token.clone()),
            None => return Err(ApiError::Unlinked),
        };
        let res = self.send(method.clone(), path, body, Some(&access)).await?;
        if res.status() != StatusCode::UNAUTHORIZED {
            return Self::parse(res).await;
        }
        let access = self.refresh(&refresh).await?;
        let res = self.send(method, path, body, Some(&access)).await?;
        Self::parse(res).await
    }

    /// El lock se mantiene durante la llamada: las demás peticiones esperan y usan el token nuevo.
    async fn refresh(&self, used: &str) -> Result<String, ApiError> {
        let mut guard = self.session.lock().await;
        let Some(c) = guard.as_mut() else { return Err(ApiError::Unlinked) };
        if c.refresh_token != used {
            return Ok(c.access_token.clone()); // otra petición ya rotó
        }
        let res = self.send(Method::POST, "/auth/refresh", Some(&json!({ "refreshToken": used })), None).await?;
        if res.status() == StatusCode::UNAUTHORIZED || res.status() == StatusCode::BAD_REQUEST {
            *guard = None;
            keychain::clear();
            return Err(ApiError::Unlinked);
        }
        let v = Self::parse(res).await?;
        let (Some(a), Some(r)) = (v["accessToken"].as_str(), v["refreshToken"].as_str()) else {
            return Err(ApiError::Network("Respuesta de refresco inválida".into()));
        };
        c.access_token = a.to_owned();
        c.refresh_token = r.to_owned();
        keychain::save(c).map_err(ApiError::Network)?;
        Ok(c.access_token.clone())
    }

    async fn send(&self, method: Method, path: &str, body: Option<&Value>, token: Option<&str>) -> Result<reqwest::Response, ApiError> {
        let mut req = self.http.request(method, format!("{}{}", self.base, path));
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        if let Some(b) = body {
            req = req.json(b);
        }
        req.send().await.map_err(|e| ApiError::Network(e.to_string()))
    }

    async fn parse(res: reqwest::Response) -> Result<Value, ApiError> {
        let status = res.status();
        let text = res.text().await.map_err(|e| ApiError::Network(e.to_string()))?;
        let body: Value = if text.is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) };
        if status.is_success() {
            return Ok(body);
        }
        // La API responde { code, message } o, en la vinculación, { error }.
        let code = body["code"].as_str().or_else(|| body["error"].as_str()).map(str::to_owned);
        let message = match &body["message"] {
            Value::String(s) => s.clone(),
            Value::Array(a) => a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(". "),
            _ => status.canonical_reason().unwrap_or("Error").to_owned(),
        };
        Err(ApiError::Http { status: status.as_u16(), code, message })
    }
}
