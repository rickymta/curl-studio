//! Workspace cookie jar (Postman's "Cookies" manager), persisted to `cookies.json`.

use std::sync::atomic::{AtomicBool, Ordering};

use cookie_store::{CookieDomain, CookieExpiration, CookieStore, RawCookie};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::http::cookie_jar;

fn path() -> std::path::PathBuf {
    crate::store::root().join("cookies.json")
}

pub fn load() -> CookieStore {
    match std::fs::File::open(path()) {
        Ok(f) => {
            cookie_store::serde::json::load_all(std::io::BufReader::new(f)).unwrap_or_default()
        }
        Err(_) => CookieStore::default(),
    }
}

pub fn save() -> Result<()> {
    let jar = cookie_jar();
    let store = jar
        .lock()
        .map_err(|_| Error::Invalid("cookie jar poisoned".into()))?;
    let mut buf = Vec::new();
    cookie_store::serde::json::save_incl_expired_and_nonpersistent(&store, &mut buf)
        .map_err(|e| Error::Invalid(e.to_string()))?;
    drop(store);
    crate::store::write_atomic(&path(), &buf)
}

/// Debounced save after responses (many sends in a burst → one write).
pub fn persist_soon() {
    static PENDING: AtomicBool = AtomicBool::new(false);
    if PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(rt) = tokio::runtime::Handle::try_current() {
        rt.spawn(async {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            PENDING.store(false, Ordering::SeqCst);
            let _ = save();
        });
    } else {
        PENDING.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieInfo {
    pub domain: String,
    pub host_only: bool,
    pub path: String,
    pub name: String,
    pub value: String,
    pub expires: Option<i64>,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: Option<String>,
}

pub fn list() -> Vec<CookieInfo> {
    let jar = cookie_jar();
    let store = jar.lock().unwrap();
    let mut out: Vec<CookieInfo> = store
        .iter_any()
        .map(|c| {
            let (domain, host_only) = match &c.domain {
                CookieDomain::HostOnly(d) => (d.clone(), true),
                CookieDomain::Suffix(d) => (d.clone(), false),
                _ => (String::new(), true),
            };
            CookieInfo {
                domain,
                host_only,
                path: c.path.as_ref().to_string(),
                name: c.name().to_string(),
                value: c.value().to_string(),
                expires: match &c.expires {
                    CookieExpiration::AtUtc(t) => Some(t.unix_timestamp()),
                    CookieExpiration::SessionEnd => None,
                },
                secure: c.secure().unwrap_or(false),
                http_only: c.http_only().unwrap_or(false),
                same_site: c.same_site().map(|s| s.to_string()),
            }
        })
        .collect();
    out.sort_by(|a, b| a.domain.cmp(&b.domain).then(a.name.cmp(&b.name)));
    out
}

pub fn remove(domain: &str, path: &str, name: &str) -> Result<()> {
    cookie_jar().lock().unwrap().remove(domain, path, name);
    save()
}

pub fn clear(domain: Option<&str>) -> Result<()> {
    {
        let jar = cookie_jar();
        let mut store = jar.lock().unwrap();
        match domain {
            None => store.clear(),
            Some(d) => {
                let doomed: Vec<(String, String, String)> = store
                    .iter_any()
                    .filter(|c| c.domain.as_cow().map(|x| x == d).unwrap_or(false))
                    .map(|c| {
                        (
                            d.to_string(),
                            c.path.as_ref().to_string(),
                            c.name().to_string(),
                        )
                    })
                    .collect();
                for (d, p, n) in doomed {
                    store.remove(&d, &p, &n);
                }
            }
        }
    }
    save()
}

/// Add or replace a cookie from a `Set-Cookie`-style string for `domain`.
pub fn set(domain: &str, cookie: &str) -> Result<()> {
    let url = url::Url::parse(&format!("https://{}/", domain.trim_start_matches('.')))
        .map_err(|e| Error::Invalid(format!("domain: {e}")))?;
    let raw =
        RawCookie::parse(cookie.to_string()).map_err(|e| Error::Invalid(format!("cookie: {e}")))?;
    cookie_jar()
        .lock()
        .unwrap()
        .insert_raw(&raw, &url)
        .map_err(|e| Error::Invalid(format!("cookie: {e}")))?;
    save()
}
