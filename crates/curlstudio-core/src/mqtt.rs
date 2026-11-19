//! MQTT 3.1.1 client session (TCP or TLS).

use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use rumqttc::{
    AsyncClient, Event, LastWill, MqttOptions, Packet, QoS, TlsConfiguration, Transport,
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::{Error, Result};
use crate::sessions;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttConnect {
    /// `mqtt://host:1883`, `mqtts://host:8883`, `tcp://…`, `ssl://…` or bare `host:port`.
    pub url: String,
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default = "keep_alive")]
    pub keep_alive_s: u64,
    #[serde(default = "yes")]
    pub clean_session: bool,
    #[serde(default = "yes")]
    pub verify_tls: bool,
    #[serde(default)]
    pub will_topic: String,
    #[serde(default)]
    pub will_payload: String,
    #[serde(default)]
    pub will_qos: u8,
    #[serde(default)]
    pub will_retain: bool,
}

fn keep_alive() -> u64 {
    30
}
fn yes() -> bool {
    true
}

fn qos(n: u8) -> QoS {
    match n {
        1 => QoS::AtLeastOnce,
        2 => QoS::ExactlyOnce,
        _ => QoS::AtMostOnce,
    }
}

fn parse_target(url: &str) -> Result<(String, u16, bool)> {
    let u = url.trim();
    let (tls, rest) = if let Some(r) = u.strip_prefix("mqtts://").or(u.strip_prefix("ssl://")) {
        (true, r)
    } else if let Some(r) = u.strip_prefix("mqtt://").or(u.strip_prefix("tcp://")) {
        (false, r)
    } else {
        (false, u)
    };
    let rest = rest.trim_end_matches('/');
    let (host, port) = match rest.rsplit_once(':') {
        Some((h, p)) => (
            h.to_string(),
            p.parse()
                .map_err(|_| Error::Invalid(format!("bad port `{p}`")))?,
        ),
        None => (rest.to_string(), if tls { 8883 } else { 1883 }),
    };
    if host.is_empty() {
        return Err(Error::Invalid("MQTT host is empty".into()));
    }
    Ok((host, port, tls))
}

pub async fn connect(o: MqttConnect) -> Result<String> {
    let (host, port, tls) = parse_target(&o.url)?;
    let client_id = if o.client_id.trim().is_empty() {
        format!(
            "curlstudio-{}",
            &uuid::Uuid::new_v4().simple().to_string()[..8]
        )
    } else {
        o.client_id.clone()
    };
    let mut opts = MqttOptions::new(client_id.clone(), host.clone(), port);
    opts.set_keep_alive(Duration::from_secs(o.keep_alive_s.max(5)));
    opts.set_clean_session(o.clean_session);
    opts.set_max_packet_size(16 * 1024 * 1024, 16 * 1024 * 1024);
    if !o.username.is_empty() {
        opts.set_credentials(o.username.clone(), o.password.clone());
    }
    if !o.will_topic.is_empty() {
        opts.set_last_will(LastWill::new(
            o.will_topic.clone(),
            o.will_payload.clone().into_bytes(),
            qos(o.will_qos),
            o.will_retain,
        ));
    }
    if tls {
        let cfg = crate::tls::client_config(o.verify_tls, &[]);
        opts.set_transport(Transport::Tls(TlsConfiguration::Rustls(cfg)));
    }
    let (client, mut eventloop) = AsyncClient::new(opts, 256);
    let (session, mut rx) = sessions::create("mqtt");
    let s = session.clone();
    tokio::spawn(async move {
        s.info(format!("Connecting to {host}:{port} as {client_id}"));
        loop {
            tokio::select! {
                cmd = rx.recv() => {
                    let Some(cmd) = cmd else { break };
                    let op = cmd.get("op").and_then(Value::as_str).unwrap_or("");
                    let topic = cmd.get("topic").and_then(Value::as_str).unwrap_or("").to_string();
                    let q = cmd.get("qos").and_then(Value::as_u64).unwrap_or(0) as u8;
                    match op {
                        "subscribe" => match client.subscribe(topic.clone(), qos(q)).await {
                            Ok(()) => s.push("out", "subscribe", topic, json!({"qos": q})),
                            Err(e) => s.error(format!("Subscribe failed: {e}")),
                        },
                        "unsubscribe" => match client.unsubscribe(topic.clone()).await {
                            Ok(()) => s.push("out", "unsubscribe", topic, Value::Null),
                            Err(e) => s.error(format!("Unsubscribe failed: {e}")),
                        },
                        "publish" => {
                            let data = cmd.get("data").and_then(Value::as_str).unwrap_or("").to_string();
                            let retain = cmd.get("retain").and_then(Value::as_bool).unwrap_or(false);
                            let binary = cmd.get("binary").and_then(Value::as_bool).unwrap_or(false);
                            let payload = if binary {
                                match B64.decode(data.trim()) { Ok(b) => b, Err(e) => { s.error(format!("Invalid base64: {e}")); continue; } }
                            } else { data.clone().into_bytes() };
                            match client.publish(topic.clone(), qos(q), retain, payload).await {
                                Ok(()) => s.push("out", "publish", data, json!({"topic": topic, "qos": q, "retain": retain})),
                                Err(e) => s.error(format!("Publish failed: {e}")),
                            }
                        }
                        "close" => {
                            let _ = client.disconnect().await;
                            s.info("Disconnected by client");
                            break;
                        }
                        _ => {}
                    }
                }
                ev = eventloop.poll() => {
                    match ev {
                        Ok(Event::Incoming(Packet::ConnAck(a))) => {
                            s.push("info", "connected", format!("Connected ({:?})", a.code), json!({"sessionPresent": a.session_present}));
                            s.set_state("open");
                        }
                        Ok(Event::Incoming(Packet::Publish(p))) => {
                            let (data, kind) = match std::str::from_utf8(&p.payload) {
                                Ok(t) => (t.to_string(), "text"),
                                Err(_) => (B64.encode(&p.payload), "binary"),
                            };
                            s.push("in", kind, data, json!({
                                "topic": p.topic, "qos": p.qos as u8, "retain": p.retain, "size": p.payload.len()
                            }));
                        }
                        Ok(Event::Incoming(Packet::SubAck(a))) => {
                            s.push("info", "suback", format!("Subscribed (pkid {})", a.pkid), json!({"codes": format!("{:?}", a.return_codes)}));
                        }
                        Ok(Event::Incoming(Packet::Disconnect)) => { s.info("Server disconnected"); break; }
                        Ok(_) => {}
                        Err(e) => {
                            s.error(format!("Connection error: {e}"));
                            break;
                        }
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
    fn targets() {
        assert_eq!(
            parse_target("mqtt://broker:1884").unwrap(),
            ("broker".into(), 1884, false)
        );
        assert_eq!(
            parse_target("mqtts://broker").unwrap(),
            ("broker".into(), 8883, true)
        );
        assert_eq!(
            parse_target("localhost").unwrap(),
            ("localhost".into(), 1883, false)
        );
    }
}
