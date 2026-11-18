//! CurlStudio core: everything the UI calls goes through [`dispatch`], so the Tauri shell and the
//! dev HTTP bridge share one command surface.

pub mod auth;
pub mod cookies;
pub mod error;
pub mod grpc;
pub mod http;
pub mod load;
pub mod model;
pub mod mqtt;
pub mod sessions;
pub mod sse;
pub mod store;
pub mod tls;
pub mod vars;
pub mod ws;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

pub use error::{Error, Result};

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T> {
    let v = args.get(key).cloned().unwrap_or(Value::Null);
    serde_json::from_value(v).map_err(|e| Error::Invalid(format!("argument `{key}`: {e}")))
}

fn opt<T: DeserializeOwned>(args: &Value, key: &str) -> Result<Option<T>> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => serde_json::from_value(v.clone())
            .map(Some)
            .map_err(|e| Error::Invalid(format!("argument `{key}`: {e}"))),
    }
}

fn done() -> Result<Value> {
    Ok(Value::Null)
}

/// Run one UI command. `args` is a JSON object; the result is JSON.
pub async fn dispatch(cmd: &str, args: Value) -> Result<Value> {
    let a = &args;
    Ok(match cmd {
        // ---- app / files ----
        "app.info" => json!({
            "version": env!("CARGO_PKG_VERSION"),
            "dataDir": store::root().to_string_lossy(),
            "os": std::env::consts::OS,
        }),
        "fs.readText" => {
            let p: String = arg(a, "path")?;
            json!(tokio::fs::read_to_string(&p).await.map_err(|e| Error::Invalid(format!("{p}: {e}")))?)
        }
        "fs.writeText" => {
            let p: String = arg(a, "path")?;
            let text: String = arg(a, "text")?;
            tokio::fs::write(&p, text).await?;
            return done();
        }
        "fs.readBase64" => {
            let p: String = arg(a, "path")?;
            let data = tokio::fs::read(&p).await.map_err(|e| Error::Invalid(format!("{p}: {e}")))?;
            json!({ "data": B64.encode(&data), "size": data.len() })
        }
        "fs.writeBase64" => {
            let p: String = arg(a, "path")?;
            let data: String = arg(a, "data")?;
            let bytes = B64.decode(data.trim()).map_err(|e| Error::Invalid(e.to_string()))?;
            tokio::fs::write(&p, bytes).await?;
            return done();
        }

        // ---- workspace store ----
        "store.list" => {
            let omit: Vec<String> = opt(a, "omit")?.unwrap_or_default();
            json!(store::list(&arg::<String>(a, "kind")?, &omit)?)
        }
        "store.get" => store::get(&arg::<String>(a, "kind")?, &arg::<String>(a, "id")?)?,
        "store.put" => {
            store::put(&arg::<String>(a, "kind")?, &arg::<String>(a, "id")?, &arg::<Value>(a, "doc")?)?;
            return done();
        }
        "store.delete" => {
            store::delete(&arg::<String>(a, "kind")?, &arg::<String>(a, "id")?)?;
            return done();
        }
        "store.getDoc" => store::get_doc(&arg::<String>(a, "name")?)?,
        "store.putDoc" => {
            store::put_doc(&arg::<String>(a, "name")?, &arg::<Value>(a, "doc")?)?;
            return done();
        }

        // ---- HTTP ----
        "http.send" => serde_json::to_value(http::send(opt(a, "id")?, arg(a, "spec")?).await?)?,
        "http.cancel" => json!(http::cancel(&arg::<String>(a, "id")?)),
        "http.download" => {
            json!(http::download(&arg::<String>(a, "path")?, arg(a, "spec")?).await?)
        }

        // ---- cookies ----
        "cookies.list" => serde_json::to_value(cookies::list())?,
        "cookies.remove" => {
            cookies::remove(
                &arg::<String>(a, "domain")?,
                &arg::<String>(a, "path")?,
                &arg::<String>(a, "name")?,
            )?;
            return done();
        }
        "cookies.clear" => {
            cookies::clear(opt::<String>(a, "domain")?.as_deref())?;
            return done();
        }
        "cookies.set" => {
            cookies::set(&arg::<String>(a, "domain")?, &arg::<String>(a, "cookie")?)?;
            return done();
        }

        // ---- streaming protocols ----
        "ws.connect" => json!(ws::connect(arg(a, "opts")?).await?),
        "sse.connect" => json!(sse::connect(arg(a, "spec")?).await?),
        "mqtt.connect" => json!(mqtt::connect(arg(a, "opts")?).await?),
        "session.poll" => {
            sessions::poll(&arg::<String>(a, "id")?, opt::<u64>(a, "since")?.unwrap_or(0))?
        }
        "session.command" => {
            sessions::command(&arg::<String>(a, "id")?, arg(a, "cmd")?)?;
            return done();
        }
        "session.close" => {
            sessions::dispose(&arg::<String>(a, "id")?);
            return done();
        }

        // ---- gRPC ----
        "grpc.loadProtos" => serde_json::to_value(grpc::load_protos(
            &arg::<Vec<String>>(a, "files")?,
            &opt::<Vec<String>>(a, "includes")?.unwrap_or_default(),
        )?)?,
        "grpc.reflect" => serde_json::to_value(grpc::reflect(arg(a, "target")?).await?)?,
        "grpc.invoke" => json!(grpc::invoke(arg(a, "req")?).await?),

        // ---- load testing ----
        "load.start" => json!(load::start(
            arg(a, "scenario")?,
            opt::<Value>(a, "meta")?.unwrap_or(Value::Null)
        )?),
        "load.status" => load::status(&arg::<String>(a, "id")?, opt(a, "since")?)?,
        "load.stop" => {
            load::stop(&arg::<String>(a, "id")?, opt::<bool>(a, "hard")?.unwrap_or(false))?;
            return done();
        }
        "load.debug" => load::debug(arg(a, "scenario")?).await?,
        "load.active" => json!(load::engine::active()),
        "load.forget" => {
            load::engine::forget(&arg::<String>(a, "id")?);
            return done();
        }

        _ => return Err(Error::Invalid(format!("unknown command `{cmd}`"))),
    })
}
