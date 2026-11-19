//! Declarative checks and extractors evaluated against a response (no scripting on the hot path).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde_json::Value;

use super::model::{Extractor, Rule};

/// What a rule can look at.
pub struct Observed<'a> {
    pub status: u16,
    pub duration_ms: f64,
    pub size: u64,
    pub headers: &'a [(String, String)],
    pub body: &'a str,
    json: OnceLock<Option<Value>>,
}

impl<'a> Observed<'a> {
    pub fn new(
        status: u16,
        duration_ms: f64,
        size: u64,
        headers: &'a [(String, String)],
        body: &'a str,
    ) -> Self {
        Self {
            status,
            duration_ms,
            size,
            headers,
            body,
            json: OnceLock::new(),
        }
    }

    fn json(&self) -> Option<&Value> {
        self.json
            .get_or_init(|| serde_json::from_str(self.body).ok())
            .as_ref()
    }

    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

fn regex_cached(p: &str) -> Option<regex::Regex> {
    static C: OnceLock<Mutex<HashMap<String, Option<regex::Regex>>>> = OnceLock::new();
    let m = C.get_or_init(Default::default);
    let mut g = m.lock().unwrap();
    if g.len() > 512 {
        g.clear();
    }
    g.entry(p.to_string())
        .or_insert_with(|| regex::Regex::new(p).ok())
        .clone()
}

fn normalise_path(p: &str) -> String {
    let p = p.trim();
    if p.starts_with('$') {
        p.to_string()
    } else if p.starts_with('[') {
        format!("${p}")
    } else {
        format!("$.{p}")
    }
}

/// JSONPath query → first match.
pub fn json_query(v: &Value, path: &str) -> Option<Value> {
    let path = serde_json_path::JsonPath::parse(&normalise_path(path)).ok()?;
    path.query(v).first().cloned()
}

fn as_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        other => other.to_string(),
    }
}

fn status_in(status: u16, spec: &str) -> bool {
    spec.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .any(|part| {
            if let Some((a, b)) = part.split_once('-') {
                match (a.trim().parse::<u16>(), b.trim().parse::<u16>()) {
                    (Ok(a), Ok(b)) => (a..=b).contains(&status),
                    _ => false,
                }
            } else if part.len() == 3 && part.ends_with("xx") {
                part.as_bytes()[0] - b'0' == (status / 100) as u8
            } else {
                part.parse::<u16>().map(|c| c == status).unwrap_or(false)
            }
        })
}

/// True when `status` is in the expected list (default `200-399`).
pub fn expected(status: u16, spec: &str) -> bool {
    if spec.trim().is_empty() {
        return (200..400).contains(&status);
    }
    status_in(status, spec)
}

fn compare(actual: Option<&str>, op: &str, expected: &str) -> bool {
    let num = |s: &str| s.trim().parse::<f64>().ok();
    match op {
        "exists" => actual.is_some(),
        "notExists" => actual.is_none(),
        _ => {
            let Some(a) = actual else { return false };
            match op {
                "eq" => {
                    a == expected || matches!((num(a), num(expected)), (Some(x), Some(y)) if x == y)
                }
                "neq" => a != expected,
                "contains" => a.contains(expected),
                "notContains" => !a.contains(expected),
                "matches" => regex_cached(expected)
                    .map(|r| r.is_match(a))
                    .unwrap_or(false),
                "in" => expected.split(',').any(|e| e.trim() == a),
                "lt" | "lte" | "gt" | "gte" => match (num(a), num(expected)) {
                    (Some(x), Some(y)) => match op {
                        "lt" => x < y,
                        "lte" => x <= y,
                        "gt" => x > y,
                        _ => x >= y,
                    },
                    _ => false,
                },
                _ => false,
            }
        }
    }
}

/// Default display name for a rule without one.
pub fn rule_name(r: &Rule) -> String {
    if !r.name.trim().is_empty() {
        return r.name.clone();
    }
    let what = match r.source.as_str() {
        "jsonpath" | "header" | "regex" => format!("{} {}", r.source, r.path),
        s => s.to_string(),
    };
    if matches!(r.op.as_str(), "exists" | "notExists") {
        format!("{what} {}", r.op)
    } else {
        format!("{what} {} {}", r.op, r.value)
    }
}

pub fn check(r: &Rule, o: &Observed) -> bool {
    match r.source.as_str() {
        "status" => {
            if r.op == "in" || r.op == "eq" && (r.value.contains('-') || r.value.contains('x')) {
                status_in(o.status, &r.value)
            } else {
                compare(Some(&o.status.to_string()), &r.op, &r.value)
            }
        }
        "duration" => compare(Some(&format!("{}", o.duration_ms)), &r.op, &r.value),
        "size" => compare(Some(&o.size.to_string()), &r.op, &r.value),
        "body" => compare(Some(o.body), &r.op, &r.value),
        "header" => compare(o.header(&r.path), &r.op, &r.value),
        "jsonpath" => {
            let v = o
                .json()
                .and_then(|j| json_query(j, &r.path))
                .map(|v| as_text(&v));
            compare(v.as_deref(), &r.op, &r.value)
        }
        "regex" => {
            let m = regex_cached(&r.path).and_then(|re| {
                re.captures(o.body)
                    .map(|c| c.get(1).or(c.get(0)).map(|m| m.as_str().to_string()))
            });
            compare(
                m.flatten().as_deref(),
                if r.op.is_empty() { "exists" } else { &r.op },
                &r.value,
            )
        }
        _ => false,
    }
}

pub fn extract(e: &Extractor, o: &Observed) -> Option<String> {
    let v = match e.source.as_str() {
        "status" => Some(o.status.to_string()),
        "body" => Some(o.body.to_string()),
        "header" => o.header(&e.path).map(str::to_string),
        "jsonpath" => o
            .json()
            .and_then(|j| json_query(j, &e.path))
            .map(|v| as_text(&v)),
        "regex" => regex_cached(&e.path).and_then(|re| {
            re.captures(o.body)
                .and_then(|c| c.get(1).or(c.get(0)))
                .map(|m| m.as_str().to_string())
        }),
        "cookie" => o
            .headers
            .iter()
            .filter(|(k, _)| k.eq_ignore_ascii_case("set-cookie"))
            .filter_map(|(_, v)| v.split(';').next())
            .filter_map(|kv| kv.split_once('='))
            .find(|(k, _)| k.trim() == e.path)
            .map(|(_, v)| v.trim().to_string()),
        _ => None,
    };
    v.or_else(|| (!e.default.is_empty()).then(|| e.default.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(source: &str, path: &str, op: &str, value: &str) -> Rule {
        Rule {
            name: String::new(),
            source: source.into(),
            path: path.into(),
            op: op.into(),
            value: value.into(),
            enabled: true,
        }
    }

    #[test]
    fn evaluates_rules() {
        let h = vec![("Content-Type".to_string(), "application/json".to_string())];
        let body = r#"{"data":{"items":[{"id":7,"name":"a"}],"token":"xyz"}}"#;
        let o = Observed::new(201, 120.0, 60, &h, body);
        assert!(check(&rule("status", "", "in", "200,201"), &o));
        assert!(check(&rule("status", "", "eq", "2xx"), &o));
        assert!(!check(&rule("status", "", "eq", "200"), &o));
        assert!(check(&rule("duration", "", "lt", "500"), &o));
        assert!(check(&rule("jsonpath", "data.items[0].id", "eq", "7"), &o));
        assert!(check(
            &rule("jsonpath", "$.data.missing", "notExists", ""),
            &o
        ));
        assert!(check(
            &rule("header", "content-type", "contains", "json"),
            &o
        ));
        assert!(check(&rule("body", "", "contains", "token"), &o));
        let ex = Extractor {
            var: "t".into(),
            source: "jsonpath".into(),
            path: "$.data.token".into(),
            default: String::new(),
        };
        assert_eq!(extract(&ex, &o).as_deref(), Some("xyz"));
        let rx = Extractor {
            var: "id".into(),
            source: "regex".into(),
            path: r#""id":(\d+)"#.into(),
            default: String::new(),
        };
        assert_eq!(extract(&rx, &o).as_deref(), Some("7"));
        assert!(expected(302, "200-399"));
        assert!(!expected(404, ""));
    }
}
