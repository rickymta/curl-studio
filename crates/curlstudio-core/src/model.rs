//! Wire types shared by the HTTP client, the load engine and the UI.
//!
//! The UI turns a Postman item (auth inheritance, basic/bearer/api-key/OAuth2 headers, GraphQL
//! body, disabled rows) into a [`RequestSpec`]. Only what must happen next to the socket — digest
//! challenge/response, AWS SigV4 over the final body, multipart files — stays in [`Auth`]/[`Body`].

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyValue {
    pub key: String,
    #[serde(default)]
    pub value: String,
}

impl KeyValue {
    pub fn new(k: impl Into<String>, v: impl Into<String>) -> Self {
        Self {
            key: k.into(),
            value: v.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormField {
    pub key: String,
    #[serde(default)]
    pub value: String,
    /// `text` or `file`.
    #[serde(default = "text_kind", rename = "type")]
    pub kind: String,
    /// File paths for `file` fields.
    #[serde(default)]
    pub src: Vec<String>,
    #[serde(default)]
    pub content_type: Option<String>,
}

fn text_kind() -> String {
    "text".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum Body {
    #[default]
    None,
    Raw {
        raw: String,
    },
    Urlencoded {
        fields: Vec<KeyValue>,
    },
    Formdata {
        fields: Vec<FormField>,
    },
    /// Body read from a file at send time.
    Binary {
        path: String,
    },
    /// Body already base64 encoded (e.g. bytes produced by a script).
    Base64 {
        data: String,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Auth {
    #[default]
    None,
    Digest {
        username: String,
        password: String,
    },
    #[serde(rename_all = "camelCase")]
    Awsv4 {
        access_key: String,
        secret_key: String,
        region: String,
        service: String,
        #[serde(default)]
        session_token: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RequestOptions {
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub max_redirects: usize,
    pub verify_tls: bool,
    /// `""` = system proxy, `"none"` = direct, otherwise a proxy URL.
    pub proxy: String,
    /// Force HTTP/1.1 (some servers misbehave on h2).
    pub http1_only: bool,
    /// Send/store cookies through the workspace cookie jar.
    pub cookies: bool,
    /// Largest body returned to the UI; the rest is dropped (size is still reported).
    pub max_body_bytes: usize,
}

impl Default for RequestOptions {
    fn default() -> Self {
        Self {
            timeout_ms: 30_000,
            follow_redirects: true,
            max_redirects: 10,
            verify_tls: true,
            proxy: String::new(),
            http1_only: false,
            cookies: true,
            max_body_bytes: 50 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestSpec {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<KeyValue>,
    #[serde(default)]
    pub body: Body,
    #[serde(default)]
    pub auth: Auth,
    #[serde(default)]
    pub options: RequestOptions,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    /// Building the request (files, signing).
    pub prepare_ms: f64,
    /// Sending until the response head arrived (DNS + connect + TLS + server time).
    pub wait_ms: f64,
    /// Reading the body.
    pub download_ms: f64,
    pub total_ms: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseData {
    pub status: u16,
    pub status_text: String,
    pub http_version: String,
    pub url: String,
    pub headers: Vec<KeyValue>,
    /// UTF-8 text, or base64 when `body_encoding == "base64"`.
    pub body: String,
    pub body_encoding: String,
    pub body_truncated: bool,
    pub size: u64,
    pub headers_size: u64,
    pub timings: Timings,
    pub remote_addr: Option<String>,
    /// What actually went on the wire (after auth/signing), for the console.
    pub request_headers: Vec<KeyValue>,
    pub request_method: String,
    pub request_url: String,
}
