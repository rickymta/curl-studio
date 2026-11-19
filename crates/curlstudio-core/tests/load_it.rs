//! End-to-end: a local axum server, the HTTP client and the load engine.

use std::time::Duration;

use axum::Router;
use axum::routing::{get, post};
use serde_json::{Value, json};

async fn server() -> String {
    let app = Router::new()
        .route(
            "/login",
            post(|| async { axum::Json(json!({"token": "abc123"})) }),
        )
        .route(
            "/items",
            get(|headers: axum::http::HeaderMap| async move {
                let ok = headers
                    .get("authorization")
                    .map(|v| v == "Bearer abc123")
                    .unwrap_or(false);
                if ok {
                    (
                        axum::http::StatusCode::OK,
                        axum::Json(json!({"items": [1, 2, 3]})),
                    )
                } else {
                    (
                        axum::http::StatusCode::UNAUTHORIZED,
                        axum::Json(json!({"error": "no"})),
                    )
                }
            }),
        );
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    format!("http://{addr}")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn http_send_and_load_run() {
    let dir = tempfile::tempdir().unwrap();
    curlstudio_core::store::set_root(dir.path().to_path_buf());
    let base = server().await;

    let r = curlstudio_core::dispatch(
        "http.send",
        json!({"spec": {"method": "POST", "url": format!("{base}/login"), "body": {"mode": "raw", "raw": "{}"}}}),
    )
    .await
    .unwrap();
    assert_eq!(r["status"], 200);
    assert!(r["body"].as_str().unwrap().contains("abc123"));

    let scenario = json!({
        "name": "login flow",
        "variables": [{"key": "base", "value": base}],
        "profile": {"executor": "rampingVus", "startVus": 2, "stages": [{"durationS": 2.0, "target": 4.0}], "gracefulStopS": 5},
        "options": {"thinkMaxMs": 20},
        "steps": [
            {"id": "s1", "name": "Login", "request": {"method": "POST", "url": "{{base}}/login"},
             "extract": [{"var": "token", "source": "jsonpath", "path": "$.token"}],
             "checks": [{"source": "status", "op": "eq", "value": "200"}]},
            {"id": "s2", "name": "Items", "request": {"method": "GET", "url": "{{base}}/items",
              "headers": [{"key": "Authorization", "value": "Bearer {{token}}"}]},
             "checks": [{"name": "has items", "source": "jsonpath", "path": "items[2]", "op": "eq", "value": "3"}]}
        ],
        "thresholds": [
            {"metric": "http_req_failed", "stat": "rate", "op": "<", "value": 0.01},
            {"metric": "http_req_duration", "stat": "p(95)", "op": "<", "value": 1000},
            {"metric": "checks", "stat": "rate", "op": ">", "value": 0.99}
        ]
    });
    let dbg = curlstudio_core::dispatch("load.debug", json!({"scenario": scenario}))
        .await
        .unwrap();
    assert_eq!(dbg["steps"][1]["status"], 200, "{dbg}");
    assert_eq!(dbg["steps"][0]["extracted"]["token"], "abc123");

    let id = curlstudio_core::dispatch("load.start", json!({"scenario": scenario}))
        .await
        .unwrap();
    let id = id.as_str().unwrap().to_string();
    let mut last: Value = Value::Null;
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(200)).await;
        last = curlstudio_core::dispatch("load.status", json!({"id": id}))
            .await
            .unwrap();
        if last["done"] == true {
            break;
        }
    }
    assert_eq!(last["done"], true, "run did not finish: {last}");
    let run = &last["run"];
    let s = &run["summary"];
    assert!(s["requests"].as_u64().unwrap() > 10, "{s}");
    assert_eq!(s["failures"], 0, "{s}");
    assert_eq!(s["verdict"], "passed", "{}", s["thresholds"]);
    assert_eq!(s["steps"].as_array().unwrap().len(), 2);
    assert!(run["timeline"].as_array().unwrap().len() >= 2);
    // Saved to the store.
    let saved = curlstudio_core::dispatch("store.get", json!({"kind": "loadRuns", "id": id}))
        .await
        .unwrap();
    assert_eq!(saved["id"], id);
}
