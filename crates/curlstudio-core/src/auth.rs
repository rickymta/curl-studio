//! Auth schemes that must be computed next to the wire: HTTP Digest (RFC 7616) and AWS SigV4.

use hmac::{Hmac, Mac};
use md5::{Digest as _, Md5};
use reqwest::header::HeaderMap;
use sha2::Sha256;

use crate::error::{Error, Result};

fn md5_hex(s: &[u8]) -> String {
    hex::encode(Md5::digest(s))
}

fn sha256_hex(s: &[u8]) -> String {
    hex::encode(Sha256::digest(s))
}

fn parse_challenge(h: &str) -> std::collections::HashMap<String, String> {
    let body = h.trim_start()[6..].trim(); // after "Digest"
    let mut out = std::collections::HashMap::new();
    let mut rest = body;
    while !rest.is_empty() {
        let Some(eq) = rest.find('=') else { break };
        let key = rest[..eq]
            .trim()
            .trim_start_matches(',')
            .trim()
            .to_ascii_lowercase();
        rest = &rest[eq + 1..];
        let value;
        if let Some(r) = rest.strip_prefix('"') {
            let end = r.find('"').unwrap_or(r.len());
            value = r[..end].to_string();
            rest = r.get(end + 1..).unwrap_or("");
        } else {
            let end = rest.find(',').unwrap_or(rest.len());
            value = rest[..end].trim().to_string();
            rest = &rest[end..];
        }
        rest = rest.trim_start_matches([',', ' ']);
        out.insert(key, value);
    }
    out
}

/// Build the `Authorization: Digest …` value for a `WWW-Authenticate` challenge.
pub fn digest_header(
    challenge: &str,
    user: &str,
    pass: &str,
    method: &str,
    uri: &str,
    body: &[u8],
) -> Result<String> {
    let c = parse_challenge(challenge);
    let realm = c.get("realm").cloned().unwrap_or_default();
    let nonce = c
        .get("nonce")
        .cloned()
        .ok_or_else(|| Error::Protocol("digest: no nonce".into()))?;
    let algorithm = c.get("algorithm").cloned().unwrap_or_else(|| "MD5".into());
    let qop_offer = c.get("qop").cloned().unwrap_or_default();
    let qop = if qop_offer.split(',').any(|q| q.trim() == "auth") {
        Some("auth")
    } else if qop_offer.split(',').any(|q| q.trim() == "auth-int") {
        Some("auth-int")
    } else {
        None
    };
    let sha = algorithm.to_ascii_uppercase().starts_with("SHA-256");
    let h = |s: &str| {
        if sha {
            sha256_hex(s.as_bytes())
        } else {
            md5_hex(s.as_bytes())
        }
    };
    let cnonce = hex::encode(rand::random::<[u8; 8]>());
    let nc = "00000001";
    let mut ha1 = h(&format!("{user}:{realm}:{pass}"));
    if algorithm.to_ascii_lowercase().ends_with("-sess") {
        ha1 = h(&format!("{ha1}:{nonce}:{cnonce}"));
    }
    let ha2 = if qop == Some("auth-int") {
        let bh = if sha { sha256_hex(body) } else { md5_hex(body) };
        h(&format!("{method}:{uri}:{bh}"))
    } else {
        h(&format!("{method}:{uri}"))
    };
    let response = match qop {
        Some(q) => h(&format!("{ha1}:{nonce}:{nc}:{cnonce}:{q}:{ha2}")),
        None => h(&format!("{ha1}:{nonce}:{ha2}")),
    };
    let mut out = format!(
        "Digest username=\"{user}\", realm=\"{realm}\", nonce=\"{nonce}\", uri=\"{uri}\", algorithm={algorithm}, response=\"{response}\""
    );
    if let Some(q) = qop {
        out.push_str(&format!(", qop={q}, nc={nc}, cnonce=\"{cnonce}\""));
    }
    if let Some(o) = c.get("opaque") {
        out.push_str(&format!(", opaque=\"{o}\""));
    }
    Ok(out)
}

pub struct AwsCreds<'a> {
    pub access_key: &'a str,
    pub secret_key: &'a str,
    pub region: &'a str,
    pub service: &'a str,
    pub session_token: &'a str,
}

fn hmac(key: &[u8], data: &str) -> Vec<u8> {
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("hmac key");
    m.update(data.as_bytes());
    m.finalize().into_bytes().to_vec()
}

fn uri_encode(s: &str, keep_slash: bool) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b'/' if keep_slash => out.push('/'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Headers to add for AWS Signature Version 4.
pub fn aws_sigv4(
    c: &AwsCreds,
    method: &str,
    url: &url::Url,
    headers: &HeaderMap,
    body: Option<&[u8]>,
    now: chrono::DateTime<chrono::Utc>,
) -> Vec<(String, String)> {
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = now.format("%Y%m%d").to_string();
    let payload_hash = match body {
        Some(b) => sha256_hex(b),
        None if method == "GET" || method == "HEAD" => sha256_hex(b""),
        None => "UNSIGNED-PAYLOAD".to_string(),
    };
    let host = match url.port() {
        Some(p) => format!("{}:{p}", url.host_str().unwrap_or("")),
        None => url.host_str().unwrap_or("").to_string(),
    };
    let mut signed: Vec<(String, String)> = vec![
        ("host".into(), host),
        ("x-amz-date".into(), amz_date.clone()),
        ("x-amz-content-sha256".into(), payload_hash.clone()),
    ];
    if !c.session_token.is_empty() {
        signed.push(("x-amz-security-token".into(), c.session_token.to_string()));
    }
    for (k, v) in headers {
        let k = k.as_str().to_ascii_lowercase();
        if (k == "content-type" || k.starts_with("x-amz-")) && !signed.iter().any(|(n, _)| *n == k)
        {
            signed.push((k, v.to_str().unwrap_or("").trim().to_string()));
        }
    }
    signed.sort_by(|a, b| a.0.cmp(&b.0));
    let canonical_headers: String = signed.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
    let signed_names = signed
        .iter()
        .map(|(k, _)| k.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let mut q: Vec<(String, String)> = url
        .query_pairs()
        .map(|(k, v)| (uri_encode(&k, false), uri_encode(&v, false)))
        .collect();
    q.sort();
    let canonical_query = q
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    let path = if c.service == "s3" {
        url.path().to_string()
    } else {
        // Non-S3 services want the (already encoded) path encoded once more.
        uri_encode(url.path(), true)
    };
    let canonical = format!(
        "{method}\n{}\n{canonical_query}\n{canonical_headers}\n{signed_names}\n{payload_hash}",
        if path.is_empty() { "/" } else { &path }
    );
    let scope = format!("{date}/{}/{}/aws4_request", c.region, c.service);
    let to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        sha256_hex(canonical.as_bytes())
    );
    let k_date = hmac(format!("AWS4{}", c.secret_key).as_bytes(), &date);
    let k_region = hmac(&k_date, c.region);
    let k_service = hmac(&k_region, c.service);
    let k_signing = hmac(&k_service, "aws4_request");
    let signature = hex::encode(hmac(&k_signing, &to_sign));
    let mut out = vec![
        (
            "authorization".to_string(),
            format!(
                "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_names}, Signature={signature}",
                c.access_key
            ),
        ),
        ("x-amz-date".into(), amz_date),
        ("x-amz-content-sha256".into(), payload_hash),
    ];
    if !c.session_token.is_empty() {
        out.push(("x-amz-security-token".into(), c.session_token.to_string()));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_rfc2617_example() {
        // RFC 2617 §3.5 (qop=auth, fixed cnonce is random here, so check structure only).
        let ch = r#"Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41""#;
        let h = digest_header(
            ch,
            "Mufasa",
            "Circle Of Life",
            "GET",
            "/dir/index.html",
            b"",
        )
        .unwrap();
        assert!(h.starts_with("Digest username=\"Mufasa\""));
        assert!(h.contains("qop=auth"));
        assert!(h.contains("opaque=\"5ccc069c403ebaf9f0171e9517f40e41\""));
    }

    #[test]
    fn sigv4_shape() {
        let url = url::Url::parse("https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08")
            .unwrap();
        let now = chrono::DateTime::parse_from_rfc3339("2015-08-30T12:36:00Z")
            .unwrap()
            .to_utc();
        let c = AwsCreds {
            access_key: "AKIDEXAMPLE",
            secret_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            region: "us-east-1",
            service: "iam",
            session_token: "",
        };
        let h = aws_sigv4(&c, "GET", &url, &HeaderMap::new(), None, now);
        let auth = &h[0].1;
        assert!(auth.starts_with(
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request"
        ));
        assert!(auth.contains("SignedHeaders=host;x-amz-content-sha256;x-amz-date"));
    }
}
