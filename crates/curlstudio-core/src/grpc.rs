//! Dynamic gRPC client: services come from `.proto` files (compiled in-process by protox) or from
//! server reflection; messages are converted JSON ⇄ protobuf with prost-reflect. Every call kind
//! (unary, server/client streaming, bidi) goes through one streaming path, because the wire
//! format is identical.

use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use prost::Message as _;
use prost_reflect::{
    DescriptorPool, DynamicMessage, FieldDescriptor, Kind, MessageDescriptor, SerializeOptions,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::metadata::{MetadataKey, MetadataMap, MetadataValue};
use tonic::transport::{Channel, ClientTlsConfig, Endpoint};
use tonic::{Code, Status};

use crate::error::{Error, Result};
use crate::model::KeyValue;
use crate::sessions;

// ---- descriptor sources ---------------------------------------------------------------------

fn pools() -> &'static Mutex<HashMap<String, DescriptorPool>> {
    static P: OnceLock<Mutex<HashMap<String, DescriptorPool>>> = OnceLock::new();
    P.get_or_init(Default::default)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MethodInfo {
    pub name: String,
    pub full_name: String,
    pub path: String,
    pub client_streaming: bool,
    pub server_streaming: bool,
    pub input_type: String,
    pub output_type: String,
    pub template: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub name: String,
    pub methods: Vec<MethodInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub source_id: String,
    pub services: Vec<ServiceInfo>,
}

fn describe_pool(source_id: String, pool: &DescriptorPool, only: Option<&HashSet<String>>) -> SourceInfo {
    let mut services: Vec<ServiceInfo> = pool
        .services()
        .filter(|s| only.map(|o| o.contains(s.full_name())).unwrap_or(true))
        .filter(|s| !s.full_name().starts_with("grpc.reflection."))
        .map(|s| ServiceInfo {
            name: s.full_name().to_string(),
            methods: s
                .methods()
                .map(|m| MethodInfo {
                    name: m.name().to_string(),
                    full_name: m.full_name().to_string(),
                    path: format!("/{}/{}", s.full_name(), m.name()),
                    client_streaming: m.is_client_streaming(),
                    server_streaming: m.is_server_streaming(),
                    input_type: m.input().full_name().to_string(),
                    output_type: m.output().full_name().to_string(),
                    template: template(&m.input(), 0),
                })
                .collect(),
        })
        .collect();
    services.sort_by(|a, b| a.name.cmp(&b.name));
    SourceInfo { source_id, services }
}

/// Compile `.proto` files. `includes` defaults to each file's directory.
pub fn load_protos(files: &[String], includes: &[String]) -> Result<SourceInfo> {
    if files.is_empty() {
        return Err(Error::Invalid("pick at least one .proto file".into()));
    }
    let mut inc: Vec<String> = includes.iter().filter(|s| !s.is_empty()).cloned().collect();
    for f in files {
        if let Some(d) = std::path::Path::new(f).parent() {
            let d = d.to_string_lossy().to_string();
            if !inc.contains(&d) {
                inc.push(d);
            }
        }
    }
    let fds = protox::compile(files, &inc).map_err(|e| Error::Invalid(format!("{e}")))?;
    let pool = DescriptorPool::from_file_descriptor_set(fds)
        .map_err(|e| Error::Invalid(format!("descriptor: {e}")))?;
    let id = uuid::Uuid::new_v4().to_string();
    let info = describe_pool(id.clone(), &pool, None);
    pools().lock().unwrap().insert(id, pool);
    Ok(info)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub url: String,
    #[serde(default)]
    pub tls: Option<bool>,
    #[serde(default)]
    pub metadata: Vec<KeyValue>,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
}

fn default_timeout() -> u64 {
    30_000
}

async fn channel(t: &Target) -> Result<Channel> {
    crate::http::init_tls();
    let raw = t.url.trim();
    let (tls, rest) = if let Some(r) = raw.strip_prefix("https://").or(raw.strip_prefix("grpcs://")) {
        (true, r)
    } else if let Some(r) = raw.strip_prefix("http://").or(raw.strip_prefix("grpc://")) {
        (false, r)
    } else {
        (t.tls.unwrap_or(false), raw)
    };
    let tls = t.tls.unwrap_or(tls);
    let uri = format!("{}://{}", if tls { "https" } else { "http" }, rest.trim_end_matches('/'));
    let mut ep = Endpoint::from_shared(uri.clone())
        .map_err(|e| Error::Invalid(format!("gRPC URL `{uri}`: {e}")))?
        .connect_timeout(Duration::from_millis(t.timeout_ms.clamp(1000, 30_000)));
    if tls {
        ep = ep
            .tls_config(ClientTlsConfig::new().with_webpki_roots())
            .map_err(|e| Error::Invalid(format!("tls: {e}")))?;
    }
    ep.connect().await.map_err(|e| Error::Network(crate::error::describe(&e)))
}

fn metadata(list: &[KeyValue]) -> Result<MetadataMap> {
    let mut m = MetadataMap::new();
    for kv in list {
        let k = kv.key.trim().to_ascii_lowercase();
        if k.is_empty() {
            continue;
        }
        if k.ends_with("-bin") {
            let key = MetadataKey::from_bytes(k.as_bytes())
                .map_err(|_| Error::Invalid(format!("metadata key `{k}`")))?;
            let bytes = B64.decode(kv.value.trim()).unwrap_or_else(|_| kv.value.clone().into_bytes());
            m.append_bin(key, MetadataValue::from_bytes(&bytes));
        } else {
            let key = MetadataKey::from_str(&k)
                .map_err(|_| Error::Invalid(format!("metadata key `{k}`")))?;
            let v = MetadataValue::try_from(kv.value.as_str())
                .map_err(|_| Error::Invalid(format!("metadata value for `{k}`")))?;
            m.append(key, v);
        }
    }
    Ok(m)
}

fn metadata_json(m: &MetadataMap) -> Vec<Value> {
    m.clone()
        .into_headers()
        .iter()
        .map(|(k, v)| json!({"key": k.as_str(), "value": String::from_utf8_lossy(v.as_bytes())}))
        .collect()
}

/// List services through server reflection (v1, falling back to v1alpha).
pub async fn reflect(t: Target) -> Result<SourceInfo> {
    let ch = channel(&t).await?;
    match reflect_v1(ch.clone(), &t).await {
        Ok(x) => Ok(x),
        Err(e1) => reflect_v1alpha(ch, &t)
            .await
            .map_err(|e2| Error::Protocol(format!("server reflection failed: {e1}; v1alpha: {e2}"))),
    }
}

macro_rules! reflection_impl {
    ($name:ident, $pb:path) => {
        async fn $name(ch: Channel, t: &Target) -> Result<SourceInfo> {
            use $pb as pb;
            use pb::server_reflection_client::ServerReflectionClient;
            use pb::server_reflection_request::MessageRequest;
            use pb::server_reflection_response::MessageResponse;
            let mut client = ServerReflectionClient::new(ch);
            async fn ask(
                client: &mut ServerReflectionClient<Channel>,
                md: &MetadataMap,
                req: MessageRequest,
            ) -> Result<MessageResponse> {
                let msg = pb::ServerReflectionRequest { host: String::new(), message_request: Some(req) };
                let mut r = tonic::Request::new(tokio_stream::iter(vec![msg]));
                *r.metadata_mut() = md.clone();
                let mut stream = client
                    .server_reflection_info(r)
                    .await
                    .map_err(|s| Error::Protocol(format!("{}: {}", s.code(), s.message())))?
                    .into_inner();
                let resp = stream
                    .message()
                    .await
                    .map_err(|s| Error::Protocol(s.message().to_string()))?
                    .ok_or_else(|| Error::Protocol("empty reflection response".into()))?;
                match resp.message_response {
                    Some(MessageResponse::ErrorResponse(e)) => {
                        Err(Error::Protocol(format!("reflection: {}", e.error_message)))
                    }
                    Some(m) => Ok(m),
                    None => Err(Error::Protocol("empty reflection response".into())),
                }
            }
            let md = metadata(&t.metadata)?;
            let names: Vec<String> =
                match ask(&mut client, &md, MessageRequest::ListServices(String::new())).await? {
                    MessageResponse::ListServicesResponse(l) => l.service.into_iter().map(|s| s.name).collect(),
                    _ => return Err(Error::Protocol("unexpected reflection reply".into())),
                };
            let mut pool = DescriptorPool::global();
            let mut files: HashMap<String, prost_types::FileDescriptorProto> = HashMap::new();
            let mut queue: Vec<MessageRequest> = names
                .iter()
                .filter(|n| !n.starts_with("grpc.reflection."))
                .map(|n| MessageRequest::FileContainingSymbol(n.clone()))
                .collect();
            let mut asked: HashSet<String> = HashSet::new();
            while let Some(req) = queue.pop() {
                let reply = ask(&mut client, &md, req).await?;
                if let MessageResponse::FileDescriptorResponse(fd) = reply {
                    for bytes in fd.file_descriptor_proto {
                        let f = prost_types::FileDescriptorProto::decode(bytes.as_slice())
                            .map_err(|e| Error::Protocol(format!("descriptor: {e}")))?;
                        let name = f.name().to_string();
                        for dep in &f.dependency {
                            if pool.get_file_by_name(dep).is_none()
                                && !files.contains_key(dep)
                                && asked.insert(dep.clone())
                            {
                                queue.push(MessageRequest::FileByFilename(dep.clone()));
                            }
                        }
                        files.entry(name).or_insert(f);
                    }
                }
            }
            let fresh: Vec<_> =
                files.into_values().filter(|f| pool.get_file_by_name(f.name()).is_none()).collect();
            pool.add_file_descriptor_protos(fresh)
                .map_err(|e| Error::Protocol(format!("descriptor: {e}")))?;
            let only: HashSet<String> = names.into_iter().collect();
            let id = uuid::Uuid::new_v4().to_string();
            let info = describe_pool(id.clone(), &pool, Some(&only));
            pools().lock().unwrap().insert(id, pool);
            Ok(info)
        }
    };
}

reflection_impl!(reflect_v1, tonic_reflection::pb::v1);
reflection_impl!(reflect_v1alpha, tonic_reflection::pb::v1alpha);

// ---- JSON template --------------------------------------------------------------------------

fn field_example(f: &FieldDescriptor, depth: usize) -> Value {
    let one = match f.kind() {
        Kind::Double | Kind::Float => json!(0.0),
        Kind::Int32 | Kind::Sint32 | Kind::Sfixed32 | Kind::Uint32 | Kind::Fixed32 => json!(0),
        // 64-bit integers are strings in proto3 JSON.
        Kind::Int64 | Kind::Sint64 | Kind::Sfixed64 | Kind::Uint64 | Kind::Fixed64 => json!("0"),
        Kind::Bool => json!(false),
        Kind::String => json!(""),
        Kind::Bytes => json!(""),
        Kind::Enum(e) => json!(e.values().next().map(|v| v.name().to_string()).unwrap_or_default()),
        Kind::Message(m) => {
            if f.is_map() {
                let v = m.map_entry_value_field();
                return json!({ "key": field_example(&v, depth + 1) });
            }
            template(&m, depth + 1)
        }
    };
    if f.is_list() { json!([one]) } else { one }
}

/// Example JSON body for a message type (depth-limited for recursive types).
pub fn template(m: &MessageDescriptor, depth: usize) -> Value {
    match m.full_name() {
        "google.protobuf.Timestamp" => return json!("1970-01-01T00:00:00Z"),
        "google.protobuf.Duration" => return json!("1s"),
        "google.protobuf.Struct" | "google.protobuf.Value" => return json!({}),
        "google.protobuf.Empty" => return json!({}),
        n if n.starts_with("google.protobuf.") && n.ends_with("Value") => return Value::Null,
        _ => {}
    }
    if depth > 3 {
        return json!({});
    }
    let mut obj = serde_json::Map::new();
    for f in m.fields() {
        if f.containing_oneof().is_some()
            && f.containing_oneof().map(|o| o.fields().next().map(|x| x.number()) != Some(f.number())).unwrap_or(false)
        {
            continue; // only the first member of each oneof
        }
        obj.insert(f.json_name().to_string(), field_example(&f, depth));
    }
    Value::Object(obj)
}

// ---- dynamic codec --------------------------------------------------------------------------

#[derive(Clone)]
struct DynCodec(MessageDescriptor);
struct DynEncoder;
struct DynDecoder(MessageDescriptor);

impl Encoder for DynEncoder {
    type Item = DynamicMessage;
    type Error = Status;
    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> std::result::Result<(), Status> {
        item.encode(dst).map_err(|e| Status::internal(e.to_string()))
    }
}

impl Decoder for DynDecoder {
    type Item = DynamicMessage;
    type Error = Status;
    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> std::result::Result<Option<Self::Item>, Status> {
        let mut m = DynamicMessage::new(self.0.clone());
        m.merge(src).map_err(|e| Status::internal(e.to_string()))?;
        Ok(Some(m))
    }
}

impl Codec for DynCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynEncoder;
    type Decoder = DynDecoder;
    fn encoder(&mut self) -> Self::Encoder {
        DynEncoder
    }
    fn decoder(&mut self) -> Self::Decoder {
        DynDecoder(self.0.clone())
    }
}

fn to_json(m: &DynamicMessage) -> String {
    let mut out = Vec::new();
    let mut ser = serde_json::Serializer::pretty(&mut out);
    let opts = SerializeOptions::new().skip_default_fields(false).stringify_64_bit_integers(true);
    match m.serialize_with_options(&mut ser, &opts) {
        Ok(()) => String::from_utf8_lossy(&out).to_string(),
        Err(e) => format!("<unserialisable: {e}>"),
    }
}

fn from_json(desc: &MessageDescriptor, text: &str) -> Result<DynamicMessage> {
    let text = if text.trim().is_empty() { "{}" } else { text };
    let mut de = serde_json::Deserializer::from_str(text);
    let m = DynamicMessage::deserialize(desc.clone(), &mut de)
        .map_err(|e| Error::Invalid(format!("message does not match {}: {e}", desc.full_name())))?;
    de.end().map_err(|e| Error::Invalid(e.to_string()))?;
    Ok(m)
}

fn status_name(c: Code) -> String {
    format!("{c:?}")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invoke {
    pub source_id: String,
    /// `/pkg.Service/Method` or `pkg.Service.Method`.
    pub method: String,
    #[serde(flatten)]
    pub target: Target,
    /// JSON messages sent right away.
    #[serde(default)]
    pub messages: Vec<String>,
    /// Keep the request stream open for later `send` commands (client/bidi streaming).
    #[serde(default)]
    pub keep_open: bool,
}

fn find_method(pool: &DescriptorPool, name: &str) -> Result<prost_reflect::MethodDescriptor> {
    let norm = name.trim().trim_start_matches('/').replace('/', ".");
    for s in pool.services() {
        for m in s.methods() {
            if m.full_name() == norm {
                return Ok(m);
            }
        }
    }
    Err(Error::NotFound(format!("method {name}")))
}

pub async fn invoke(req: Invoke) -> Result<String> {
    let pool = pools()
        .lock()
        .unwrap()
        .get(&req.source_id)
        .cloned()
        .ok_or_else(|| Error::NotFound("proto source (reload the .proto files)".into()))?;
    let method = find_method(&pool, &req.method)?;
    let input = method.input();
    let first: Vec<DynamicMessage> =
        req.messages.iter().map(|m| from_json(&input, m)).collect::<Result<_>>()?;
    let md = metadata(&req.target.metadata)?;
    let ch = channel(&req.target).await?;
    let path = http::uri::PathAndQuery::from_str(&format!(
        "/{}/{}",
        method.parent_service().full_name(),
        method.name()
    ))
    .map_err(|e| Error::Invalid(e.to_string()))?;
    let (session, mut rx) = sessions::create("grpc");
    let s = session.clone();
    let (tx_msgs, rx_msgs) = tokio::sync::mpsc::unbounded_channel::<DynamicMessage>();
    for m in first {
        s.push("out", "message", to_json(&m), Value::Null);
        let _ = tx_msgs.send(m);
    }
    let keep_open = req.keep_open && method.is_client_streaming();
    let mut tx_holder = if keep_open { Some(tx_msgs) } else { None };
    let timeout = req.target.timeout_ms;
    let output = method.output();
    tokio::spawn(async move {
        let started = std::time::Instant::now();
        let mut grpc = tonic::client::Grpc::new(ch);
        if let Err(e) = grpc.ready().await {
            s.error(format!("Channel not ready: {e}"));
            s.set_state("closed");
            return;
        }
        s.set_state("open");
        let stream = tokio_stream::wrappers::UnboundedReceiverStream::new(rx_msgs);
        let mut request = tonic::Request::new(stream);
        *request.metadata_mut() = md;
        if timeout > 0 && !keep_open {
            request.set_timeout(Duration::from_millis(timeout));
        }
        let call = grpc.streaming(request, path, DynCodec(output));
        tokio::pin!(call);
        // Accept `send`/`end` commands while the call is being set up.
        let resp = loop {
            tokio::select! {
                r = &mut call => break r,
                cmd = rx.recv() => {
                    if !handle_cmd(&s, cmd, &input, &mut tx_holder) { s.set_state("closed"); return; }
                }
            }
        };
        let mut streaming = match resp {
            Ok(r) => {
                s.push("info", "headers", "Response headers", json!({"headers": metadata_json(r.metadata())}));
                r.into_inner()
            }
            Err(st) => {
                finish_status(&s, &st, started);
                return;
            }
        };
        loop {
            tokio::select! {
                m = streaming.message() => match m {
                    Ok(Some(msg)) => s.push("in", "message", to_json(&msg), json!({"elapsedMs": started.elapsed().as_millis() as u64})),
                    Ok(None) => {
                        let trailers = streaming.trailers().await.ok().flatten();
                        s.push("info", "status", "OK", json!({
                            "code": 0, "codeName": "Ok",
                            "elapsedMs": started.elapsed().as_millis() as u64,
                            "trailers": trailers.as_ref().map(metadata_json).unwrap_or_default()
                        }));
                        break;
                    }
                    Err(st) => { finish_status(&s, &st, started); return; }
                },
                cmd = rx.recv() => {
                    if !handle_cmd(&s, cmd, &input, &mut tx_holder) { break; }
                }
            }
        }
        s.set_state("closed");
    });
    Ok(session.id)
}

/// Returns false when the session should stop.
fn handle_cmd(
    s: &sessions::Session,
    cmd: Option<Value>,
    input: &MessageDescriptor,
    tx: &mut Option<tokio::sync::mpsc::UnboundedSender<DynamicMessage>>,
) -> bool {
    let Some(cmd) = cmd else { return false };
    match cmd.get("op").and_then(Value::as_str).unwrap_or("") {
        "send" => {
            let text = cmd.get("data").and_then(Value::as_str).unwrap_or("{}");
            match (from_json(input, text), tx.as_ref()) {
                (Ok(m), Some(t)) => {
                    s.push("out", "message", to_json(&m), Value::Null);
                    let _ = t.send(m);
                }
                (Ok(_), None) => s.error("The request stream is already closed"),
                (Err(e), _) => s.error(e.to_string()),
            }
            true
        }
        "end" => {
            *tx = None;
            s.info("Request stream ended");
            true
        }
        "close" => {
            s.info("Cancelled by client");
            false
        }
        _ => true,
    }
}

fn finish_status(s: &sessions::Session, st: &Status, started: std::time::Instant) {
    s.push(
        "error",
        "status",
        format!("{}: {}", status_name(st.code()), st.message()),
        json!({
            "code": st.code() as i32,
            "codeName": status_name(st.code()),
            "message": st.message(),
            "elapsedMs": started.elapsed().as_millis() as u64,
            "trailers": metadata_json(st.metadata()),
        }),
    );
    s.set_state("closed");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_proto_and_builds_template() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("greet.proto");
        std::fs::write(
            &p,
            r#"syntax = "proto3";
package demo;
import "google/protobuf/timestamp.proto";
enum Mood { HAPPY = 0; SAD = 1; }
message Hello { string name = 1; repeated int64 ids = 2; Mood mood = 3; map<string, int32> tags = 4; google.protobuf.Timestamp at = 5; }
message Reply { string text = 1; }
service Greeter { rpc Say(Hello) returns (Reply); rpc Chat(stream Hello) returns (stream Reply); }
"#,
        )
        .unwrap();
        let info = load_protos(&[p.to_string_lossy().to_string()], &[]).unwrap();
        assert_eq!(info.services.len(), 1);
        let say = &info.services[0].methods[0];
        assert_eq!(say.path, "/demo.Greeter/Say");
        assert_eq!(say.template["ids"], json!(["0"]));
        assert_eq!(say.template["mood"], json!("HAPPY"));
        assert!(info.services[0].methods[1].client_streaming);
        let pool = pools().lock().unwrap().get(&info.source_id).cloned().unwrap();
        let m = find_method(&pool, "demo.Greeter/Say").unwrap();
        let msg = from_json(&m.input(), r#"{"name":"x","ids":["5"]}"#).unwrap();
        assert!(to_json(&msg).contains("\"name\": \"x\""));
    }
}
