//! Activity Logs (as in GitStudio): `activity.jsonl` in the workspace folder, one JSON object per
//! line. Appends are cheap; at load, entries older than the retention period are dropped, and the
//! file never grows past the maximum size (oldest entries go first). The limits come from
//! `settings.json` (Settings → Data & Logs).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

use crate::error::Result;
use crate::store;

const MB: u64 = 1024 * 1024;
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

/// Limits of the log file; every field has a default so old settings files keep working.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Entries older than this are deleted at startup; 0 keeps everything.
    pub retention_days: u32,
    /// Size above which the app warns.
    pub warn_bytes: u64,
    /// Size the file is never allowed to exceed.
    pub max_bytes: u64,
    /// Most recent entries returned to the UI at startup.
    pub load_limit: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            retention_days: 30,
            warn_bytes: 5 * MB,
            max_bytes: 10 * MB,
            load_limit: 5000,
        }
    }
}

impl Limits {
    /// Read the `activity*` keys of the settings document, clamped to sane ranges.
    pub fn from_settings(settings: &Value) -> Self {
        let d = Limits::default();
        let num = |key: &str| settings.get(key).and_then(Value::as_f64);
        let max_mb = num("activityMaxMb").map_or(d.max_bytes / MB, |v| v.clamp(1.0, 1024.0) as u64);
        let warn_mb = num("activityWarnMb")
            .map_or(d.warn_bytes / MB, |v| v.clamp(1.0, 1024.0) as u64)
            .min(max_mb);
        Limits {
            retention_days: num("activityRetentionDays")
                .map_or(d.retention_days, |v| v.clamp(0.0, 3650.0) as u32),
            warn_bytes: warn_mb * MB,
            max_bytes: max_mb * MB,
            load_limit: num("activityLoadLimit")
                .map_or(d.load_limit, |v| v.clamp(100.0, 100_000.0) as usize),
        }
    }

    fn current() -> Self {
        Self::from_settings(&store::get_doc("settings").unwrap_or(Value::Null))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub path: String,
    pub bytes: u64,
    pub entries: usize,
    /// `ok`, `warn` (over the warning size) or `full` (at the limit, oldest being dropped).
    pub level: &'static str,
    pub warn_bytes: u64,
    pub max_bytes: u64,
    pub retention_days: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Loaded {
    /// Most recent entries, oldest first.
    pub entries: Vec<Value>,
    /// Entries deleted by the retention period or the size limit during this load.
    pub pruned: usize,
    pub stats: Stats,
}

fn level(bytes: u64, limits: Limits) -> &'static str {
    if bytes >= limits.max_bytes / 10 * 9 {
        "full"
    } else if bytes >= limits.warn_bytes {
        "warn"
    } else {
        "ok"
    }
}

fn stats(path: &Path, entries: usize, limits: Limits) -> Stats {
    let bytes = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    Stats {
        path: path.to_string_lossy().into_owned(),
        bytes,
        entries,
        level: level(bytes, limits),
        warn_bytes: limits.warn_bytes,
        max_bytes: limits.max_bytes,
        retention_days: limits.retention_days,
    }
}

fn size(lines: &[&str]) -> u64 {
    lines.iter().map(|l| l.len() as u64 + 1).sum()
}

/// Drop the oldest lines until the rest fits in `budget` bytes.
fn newest_within(mut lines: Vec<&str>, budget: u64) -> Vec<&str> {
    let mut total = size(&lines);
    let mut drop = 0;
    while total > budget && drop < lines.len() {
        total -= lines[drop].len() as u64 + 1;
        drop += 1;
    }
    lines.drain(..drop);
    lines
}

/// Keep parsable lines newer than the retention period; past the maximum size, keep the newest
/// 80% of it so the file is not rewritten on every append.
fn prune(text: &str, limits: Limits, now: i64) -> Vec<&str> {
    let cutoff = if limits.retention_days == 0 {
        i64::MIN
    } else {
        now - limits.retention_days as i64 * DAY_MS
    };
    let keep: Vec<&str> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter(|l| {
            serde_json::from_str::<Value>(l)
                .ok()
                .and_then(|v| v.get("at").and_then(Value::as_i64))
                .is_some_and(|at| at >= cutoff)
        })
        .collect();
    if size(&keep) > limits.max_bytes {
        newest_within(keep, limits.max_bytes / 10 * 8)
    } else {
        keep
    }
}

fn write_lines(path: &Path, lines: &[&str]) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut out = lines.join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    fs::write(path, out)?;
    Ok(())
}

fn count(text: &str) -> usize {
    text.lines().filter(|l| !l.trim().is_empty()).count()
}

fn load_in(path: &Path, limits: Limits) -> Result<Loaded> {
    let text = fs::read_to_string(path).unwrap_or_default();
    let total = count(&text);
    let kept = prune(&text, limits, now_ms());
    if kept.len() != total {
        write_lines(path, &kept)?;
    }
    let entries = kept
        .iter()
        .skip(kept.len().saturating_sub(limits.load_limit))
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    Ok(Loaded {
        entries,
        pruned: total - kept.len(),
        stats: stats(path, kept.len(), limits),
    })
}

fn append_in(path: &Path, entries: &[Value], limits: Limits) -> Result<Stats> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut buf = String::new();
    for e in entries {
        buf.push_str(&serde_json::to_string(e)?);
        buf.push('\n');
    }
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    f.write_all(buf.as_bytes())?;
    drop(f);
    // At the hard limit the oldest entries go, so the file stays bounded while the app runs.
    if fs::metadata(path).map(|m| m.len()).unwrap_or(0) > limits.max_bytes {
        let text = fs::read_to_string(path).unwrap_or_default();
        write_lines(path, &prune(&text, limits, now_ms()))?;
    }
    Ok(stats(path, 0, limits))
}

pub fn load() -> Result<Loaded> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    load_in(&file(), Limits::current())
}

pub fn append(entries: &[Value]) -> Result<Stats> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let limits = Limits::current();
    if entries.is_empty() {
        return Ok(stats(&file(), 0, limits));
    }
    append_in(&file(), entries, limits)
}

/// Size and limits of the file, without touching it (after the limits change in Settings).
pub fn current_stats() -> Result<Stats> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = file();
    let entries = count(&fs::read_to_string(&path).unwrap_or_default());
    Ok(stats(&path, entries, Limits::current()))
}

pub fn clear() -> Result<Stats> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = file();
    if path.exists() {
        fs::write(&path, "")?;
    }
    Ok(stats(&path, 0, Limits::current()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn line(at: i64, label: &str) -> String {
        json!({ "at": at, "label": label }).to_string()
    }

    #[test]
    fn prune_drops_old_and_bad_lines() {
        let limits = Limits::default();
        let now = now_ms();
        let old = now - (limits.retention_days as i64 + 1) * DAY_MS;
        let text = format!("{}\nnot json\n{}\n", line(old, "old"), line(now, "new"));
        let kept = prune(&text, limits, now);
        assert_eq!(kept.len(), 1);
        assert!(kept[0].contains("new"));
    }

    #[test]
    fn retention_zero_keeps_everything() {
        let limits = Limits {
            retention_days: 0,
            ..Limits::default()
        };
        let text = format!("{}\n{}\n", line(1, "ancient"), line(now_ms(), "new"));
        assert_eq!(prune(&text, limits, now_ms()).len(), 2);
    }

    #[test]
    fn over_the_maximum_keeps_the_newest_80_percent() {
        let now = now_ms();
        let one = line(now, "x").len() as u64 + 1;
        let limits = Limits {
            max_bytes: one * 10,
            warn_bytes: one * 5,
            ..Limits::default()
        };
        let text: String = (0..20).map(|i| line(now + i, "x") + "\n").collect();
        let kept = prune(&text, limits, now);
        assert_eq!(kept.len(), 8);
        assert!(kept[7].contains(&(now + 19).to_string()));
    }

    #[test]
    fn limits_come_from_settings_with_defaults_and_clamps() {
        assert_eq!(Limits::from_settings(&Value::Null), Limits::default());
        let l = Limits::from_settings(&json!({
            "activityRetentionDays": 0,
            "activityWarnMb": 50,
            "activityMaxMb": 20,
            "activityLoadLimit": 5,
        }));
        assert_eq!(l.retention_days, 0);
        assert_eq!(l.max_bytes, 20 * MB);
        // The warning size never exceeds the maximum.
        assert_eq!(l.warn_bytes, 20 * MB);
        assert_eq!(l.load_limit, 100);
    }

    #[test]
    fn levels() {
        let l = Limits::default();
        assert_eq!(level(0, l), "ok");
        assert_eq!(level(l.warn_bytes, l), "warn");
        assert_eq!(level(l.max_bytes, l), "full");
    }

    #[test]
    fn append_and_load_round_trip_and_stay_bounded() {
        let dir = std::env::temp_dir().join(format!("curlstudio-activity-{}", now_ms()));
        let path = dir.join("activity.jsonl");
        let now = now_ms();
        let one = line(now, "x").len() as u64 + 1;
        let limits = Limits {
            max_bytes: one * 10,
            warn_bytes: one * 5,
            ..Limits::default()
        };
        let entries: Vec<Value> = (0..25).map(|_| json!({ "at": now, "label": "x" })).collect();
        let st = append_in(&path, &entries, limits).unwrap();
        assert!(st.bytes <= limits.max_bytes);
        let loaded = load_in(&path, limits).unwrap();
        assert_eq!(loaded.entries.len(), 8);
        assert_eq!(loaded.pruned, 0);
        let _ = fs::remove_dir_all(dir);
    }
}
