//! Activity Logs (as in GitStudio): `activity.jsonl` in the workspace folder, one JSON object per
//! line. Appends are cheap; at load, entries older than the retention period are dropped and the
//! file is trimmed to `MAX_BYTES` (oldest first).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

use crate::error::Result;
use crate::store;

const MAX_BYTES: u64 = 10 * 1024 * 1024;
const RETENTION_DAYS: i64 = 30;
/// Entries returned to the UI at startup (most recent).
const LOAD_LIMIT: usize = 5000;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

static LOCK: Mutex<()> = Mutex::new(());

fn file() -> PathBuf {
    store::root().join("activity.jsonl")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub path: String,
    pub bytes: u64,
    pub entries: usize,
    pub max_bytes: u64,
    pub retention_days: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Loaded {
    pub entries: Vec<Value>,
    pub stats: Stats,
}

fn stats(entries: usize) -> Stats {
    let path = file();
    Stats {
        bytes: fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        path: path.to_string_lossy().into_owned(),
        entries,
        max_bytes: MAX_BYTES,
        retention_days: RETENTION_DAYS,
    }
}

/// Keep lines newer than the retention period, newest `MAX_BYTES` worth.
fn prune(text: &str) -> Vec<&str> {
    let cutoff = now_ms() - RETENTION_DAYS * DAY_MS;
    let mut keep: Vec<&str> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter(|l| {
            serde_json::from_str::<Value>(l)
                .ok()
                .and_then(|v| v.get("at").and_then(Value::as_i64))
                .is_some_and(|at| at >= cutoff)
        })
        .collect();
    let mut total: u64 = keep.iter().map(|l| l.len() as u64 + 1).sum();
    let mut drop = 0;
    while total > MAX_BYTES && drop < keep.len() {
        total -= keep[drop].len() as u64 + 1;
        drop += 1;
    }
    keep.drain(..drop);
    keep
}

pub fn load() -> Result<Loaded> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = file();
    let text = fs::read_to_string(&path).unwrap_or_default();
    let kept = prune(&text);
    let count = kept.len();
    if count != text.lines().filter(|l| !l.trim().is_empty()).count() {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let mut out = kept.join("\n");
        if !out.is_empty() {
            out.push('\n');
        }
        fs::write(&path, out)?;
    }
    let entries = kept
        .iter()
        .skip(count.saturating_sub(LOAD_LIMIT))
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    Ok(Loaded {
        entries,
        stats: stats(count),
    })
}

pub fn append(entries: &[Value]) -> Result<Stats> {
    if entries.is_empty() {
        return Ok(stats(0));
    }
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = file();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
    let mut buf = String::new();
    for e in entries {
        buf.push_str(&serde_json::to_string(e)?);
        buf.push('\n');
    }
    f.write_all(buf.as_bytes())?;
    drop(f);
    Ok(stats(0))
}

pub fn clear() -> Result<Stats> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = file();
    if path.exists() {
        fs::write(&path, "")?;
    }
    Ok(stats(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prune_drops_old_and_bad_lines() {
        let now = now_ms();
        let old = now - (RETENTION_DAYS + 1) * DAY_MS;
        let text = format!(
            "{{\"at\":{old},\"label\":\"old\"}}\nnot json\n{{\"at\":{now},\"label\":\"new\"}}\n"
        );
        let kept = prune(&text);
        assert_eq!(kept.len(), 1);
        assert!(kept[0].contains("new"));
    }
}
