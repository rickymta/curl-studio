//! Server-Sent Events client session (`text/event-stream`).

use futures_util::StreamExt;
use serde_json::{Value, json};

use crate::error::Result;
use crate::model::{KeyValue, RequestSpec};
use crate::sessions;

/// Incremental `text/event-stream` parser.
#[derive(Default)]
pub struct SseParser {
    buf: String,
    event: String,
    data: Vec<String>,
    id: String,
}

pub struct SseEvent {
    pub event: String,
    pub data: String,
    pub id: String,
}

impl SseParser {
    pub fn feed(&mut self, chunk: &str) -> Vec<SseEvent> {
        self.buf.push_str(chunk);
        let mut out = Vec::new();
        while let Some(pos) = self.buf.find('\n') {
            let line = self.buf[..pos].trim_end_matches('\r').to_string();
            self.buf.drain(..=pos);
            if line.is_empty() {
                if !self.data.is_empty() {
                    out.push(SseEvent {
                        event: if self.event.is_empty() {
                            "message".into()
                        } else {
                            self.event.clone()
                        },
                        data: self.data.join("\n"),
                        id: self.id.clone(),
                    });
                }
                self.event.clear();
                self.data.clear();
                continue;
            }
            if line.starts_with(':') {
                continue;
            }
            let (field, value) = match line.find(':') {
                Some(i) => {
                    let v = &line[i + 1..];
                    (&line[..i], v.strip_prefix(' ').unwrap_or(v))
                }
                None => (line.as_str(), ""),
            };
            match field {
                "event" => self.event = value.to_string(),
                "data" => self.data.push(value.to_string()),
                "id" => self.id = value.to_string(),
                _ => {}
            }
        }
        out
    }
}

pub async fn connect(mut spec: RequestSpec) -> Result<String> {
    if !spec.headers.iter().any(|h| h.key.eq_ignore_ascii_case("accept")) {
        spec.headers.push(KeyValue::new("Accept", "text/event-stream"));
    }
    let client = crate::http::build_client(&spec.options, None)?;
    let headers = crate::http::header_map(&spec.headers)?;
    let method = reqwest::Method::from_bytes(spec.method.to_ascii_uppercase().as_bytes())
        .unwrap_or(reqwest::Method::GET);
    let (session, mut rx) = sessions::create("sse");
    let s = session.clone();
    tokio::spawn(async move {
        s.info(format!("Connecting to {}", spec.url));
        let mut rb = client.request(method, spec.url.clone()).headers(headers);
        if let crate::model::Body::Raw { raw } = &spec.body {
            rb = rb.body(raw.clone());
        }
        let resp = tokio::select! {
            r = rb.send() => r,
            _ = rx.recv() => { s.info("Cancelled"); s.set_state("closed"); return; }
        };
        let resp = match resp {
            Ok(r) => r,
            Err(e) => {
                s.error(format!("Connection failed: {}", crate::error::describe(&e)));
                s.set_state("closed");
                return;
            }
        };
        let headers: Vec<Value> = resp
            .headers()
            .iter()
            .map(|(k, v)| {
                json!({"key": k.as_str(), "value": String::from_utf8_lossy(v.as_bytes())})
            })
            .collect();
        s.push(
            "info",
            "connected",
            format!("HTTP {}", resp.status()),
            json!({"status": resp.status().as_u16(), "headers": headers}),
        );
        s.set_state("open");
        let mut stream = resp.bytes_stream();
        let mut parser = SseParser::default();
        loop {
            tokio::select! {
                cmd = rx.recv() => {
                    let op = cmd.as_ref().and_then(|c| c.get("op")).and_then(Value::as_str);
                    if cmd.is_none() || op == Some("close") {
                        s.info("Disconnected by client");
                        break;
                    }
                }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(b)) => {
                            for ev in parser.feed(&String::from_utf8_lossy(&b)) {
                                s.push("in", "event", ev.data, json!({"event": ev.event, "id": ev.id}));
                            }
                        }
                        Some(Err(e)) => {
                            s.error(format!("Stream error: {}", crate::error::describe(&e)));
                            break;
                        }
                        None => { s.info("Stream ended"); break; }
                    }
                }
            }
        }
        s.set_state("closed");
    });
    Ok(session.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_events_across_chunks() {
        let mut p = SseParser::default();
        assert!(p.feed("event: tick\ndata: 1").is_empty());
        let evs = p.feed("\ndata: 2\nid: 7\n\n: comment\ndata: x\n\n");
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0].event, "tick");
        assert_eq!(evs[0].data, "1\n2");
        assert_eq!(evs[0].id, "7");
        assert_eq!(evs[1].event, "message");
    }
}
