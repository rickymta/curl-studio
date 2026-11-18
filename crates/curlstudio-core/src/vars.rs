//! `{{variable}}` substitution and Postman dynamic variables (`{{$guid}}`, `{{$randomInt}}`, …).
//!
//! The UI resolves interactive requests itself; the load engine resolves per iteration here so
//! data rows, extracted values and dynamic variables differ for every virtual user.

use std::collections::HashMap;

use rand::Rng;
use rand::seq::IndexedRandom;

use crate::model::{Body, KeyValue, RequestSpec};

const FIRST: &[&str] = &[
    "Ava", "Liam", "Mia", "Noah", "Emma", "Lucas", "Lan", "Minh", "Sofia", "Kai", "Hana", "Leo",
];
const LAST: &[&str] = &["Nguyen", "Smith", "Tran", "Garcia", "Kim", "Le", "Brown", "Pham", "Ito"];
const WORDS: &[&str] = &[
    "alpha", "bravo", "cobalt", "delta", "ember", "falcon", "glacier", "harbor", "indigo", "jade",
];
const DOMAINS: &[&str] = &["example.com", "example.net", "example.org", "test.dev"];
const COLORS: &[&str] = &["red", "green", "blue", "orange", "purple", "teal", "black", "white"];

/// Value of a Postman dynamic variable (`name` without the `$`), or `None` if unknown.
pub fn dynamic(name: &str) -> Option<String> {
    let mut r = rand::rng();
    let now = chrono::Utc::now();
    Some(match name {
        "guid" | "randomUUID" => uuid::Uuid::new_v4().to_string(),
        "timestamp" => now.timestamp().to_string(),
        "isoTimestamp" => now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        "randomInt" => r.random_range(0..=1000).to_string(),
        "randomBoolean" => r.random_bool(0.5).to_string(),
        "randomFirstName" => FIRST.choose(&mut r)?.to_string(),
        "randomLastName" => LAST.choose(&mut r)?.to_string(),
        "randomFullName" => {
            format!("{} {}", FIRST.choose(&mut r)?, LAST.choose(&mut r)?)
        }
        "randomUserName" => format!(
            "{}{}",
            FIRST.choose(&mut r)?.to_lowercase(),
            r.random_range(10..9999)
        ),
        "randomEmail" | "randomExampleEmail" => format!(
            "{}.{}@{}",
            FIRST.choose(&mut r)?.to_lowercase(),
            LAST.choose(&mut r)?.to_lowercase(),
            DOMAINS.choose(&mut r)?
        ),
        "randomWord" | "randomNoun" | "randomAdjective" => WORDS.choose(&mut r)?.to_string(),
        "randomWords" => (0..3)
            .filter_map(|_| WORDS.choose(&mut r).map(|s| s.to_string()))
            .collect::<Vec<_>>()
            .join(" "),
        "randomColor" => COLORS.choose(&mut r)?.to_string(),
        "randomHexColor" => format!("#{:06x}", r.random_range(0..0xFFFFFF)),
        "randomIP" => format!(
            "{}.{}.{}.{}",
            r.random_range(1..255),
            r.random_range(0..255),
            r.random_range(0..255),
            r.random_range(1..255)
        ),
        "randomPhoneNumber" => format!(
            "{:03}-{:03}-{:04}",
            r.random_range(200..999),
            r.random_range(100..999),
            r.random_range(0..9999)
        ),
        "randomPrice" => format!("{:.2}", r.random_range(1.0..1000.0)),
        "randomAlphaNumeric" => {
            let c = b"abcdefghijklmnopqrstuvwxyz0123456789";
            (c[r.random_range(0..c.len())] as char).to_string()
        }
        "randomUrl" => format!("https://{}.{}", WORDS.choose(&mut r)?, DOMAINS.choose(&mut r)?),
        "randomCity" => ["Hanoi", "Tokyo", "Berlin", "Lima", "Oslo"].choose(&mut r)?.to_string(),
        "randomCountry" => ["Vietnam", "Japan", "Germany", "Peru"].choose(&mut r)?.to_string(),
        "randomCompanyName" => format!("{} Labs", WORDS.choose(&mut r)?),
        "randomLoremSentence" => "Lorem ipsum dolor sit amet, consectetur adipiscing elit.".into(),
        _ => return None,
    })
}

/// Replace every `{{name}}`. Unknown names are left untouched (Postman behaviour).
pub fn resolve(input: &str, lookup: &dyn Fn(&str) -> Option<String>) -> String {
    if !input.contains("{{") {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    // Nested references (a value containing `{{x}}`) get a few more passes.
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("}}") {
            Some(end) => {
                let name = after[..end].trim();
                let value = if let Some(d) = name.strip_prefix('$') {
                    dynamic(d)
                } else {
                    lookup(name)
                };
                match value {
                    Some(v) => out.push_str(&v),
                    None => {
                        out.push_str("{{");
                        out.push_str(&after[..end]);
                        out.push_str("}}");
                    }
                }
                rest = &after[end + 2..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// Resolve with nested passes (max 5) so `{{base}}` → `{{host}}/v1` → `https://x/v1` works.
pub fn resolve_deep(input: &str, vars: &HashMap<String, String>) -> String {
    let lookup = |k: &str| vars.get(k).cloned();
    let mut cur = resolve(input, &lookup);
    for _ in 0..4 {
        if !cur.contains("{{") {
            break;
        }
        let next = resolve(&cur, &lookup);
        if next == cur {
            break;
        }
        cur = next;
    }
    cur
}

fn kv(list: &[KeyValue], vars: &HashMap<String, String>) -> Vec<KeyValue> {
    list.iter()
        .map(|p| KeyValue::new(resolve_deep(&p.key, vars), resolve_deep(&p.value, vars)))
        .collect()
}

/// Resolve every templated part of a request.
pub fn resolve_request(spec: &RequestSpec, vars: &HashMap<String, String>) -> RequestSpec {
    let mut s = spec.clone();
    s.url = resolve_deep(&spec.url, vars);
    s.headers = kv(&spec.headers, vars);
    s.body = match &spec.body {
        Body::Raw { raw } => Body::Raw { raw: resolve_deep(raw, vars) },
        Body::Urlencoded { fields } => Body::Urlencoded { fields: kv(fields, vars) },
        Body::Formdata { fields } => Body::Formdata {
            fields: fields
                .iter()
                .map(|f| {
                    let mut f = f.clone();
                    f.key = resolve_deep(&f.key, vars);
                    f.value = resolve_deep(&f.value, vars);
                    f
                })
                .collect(),
        },
        other => other.clone(),
    };
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_known_and_keeps_unknown() {
        let mut v = HashMap::new();
        v.insert("host".to_string(), "api.test".to_string());
        v.insert("base".to_string(), "https://{{host}}/v1".to_string());
        assert_eq!(resolve_deep("{{base}}/users/{{id}}", &v), "https://api.test/v1/users/{{id}}");
        let g = resolve_deep("{{$guid}}", &v);
        assert_eq!(g.len(), 36);
        assert_eq!(resolve_deep("a {{ unterminated", &v), "a {{ unterminated");
    }
}
