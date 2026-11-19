//! WebSocket client session.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message as WsMsg;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};

use crate::error::{Error, Result};
use crate::model::KeyValue;
use crate::sessions;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsConnect {
    pub url: String,
    #[serde(default)]
    pub headers: Vec<KeyValue>,
    #[serde(default)]
    pub protocols: Vec<String>,
    #[serde(default = "yes")]
    pub verify_tls: bool,
}

fn yes() -> bool {
    true
}

pub async fn connect(opts: WsConnect) -> Result<String> {
    let mut req = opts
        .url
        .trim()
        .into_client_request()
        .map_err(|e| Error::Invalid(format!("websocket URL: {e}")))?;
    for h in &opts.headers {
        if h.key.trim().is_empty() {
            continue;
        }
        let n = HeaderName::from_bytes(h.key.trim().as_bytes())
            .map_err(|_| Error::Invalid(format!("invalid header `{}`", h.key)))?;
        let v = HeaderValue::from_str(&h.value)
            .map_err(|_| Error::Invalid(format!("invalid header value for `{}`", h.key)))?;
        req.headers_mut().append(n, v);
    }
    // Same User-Agent as HTTP requests unless the user set one (some gateways reject handshakes
    // without it).
    if !req.headers().contains_key("user-agent") {
        req.headers_mut().insert(
            "user-agent",
            HeaderValue::from_static(concat!("CurlStudio/", env!("CARGO_PKG_VERSION"))),
        );
    }
    if !opts.protocols.is_empty() {
        let v = HeaderValue::from_str(&opts.protocols.join(", "))
            .map_err(|_| Error::Invalid("invalid subprotocol".into()))?;
        req.headers_mut().insert("sec-websocket-protocol", v);
    }
    let connector = tokio_tungstenite::Connector::Rustls(crate::tls::client_config(
        opts.verify_tls,
        &[b"http/1.1"],
    ));
    let (session, mut rx) = sessions::create("ws");
    let s = session.clone();
    let url = opts.url.clone();
    tokio::spawn(async move {
        s.info(format!("Connecting to {url}"));
        let started = std::time::Instant::now();
        let conn =
            tokio_tungstenite::connect_async_tls_with_config(req, None, false, Some(connector))
                .await;
        let (stream, resp) = match conn {
            Ok(x) => x,
            Err(e) => {
                s.error(format!("Connection failed: {e}"));
                s.set_state("closed");
                return;
            }
        };
        let headers: Vec<Value> = resp
            .headers()
            .iter()
            .map(
                |(k, v)| json!({"key": k.as_str(), "value": String::from_utf8_lossy(v.as_bytes())}),
            )
            .collect();
        s.push(
            "info",
            "connected",
            format!("Connected ({} ms)", started.elapsed().as_millis()),
            json!({ "status": resp.status().as_u16(), "headers": headers }),
        );
        s.set_state("open");
        let (mut sink, mut source) = stream.split();
        loop {
            tokio::select! {
                cmd = rx.recv() => {
                    let Some(cmd) = cmd else { break };
                    match cmd.get("op").and_then(Value::as_str).unwrap_or("") {
                        "send" => {
                            let data = cmd.get("data").and_then(Value::as_str).unwrap_or("").to_string();
                            let binary = cmd.get("binary").and_then(Value::as_bool).unwrap_or(false);
                            let msg = if binary {
                                match B64.decode(data.trim()) {
                                    Ok(b) => WsMsg::Binary(b.into()),
                                    Err(e) => { s.error(format!("Invalid base64: {e}")); continue; }
                                }
                            } else {
                                WsMsg::Text(data.clone().into())
                            };
                            match sink.send(msg).await {
                                Ok(()) => s.push("out", if binary { "binary" } else { "text" }, data, Value::Null),
                                Err(e) => s.error(format!("Send failed: {e}")),
                            }
                        }
                        "ping" => {
                            let _ = sink.send(WsMsg::Ping(Vec::new().into())).await;
                            s.push("out", "ping", "", Value::Null);
                        }
                        "close" => {
                            let _ = sink.send(WsMsg::Close(None)).await;
                            s.info("Disconnected by client");
                            break;
                        }
                        _ => {}
                    }
                }
                msg = source.next() => {
                    match msg {
                        Some(Ok(WsMsg::Text(t))) => s.push("in", "text", t.to_string(), Value::Null),
                        Some(Ok(WsMsg::Binary(b))) => s.push("in", "binary", B64.encode(&b), json!({"size": b.len()})),
                        Some(Ok(WsMsg::Ping(_))) => s.push("in", "ping", "", Value::Null),
                        Some(Ok(WsMsg::Pong(_))) => s.push("in", "pong", "", Value::Null),
                        Some(Ok(WsMsg::Close(f))) => {
                            let why = f.map(|f| format!("{} {}", u16::from(f.code), f.reason)).unwrap_or_default();
                            s.info(format!("Server closed the connection {why}"));
                            break;
                        }
                        Some(Ok(WsMsg::Frame(_))) => {}
                        Some(Err(e)) => { s.error(format!("Connection error: {e}")); break; }
                        None => { s.info("Connection closed"); break; }
                    }
                }
            }
        }
        s.set_state("closed");
    });
    Ok(session.id)
}
