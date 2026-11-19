//! Workspace on disk. Collections and environments are stored as plain Postman v2.1 / environment
//! JSON (one file each), so the folder can be committed, diffed or opened by Postman directly.
//!
//! Layout under the data dir (`CURLSTUDIO_HOME` overrides it):
//! `collections/<id>.json`, `environments/<id>.json`, `loadScenarios/<id>.json`,
//! `loadRuns/<id>.json`, `runnerRuns/<id>.json`, `protos/<id>.json`, plus singleton documents
//! (`globals.json`, `settings.json`, `history.json`, `cookies.json`).

use std::path::PathBuf;

use serde_json::Value;

use crate::error::{Error, Result};

const KINDS: &[&str] = &[
    "collections",
    "environments",
    "loadScenarios",
    "loadRuns",
    "runnerRuns",
    "protos",
];
const DOCS: &[&str] = &["globals", "settings", "history", "cookies", "workspace"];

static ROOT_OVERRIDE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Point the store somewhere else (tests, portable mode). First call wins.
pub fn set_root(p: PathBuf) {
    let _ = ROOT_OVERRIDE.set(p);
}

pub fn root() -> PathBuf {
    if let Some(p) = ROOT_OVERRIDE.get() {
        return p.clone();
    }
    if let Ok(p) = std::env::var("CURLSTUDIO_HOME") {
        return PathBuf::from(p);
    }
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("CurlStudio")
}

fn safe_id(id: &str) -> Result<&str> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(Error::Invalid(format!("invalid id `{id}`")));
    }
    Ok(id)
}

fn kind_dir(kind: &str) -> Result<PathBuf> {
    if !KINDS.contains(&kind) {
        return Err(Error::Invalid(format!("unknown kind `{kind}`")));
    }
    Ok(root().join(kind))
}

fn doc_path(name: &str) -> Result<PathBuf> {
    if !DOCS.contains(&name) {
        return Err(Error::Invalid(format!("unknown document `{name}`")));
    }
    Ok(root().join(format!("{name}.json")))
}

/// Write via a temp file + rename so a crash never leaves half a collection.
pub fn write_atomic(path: &std::path::Path, data: &[u8]) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn strip(mut v: Value, omit: &[String]) -> Value {
    if let Value::Object(m) = &mut v {
        for k in omit {
            m.remove(k);
        }
    }
    v
}

pub fn list(kind: &str, omit: &[String]) -> Result<Vec<Value>> {
    let dir = kind_dir(kind)?;
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Ok(out);
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&p) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let id = p
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        out.push(serde_json::json!({ "id": id, "doc": strip(v, omit) }));
    }
    Ok(out)
}

pub fn get(kind: &str, id: &str) -> Result<Value> {
    let p = kind_dir(kind)?.join(format!("{}.json", safe_id(id)?));
    let text = std::fs::read_to_string(&p).map_err(|_| Error::NotFound(format!("{kind}/{id}")))?;
    Ok(serde_json::from_str(&text)?)
}

pub fn put(kind: &str, id: &str, doc: &Value) -> Result<()> {
    let p = kind_dir(kind)?.join(format!("{}.json", safe_id(id)?));
    write_atomic(&p, serde_json::to_string_pretty(doc)?.as_bytes())
}

pub fn delete(kind: &str, id: &str) -> Result<()> {
    let p = kind_dir(kind)?.join(format!("{}.json", safe_id(id)?));
    match std::fs::remove_file(p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn get_doc(name: &str) -> Result<Value> {
    let p = doc_path(name)?;
    match std::fs::read_to_string(&p) {
        Ok(t) => Ok(serde_json::from_str(&t).unwrap_or(Value::Null)),
        Err(_) => Ok(Value::Null),
    }
}

pub fn put_doc(name: &str, doc: &Value) -> Result<()> {
    write_atomic(
        &doc_path(name)?,
        serde_json::to_string_pretty(doc)?.as_bytes(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        set_root(dir.path().to_path_buf());
        put(
            "collections",
            "abc",
            &serde_json::json!({"info": {"name": "x"}}),
        )
        .unwrap();
        assert_eq!(get("collections", "abc").unwrap()["info"]["name"], "x");
        assert_eq!(list("collections", &[]).unwrap().len(), 1);
        delete("collections", "abc").unwrap();
        assert!(get("collections", "abc").is_err());
        assert!(put("collections", "../x", &Value::Null).is_err());
    }
}
