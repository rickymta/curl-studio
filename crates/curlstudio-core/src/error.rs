//! One error type for every command. Serialised as `{kind, message}` for the UI.

use serde::Serialize;
use serde::ser::SerializeStruct;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Network(String),
    #[error("timed out: {0}")]
    Timeout(String),
    #[error("cancelled")]
    Cancelled,
    #[error("{0}")]
    Protocol(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

impl Error {
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Invalid(_) => "invalid",
            Error::NotFound(_) => "notFound",
            Error::Network(_) => "network",
            Error::Timeout(_) => "timeout",
            Error::Cancelled => "cancelled",
            Error::Protocol(_) => "protocol",
            Error::Io(_) => "io",
            Error::Json(_) => "json",
        }
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("Error", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

/// Describe a reqwest error with its source chain (reqwest's own Display hides the cause).
pub fn describe(e: &(dyn std::error::Error + 'static)) -> String {
    let mut msg = e.to_string();
    let mut src = e.source();
    while let Some(s) = src {
        let t = s.to_string();
        if !msg.contains(&t) {
            msg.push_str(": ");
            msg.push_str(&t);
        }
        src = s.source();
    }
    msg
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Error::Timeout(describe(&e))
        } else {
            Error::Network(describe(&e))
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
