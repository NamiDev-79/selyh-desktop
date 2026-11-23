//! Cola local (SQLite) para trabajar sin conexión. Cada check-in lleva un `clientId` (UUID):
//! `POST /sync` es idempotente, así que reenviar un lote nunca duplica datos.

use reqwest::Method;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path, sync::Mutex};

use crate::{
    api::{Api, ApiError},
    sensor::Day,
};

const BATCH: usize = 200; // máximo de check-ins por lote que acepta la API
const SIGNAL_BATCH: i64 = 60; // máximo de resúmenes diarios por lote
const SIGNAL_KEEP_DAYS: i64 = 30; // historial de resúmenes que se conserva para la transparencia
const KEEP: i64 = 100; // historial local que se conserva para el panel y la transparencia

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalCheckin {
    pub client_id: String,
    pub score: u8,
    pub tag: Option<String>,
    pub captured_at: String,
    /// pending | synced | rejected
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FlushReport {
    pub sent: usize,
    pub waiting_consent: usize,
    pub rejected: usize,
    pub signals_sent: usize,
}

pub struct Store {
    db: Mutex<Connection>,
}

impl Store {
    pub fn open(dir: &Path) -> rusqlite::Result<Self> {
        let _ = std::fs::create_dir_all(dir);
        let db = Connection::open(dir.join("selyh.db"))?;
        db.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS checkins (
               client_id   TEXT PRIMARY KEY,
               score       INTEGER NOT NULL,
               tag         TEXT,
               captured_at TEXT NOT NULL,
               status      TEXT NOT NULL DEFAULT 'pending',
               reason      TEXT
             );
             CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS signal_days (
               date                 TEXT PRIMARY KEY,
               active_secs          REAL NOT NULL DEFAULT 0,
               after_hours_secs     REAL NOT NULL DEFAULT 0,
               breaks               INTEGER NOT NULL DEFAULT 0,
               break_secs           REAL NOT NULL DEFAULT 0,
               longest_session_secs REAL NOT NULL DEFAULT 0,
               cur_session_secs     REAL NOT NULL DEFAULT 0,
               gap_secs             REAL NOT NULL DEFAULT 0,
               first_min            INTEGER,
               last_min             INTEGER,
               status               TEXT NOT NULL DEFAULT 'open',
               sent_at              TEXT
             );",
        )?;
        Ok(Self { db: Mutex::new(db) })
    }

    fn db(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn enqueue(&self, score: u8, tag: Option<&str>) -> rusqlite::Result<LocalCheckin> {
        let row = LocalCheckin {
            client_id: uuid::Uuid::new_v4().to_string(),
            score,
            tag: tag.map(str::to_owned),
            captured_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            status: "pending".into(),
            reason: None,
        };
        self.db().execute(
            "INSERT INTO checkins (client_id, score, tag, captured_at) VALUES (?1, ?2, ?3, ?4)",
            params![row.client_id, row.score, row.tag, row.captured_at],
        )?;
        Ok(row)
    }

    pub fn pending(&self) -> Vec<LocalCheckin> {
        self.query("WHERE status = 'pending' ORDER BY captured_at ASC LIMIT ?1", BATCH as i64)
    }

    pub fn recent(&self, limit: i64) -> Vec<LocalCheckin> {
        self.query("ORDER BY captured_at DESC LIMIT ?1", limit)
    }

    pub fn pending_count(&self) -> i64 {
        self.db().query_row("SELECT COUNT(*) FROM checkins WHERE status = 'pending'", [], |r| r.get(0)).unwrap_or(0)
    }

    fn query(&self, tail: &str, n: i64) -> Vec<LocalCheckin> {
        let db = self.db();
        let sql = format!("SELECT client_id, score, tag, captured_at, status, reason FROM checkins {tail}");
        let Ok(mut st) = db.prepare(&sql) else { return vec![] };
        st.query_map([n], |r| {
            Ok(LocalCheckin { client_id: r.get(0)?, score: r.get(1)?, tag: r.get(2)?, captured_at: r.get(3)?, status: r.get(4)?, reason: r.get(5)? })
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    }

    fn mark(&self, id: &str, status: &str, reason: Option<&str>) {
        let _ = self.db().execute("UPDATE checkins SET status = ?2, reason = ?3 WHERE client_id = ?1", params![id, status, reason]);
    }

    fn prune(&self) {
        let _ = self.db().execute(
            "DELETE FROM checkins WHERE status != 'pending' AND client_id NOT IN (SELECT client_id FROM checkins ORDER BY captured_at DESC LIMIT ?1)",
            [KEEP],
        );
    }

    /// Borra todo lo local (al cerrar sesión).
    pub fn wipe(&self) {
        let _ = self.db().execute_batch("DELETE FROM checkins; DELETE FROM kv; DELETE FROM signal_days;");
    }

    // ───── resúmenes diarios del sensor pasivo ─────

    const DAY_COLS: &'static str = "date, active_secs, after_hours_secs, breaks, break_secs, longest_session_secs, cur_session_secs, gap_secs, first_min, last_min, status, sent_at";

    fn days(&self, tail: &str, p: &[&dyn rusqlite::ToSql]) -> Vec<Day> {
        let db = self.db();
        let Ok(mut st) = db.prepare(&format!("SELECT {} FROM signal_days {tail}", Self::DAY_COLS)) else { return vec![] };
        st.query_map(p, |r| {
            Ok(Day {
                date: r.get(0)?,
                active_secs: r.get(1)?,
                after_hours_secs: r.get(2)?,
                breaks: r.get(3)?,
                break_secs: r.get(4)?,
                longest_session_secs: r.get(5)?,
                cur_session_secs: r.get(6)?,
                gap_secs: r.get(7)?,
                first_min: r.get(8)?,
                last_min: r.get(9)?,
                status: r.get(10)?,
                sent_at: r.get(11)?,
            })
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    }

    pub fn signal_day(&self, date: &str) -> Option<Day> {
        self.days("WHERE date = ?1", &[&date]).into_iter().next()
    }

    pub fn save_signal_day(&self, d: &Day) {
        let _ = self.db().execute(
            &format!("INSERT OR REPLACE INTO signal_days ({}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)", Self::DAY_COLS),
            params![d.date, d.active_secs, d.after_hours_secs, d.breaks, d.break_secs, d.longest_session_secs, d.cur_session_secs, d.gap_secs, d.first_min, d.last_min, d.status, d.sent_at],
        );
    }

    pub fn close_signal_days_before(&self, today: &str) {
        let _ = self.db().execute("UPDATE signal_days SET status = 'pending' WHERE status = 'open' AND date < ?1", [today]);
    }

    pub fn recent_signal_days(&self) -> Vec<Day> {
        self.days("ORDER BY date DESC LIMIT ?1", &[&SIGNAL_KEEP_DAYS])
    }

    fn pending_signal_days(&self) -> Vec<Day> {
        self.days("WHERE status = 'pending' AND active_secs > 0 ORDER BY date ASC LIMIT ?1", &[&SIGNAL_BATCH])
    }

    fn mark_signal_day(&self, date: &str, status: &str) {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let _ = self.db().execute("UPDATE signal_days SET status = ?2, sent_at = ?3 WHERE date = ?1", params![date, status, now]);
    }

    /// Al revocar el permiso: se borra todo lo que no se envió (y deja de calcularse).
    pub fn drop_unsent_signals(&self) {
        let _ = self.db().execute("DELETE FROM signal_days WHERE status IN ('open', 'pending', 'rejected')", []);
    }

    fn prune_signals(&self) {
        let _ = self.db().execute("DELETE FROM signal_days WHERE date NOT IN (SELECT date FROM signal_days ORDER BY date DESC LIMIT ?1)", [SIGNAL_KEEP_DAYS]);
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.db().query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn set(&self, key: &str, value: &str) {
        let _ = self.db().execute("INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
    }

    pub fn del(&self, key: &str) {
        let _ = self.db().execute("DELETE FROM kv WHERE key = ?1", [key]);
    }
}

/// Envía la cola pendiente con `POST /sync`. Los rechazados por falta de consentimiento se quedan
/// en la cola (se enviarán cuando la persona lo active); los inválidos o demasiado antiguos se descartan.
pub async fn flush(api: &Api, store: &Store) -> Result<FlushReport, ApiError> {
    let items = store.pending();
    let days = store.pending_signal_days();
    let mut report = FlushReport::default();
    if items.is_empty() && days.is_empty() {
        return Ok(report);
    }
    let check_ins: Vec<Value> = items
        .iter()
        .map(|c| {
            let mut v = json!({ "clientId": c.client_id, "score": c.score, "source": "desktop", "capturedAt": c.captured_at });
            if let Some(t) = &c.tag {
                v["tag"] = json!(t);
            }
            v
        })
        .collect();
    let signals: Vec<Value> = days.iter().map(|d| json!({ "date": d.date, "sourceType": "DESKTOP", "metrics": d.metrics() })).collect();
    let mut body = json!({ "checkIns": check_ins, "signals": signals });
    if let Some(d) = api.device_id().await {
        body["deviceId"] = json!(d);
    }

    let res = api.call(Method::POST, "/sync", Some(&body)).await?;
    let rejected_in = |part: &str| -> HashMap<usize, String> {
        res[part]["rejected"]
            .as_array()
            .map(|a| a.iter().filter_map(|r| Some((r["index"].as_u64()? as usize, r["reason"].as_str()?.to_owned()))).collect())
            .unwrap_or_default()
    };
    let rejected = rejected_in("checkIns");

    for (i, c) in items.iter().enumerate() {
        match rejected.get(&i).map(String::as_str) {
            None => {
                store.mark(&c.client_id, "synced", None);
                report.sent += 1;
            }
            Some("CONSENT_REQUIRED") => {
                store.mark(&c.client_id, "pending", Some("CONSENT_REQUIRED"));
                report.waiting_consent += 1;
            }
            Some(reason) => {
                store.mark(&c.client_id, "rejected", Some(reason));
                report.rejected += 1;
            }
        }
    }
    // Señales: si falta el permiso se quedan "por enviar" (al revocarlo se borran del equipo).
    let rejected_signals = rejected_in("signals");
    for (i, d) in days.iter().enumerate() {
        match rejected_signals.get(&i).map(String::as_str) {
            None => {
                store.mark_signal_day(&d.date, "sent");
                report.signals_sent += 1;
            }
            Some("CONSENT_REQUIRED") => {}
            Some(_) => store.mark_signal_day(&d.date, "rejected"),
        }
    }
    store.prune();
    store.prune_signals();
    Ok(report)
}
