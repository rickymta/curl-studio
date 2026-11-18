//! HTTP execution shared by the request editor, the collection runner and the load engine.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Client, Method};
use reqwest_cookie_store::CookieStoreMutex;
use serde::{Deserialize, Serialize};

use crate::auth;
use crate::error::{Error, Result, describe};
use crate::model::{Auth, Body, KeyValue, RequestOptions, RequestSpec, ResponseData, Timings};

/// Install the ring crypto provider once (reqwest, tonic, tungstenite and rumqttc share it).
pub fn init_tls() {
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

pub fn cookie_jar() -> Arc<CookieStoreMutex> {
    static JAR: OnceLock<Arc<CookieStoreMutex>> = OnceLock::new();
    JAR.get_or_init(|| Arc::new(CookieStoreMutex::new(crate::cookies::load()))).clone()
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct ClientKey {
    verify_tls: bool,
    follow_redirects: bool,
    max_redirects: usize,
    proxy: String,
    http1_only: bool,
    cookies: bool,
}

impl From<&RequestOptions> for ClientKey {
    fn from(o: &RequestOptions) -> Self {
        Self {
            verify_tls: o.verify_tls,
            follow_redirects: o.follow_redirects,
            max_redirects: o.max_redirects,
            proxy: o.proxy.clone(),
            http1_only: o.http1_only,
            cookies: o.cookies,
        }
    }
}

/// Build a client. `jar` = `None` disables cookies; load tests pass a per-VU jar.
pub fn build_client(o: &RequestOptions, jar: Option<Arc<CookieStoreMutex>>) -> Result<Client> {
    init_tls();
    let mut b = Client::builder()
        .user_agent(concat!("CurlStudio/", env!("CARGO_PKG_VERSION")))
        .tls_danger_accept_invalid_certs(!o.verify_tls)
        .redirect(if o.follow_redirects {
            reqwest::redirect::Policy::limited(o.max_redirects.max(1))
        } else {
            reqwest::redirect::Policy::none()
        })
        .pool_idle_timeout(Duration::from_secs(90))
        .connect_timeout(Duration::from_millis(o.timeout_ms.clamp(1000, 30_000)));
    if o.http1_only {
        b = b.http1_only();
    }
    match o.proxy.trim() {
        "" => {}
        "none" => b = b.no_proxy(),
        p => b = b.proxy(reqwest::Proxy::all(p).map_err(|e| Error::Invalid(format!("proxy: {e}")))?),
    }
    if let Some(j) = jar {
        b = b.cookie_provider(j);
    }
    b.build().map_err(|e| Error::Invalid(describe(&e)))
}

/// Shared client for interactive requests (keeps connections warm across sends).
fn shared_client(o: &RequestOptions) -> Result<Client> {
    static CLIENTS: OnceLock<Mutex<HashMap<ClientKey, Client>>> = OnceLock::new();
    let map = CLIENTS.get_or_init(Default::default);
    let key = ClientKey::from(o);
    if let Some(c) = map.lock().unwrap().get(&key) {
        return Ok(c.clone());
    }
    let c = build_client(o, o.cookies.then(cookie_jar))?;
    map.lock().unwrap().insert(key, c.clone());
    Ok(c)
}

/// Body as bytes (or a multipart form, which can only be sent once).
pub enum Prepared {
    Bytes(Option<Bytes>),
    /// Form plus an estimate of its size in bytes (for the bytes-sent metric).
    Multipart(reqwest::multipart::Form, u64),
}

pub async fn prepare_body(body: &Body) -> Result<Prepared> {
    Ok(match body {
        Body::None => Prepared::Bytes(None),
        Body::Raw { raw } => Prepared::Bytes(Some(Bytes::from(raw.clone()))),
        Body::Base64 { data } => Prepared::Bytes(Some(Bytes::from(
            B64.decode(data.trim()).map_err(|e| Error::Invalid(format!("base64 body: {e}")))?,
        ))),
        Body::Urlencoded { fields } => {
            let mut s = url::form_urlencoded::Serializer::new(String::new());
            for f in fields {
                s.append_pair(&f.key, &f.value);
            }
            Prepared::Bytes(Some(Bytes::from(s.finish())))
        }
        Body::Binary { path } => {
            if path.is_empty() {
                Prepared::Bytes(None)
            } else {
                let data = tokio::fs::read(path)
                    .await
                    .map_err(|e| Error::Invalid(format!("binary body {path}: {e}")))?;
                Prepared::Bytes(Some(Bytes::from(data)))
            }
        }
        Body::Formdata { fields } => {
            let mut form = reqwest::multipart::Form::new();
            let mut est: u64 = 0;
            for f in fields {
                if f.kind == "file" {
                    for p in &f.src {
                        let data = tokio::fs::read(p)
                            .await
                            .map_err(|e| Error::Invalid(format!("form file {p}: {e}")))?;
                        let name = std::path::Path::new(p)
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| "file".into());
                        est += data.len() as u64 + 128;
                        let mut part = reqwest::multipart::Part::bytes(data).file_name(name);
                        if let Some(ct) = f.content_type.as_deref().filter(|c| !c.is_empty()) {
                            part = part
                                .mime_str(ct)
                                .map_err(|e| Error::Invalid(format!("content type {ct}: {e}")))?;
                        }
                        form = form.part(f.key.clone(), part);
                    }
                } else {
                    est += (f.key.len() + f.value.len()) as u64 + 96;
                    let mut part = reqwest::multipart::Part::text(f.value.clone());
                    if let Some(ct) = f.content_type.as_deref().filter(|c| !c.is_empty()) {
                        part = part
                            .mime_str(ct)
                            .map_err(|e| Error::Invalid(format!("content type {ct}: {e}")))?;
                    }
                    form = form.part(f.key.clone(), part);
                }
            }
            Prepared::Multipart(form, est)
        }
    })
}

pub fn header_map(list: &[KeyValue]) -> Result<HeaderMap> {
    let mut h = HeaderMap::new();
    for kv in list {
        if kv.key.trim().is_empty() {
            continue;
        }
        let name = HeaderName::from_bytes(kv.key.trim().as_bytes())
            .map_err(|_| Error::Invalid(format!("invalid header name `{}`", kv.key)))?;
        let value = HeaderValue::from_str(&kv.value)
            .map_err(|_| Error::Invalid(format!("invalid value for header `{}`", kv.key)))?;
        h.append(name, value);
    }
    Ok(h)
}

/// Raw outcome used by both the UI response and the load engine.
pub struct Raw {
    pub status: u16,
    pub status_text: String,
    pub version: String,
    pub url: String,
    pub headers: HeaderMap,
    pub body: Bytes,
    pub size: u64,
    pub truncated: bool,
    pub remote_addr: Option<String>,
    pub timings: Timings,
    pub sent_headers: Vec<KeyValue>,
    pub sent_bytes: u64,
    pub method: String,
}

fn parse_method(m: &str) -> Result<Method> {
    let m = m.trim().to_ascii_uppercase();
    Method::from_bytes(m.as_bytes()).map_err(|_| Error::Invalid(format!("invalid method `{m}`")))
}

async fn send_once(
    client: &Client,
    spec: &RequestSpec,
    extra: Option<(String, String)>,
) -> Result<Raw> {
    let t0 = Instant::now();
    let method = parse_method(&spec.method)?;
    let url = url::Url::parse(spec.url.trim())
        .or_else(|_| url::Url::parse(&format!("http://{}", spec.url.trim())))
        .map_err(|e| Error::Invalid(format!("invalid URL `{}`: {e}", spec.url)))?;
    let mut headers = header_map(&spec.headers)?;
    let prepared = prepare_body(&spec.body).await?;
    let is_multipart = matches!(prepared, Prepared::Multipart(..));
    if is_multipart {
        headers.remove(reqwest::header::CONTENT_TYPE);
    }
    if matches!(spec.body, Body::Urlencoded { .. })
        && !headers.contains_key(reqwest::header::CONTENT_TYPE)
    {
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            HeaderValue::from_static("application/x-www-form-urlencoded"),
        );
    }
    let body_bytes = match &prepared {
        Prepared::Bytes(b) => b.clone(),
        Prepared::Multipart(..) => None,
    };
    if let Auth::Awsv4 { access_key, secret_key, region, service, session_token } = &spec.auth {
        let signed = auth::aws_sigv4(
            &auth::AwsCreds {
                access_key,
                secret_key,
                region,
                service,
                session_token,
            },
            method.as_str(),
            &url,
            &headers,
            body_bytes.as_deref(),
            chrono::Utc::now(),
        );
        for (k, v) in signed {
            if let (Ok(n), Ok(v)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(&v))
            {
                headers.insert(n, v);
            }
        }
    }
    if let Some((k, v)) = extra {
        if let (Ok(n), Ok(v)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(&v)) {
            headers.insert(n, v);
        }
    }
    let sent_headers: Vec<KeyValue> = headers
        .iter()
        .map(|(k, v)| KeyValue::new(k.as_str(), String::from_utf8_lossy(v.as_bytes())))
        .collect();
    let mut sent_bytes = body_bytes.as_ref().map(|b| b.len() as u64).unwrap_or(0)
        + sent_headers.iter().map(|h| (h.key.len() + h.value.len() + 4) as u64).sum::<u64>()
        + (method.as_str().len() + url.as_str().len() + 12) as u64;

    let mut rb = client
        .request(method.clone(), url.clone())
        .headers(headers)
        .timeout(Duration::from_millis(spec.options.timeout_ms.max(1)));
    match prepared {
        Prepared::Bytes(Some(b)) => rb = rb.body(b),
        Prepared::Bytes(None) => {}
        Prepared::Multipart(f, est) => {
            sent_bytes += est;
            rb = rb.multipart(f)
        }
    }
    let prepare_ms = t0.elapsed().as_secs_f64() * 1000.0;
    let t_send = Instant::now();
    let resp = rb.send().await?;
    let wait_ms = t_send.elapsed().as_secs_f64() * 1000.0;
    let t_body = Instant::now();
    let status = resp.status();
    let version = format!("{:?}", resp.version());
    let final_url = resp.url().to_string();
    let remote_addr = resp.remote_addr().map(|a| a.to_string());
    let headers = resp.headers().clone();
    let limit = spec.options.max_body_bytes.max(1);
    let mut buf: Vec<u8> = Vec::new();
    let mut size: u64 = 0;
    let mut truncated = false;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(Error::from)?;
        size += chunk.len() as u64;
        if buf.len() < limit {
            let room = limit - buf.len();
            buf.extend_from_slice(&chunk[..chunk.len().min(room)]);
            if chunk.len() > room {
                truncated = true;
            }
        } else {
            truncated = true;
        }
    }
    let download_ms = t_body.elapsed().as_secs_f64() * 1000.0;
    Ok(Raw {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        version,
        url: final_url,
        headers,
        body: Bytes::from(buf),
        size,
        truncated,
        remote_addr,
        timings: Timings {
            prepare_ms,
            wait_ms,
            download_ms,
            total_ms: t0.elapsed().as_secs_f64() * 1000.0,
        },
        sent_headers,
        sent_bytes,
        method: method.to_string(),
    })
}

/// Send with auth handling (digest needs a second round trip).
pub async fn execute(client: &Client, spec: &RequestSpec) -> Result<Raw> {
    let first = send_once(client, spec, None).await?;
    if let Auth::Digest { username, password } = &spec.auth {
        if first.status == 401 {
            let challenge = first
                .headers
                .get_all(reqwest::header::WWW_AUTHENTICATE)
                .iter()
                .filter_map(|v| v.to_str().ok())
                .find(|v| v.trim_start().to_ascii_lowercase().starts_with("digest"));
            if let Some(ch) = challenge {
                let url = url::Url::parse(&spec.url).map_err(|e| Error::Invalid(e.to_string()))?;
                let uri = match url.query() {
                    Some(q) => format!("{}?{}", url.path(), q),
                    None => url.path().to_string(),
                };
                let body = match &spec.body {
                    Body::Raw { raw } => raw.as_bytes().to_vec(),
                    _ => Vec::new(),
                };
                let header = auth::digest_header(
                    ch,
                    username,
                    password,
                    &spec.method.to_ascii_uppercase(),
                    &uri,
                    &body,
                )?;
                let mut second =
                    send_once(client, spec, Some(("authorization".into(), header))).await?;
                second.timings.total_ms += first.timings.total_ms;
                return Ok(second);
            }
        }
    }
    Ok(first)
}

fn looks_textual(ct: &str, body: &[u8]) -> bool {
    let ct = ct.to_ascii_lowercase();
    if ct.starts_with("text/")
        || ct.contains("json")
        || ct.contains("xml")
        || ct.contains("javascript")
        || ct.contains("html")
        || ct.contains("x-www-form-urlencoded")
        || ct.contains("yaml")
        || ct.contains("csv")
        || ct.contains("graphql")
        || ct.contains("event-stream")
    {
        return true;
    }
    if ct.starts_with("image/")
        || ct.starts_with("audio/")
        || ct.starts_with("video/")
        || ct.contains("octet-stream")
        || ct.contains("pdf")
        || ct.contains("zip")
        || ct.contains("protobuf")
        || ct.contains("grpc")
    {
        return false;
    }
    std::str::from_utf8(&body[..body.len().min(4096)]).is_ok()
}

pub fn to_response(raw: Raw) -> ResponseData {
    let ct = raw
        .headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let (body, enc) = if looks_textual(&ct, &raw.body) {
        (String::from_utf8_lossy(&raw.body).to_string(), "utf8")
    } else {
        (B64.encode(&raw.body), "base64")
    };
    let headers: Vec<KeyValue> = raw
        .headers
        .iter()
        .map(|(k, v)| KeyValue::new(k.as_str(), String::from_utf8_lossy(v.as_bytes())))
        .collect();
    let headers_size = headers.iter().map(|h| (h.key.len() + h.value.len() + 4) as u64).sum();
    ResponseData {
        status: raw.status,
        status_text: raw.status_text,
        http_version: raw.version,
        url: raw.url.clone(),
        headers,
        body,
        body_encoding: enc.into(),
        body_truncated: raw.truncated,
        size: raw.size,
        headers_size,
        timings: raw.timings,
        remote_addr: raw.remote_addr,
        request_headers: raw.sent_headers,
        request_method: raw.method,
        request_url: raw.url,
    }
}

fn inflight() -> &'static Mutex<HashMap<String, tokio::task::AbortHandle>> {
    static M: OnceLock<Mutex<HashMap<String, tokio::task::AbortHandle>>> = OnceLock::new();
    M.get_or_init(Default::default)
}

/// Interactive send; `id` lets the UI cancel it.
pub async fn send(id: Option<String>, spec: RequestSpec) -> Result<ResponseData> {
    let client = shared_client(&spec.options)?;
    let task = tokio::spawn(async move { execute(&client, &spec).await.map(to_response) });
    if let Some(id) = &id {
        inflight().lock().unwrap().insert(id.clone(), task.abort_handle());
    }
    let out = task.await;
    if let Some(id) = &id {
        inflight().lock().unwrap().remove(id);
    }
    crate::cookies::persist_soon();
    match out {
        Ok(r) => r,
        Err(e) if e.is_cancelled() => Err(Error::Cancelled),
        Err(e) => Err(Error::Network(e.to_string())),
    }
}

pub fn cancel(id: &str) -> bool {
    if let Some(h) = inflight().lock().unwrap().remove(id) {
        h.abort();
        return true;
    }
    false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBody {
    pub path: String,
    pub spec: RequestSpec,
}

/// Download the full response body straight to a file (no size cap).
pub async fn download(path: &str, mut spec: RequestSpec) -> Result<u64> {
    spec.options.max_body_bytes = usize::MAX;
    let client = shared_client(&spec.options)?;
    let raw = execute(&client, &spec).await?;
    tokio::fs::write(path, &raw.body).await?;
    Ok(raw.size)
}
