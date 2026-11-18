//! Long-lived connections (WebSocket, SSE, MQTT, gRPC streams). The UI polls each session for
//! new messages by sequence number, which works the same in Tauri and in the dev HTTP bridge.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::mpsc;

use crate::error::{Error, Result};

const MAX_MESSAGES: usize = 5000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub seq: u64,
    /// Milliseconds since the Unix epoch.
    pub ts: i64,
    /// `in`, `out`, `info` or `error`.
    pub dir: &'static str,
    /// `text`, `binary`, `json`, `event`, …
    pub kind: String,
    pub data: String,
    #[serde(skip_serializing_if = "Value::is_null")]
    pub meta: Value,
}

#[derive(Default)]
struct Inner {
    state: String,
    seq: u64,
    messages: VecDeque<Message>,
}

#[derive(Clone)]
pub struct Session {
    pub id: String,
    pub kind: &'static str,
    inner: Arc<Mutex<Inner>>,
    pub tx: mpsc::UnboundedSender<Value>,
}

impl Session {
    pub fn push(&self, dir: &'static str, kind: impl Into<String>, data: impl Into<String>, meta: Value) {
        let mut g = self.inner.lock().unwrap();
        g.seq += 1;
        let seq = g.seq;
        g.messages.push_back(Message {
            seq,
            ts: chrono::Utc::now().timestamp_millis(),
            dir,
            kind: kind.into(),
            data: data.into(),
            meta,
        });
        while g.messages.len() > MAX_MESSAGES {
            g.messages.pop_front();
        }
    }
    pub fn info(&self, text: impl Into<String>) {
        self.push("info", "text", text, Value::Null);
    }
    pub fn error(&self, text: impl Into<String>) {
        self.push("error", "text", text, Value::Null);
    }
    pub fn set_state(&self, s: &str) {
        self.inner.lock().unwrap().state = s.to_string();
    }
    pub fn state(&self) -> String {
        self.inner.lock().unwrap().state.clone()
    }
}

fn registry() -> &'static Mutex<HashMap<String, Session>> {
    static R: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    R.get_or_init(Default::default)
}

/// Register a session; the returned receiver carries UI commands (`send`, `close`, …).
pub fn create(kind: &'static str) -> (Session, mpsc::UnboundedReceiver<Value>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let s = Session {
        id: uuid::Uuid::new_v4().to_string(),
        kind,
        inner: Arc::new(Mutex::new(Inner { state: "connecting".into(), ..Default::default() })),
        tx,
    };
    registry().lock().unwrap().insert(s.id.clone(), s.clone());
    (s, rx)
}

pub fn get(id: &str) -> Result<Session> {
    registry()
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| Error::NotFound(format!("session {id}")))
}

pub fn command(id: &str, cmd: Value) -> Result<()> {
    let s = get(id)?;
    s.tx.send(cmd).map_err(|_| Error::Invalid("session is closed".into()))
}

pub fn poll(id: &str, since: u64) -> Result<Value> {
    let s = get(id)?;
    let g = s.inner.lock().unwrap();
    let msgs: Vec<&Message> = g.messages.iter().filter(|m| m.seq > since).collect();
    Ok(serde_json::json!({ "state": g.state, "seq": g.seq, "messages": msgs }))
}

/// Close (if still open) and forget a session.
pub fn dispose(id: &str) {
    if let Some(s) = registry().lock().unwrap().remove(id) {
        let _ = s.tx.send(serde_json::json!({ "op": "close" }));
    }
}
