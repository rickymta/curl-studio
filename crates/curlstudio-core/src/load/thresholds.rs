//! k6-style thresholds evaluated against a [`Summary`].

use super::metrics::{Stats, Summary, ThresholdResult};
use super::model::Threshold;

fn stat_of(s: &Stats, stat: &str) -> Option<f64> {
    let k = stat.trim().to_ascii_lowercase().replace(['(', ')', ' '], "");
    Some(match k.as_str() {
        "avg" | "mean" => s.avg,
        "min" => s.min,
        "max" => s.max,
        "med" | "p50" => s.p50,
        "p75" => s.p75,
        "p90" => s.p90,
        "p95" => s.p95,
        "p99" => s.p99,
        "p99.9" | "p999" => s.p999,
        "stddev" => s.stddev,
        "count" => s.count as f64,
        _ => return None,
    })
}

/// Current value of a threshold's metric/stat, or `None` if it does not apply.
pub fn actual(s: &Summary, th: &Threshold) -> Option<f64> {
    let stat = th.stat.trim().to_ascii_lowercase();
    if let Some(step_id) = th.step.as_deref().filter(|x| !x.is_empty()) {
        let st = s.steps.iter().find(|x| x.id == step_id)?;
        return match th.metric.as_str() {
            "http_req_duration" => stat_of(&st.latency, &stat),
            "http_req_waiting" => stat_of(&st.waiting, &stat),
            "http_req_failed" => Some(if stat == "count" { st.failures as f64 } else { st.error_rate }),
            "http_reqs" => Some(if stat == "rate" { st.rps } else { st.count as f64 }),
            "apdex" => Some(st.apdex),
            "checks" => {
                let (p, f) = s
                    .checks
                    .iter()
                    .filter(|c| c.step == step_id)
                    .fold((0u64, 0u64), |a, c| (a.0 + c.pass, a.1 + c.fail));
                Some(if p + f == 0 { 1.0 } else { p as f64 / (p + f) as f64 })
            }
            _ => None,
        };
    }
    match th.metric.as_str() {
        "http_req_duration" => stat_of(&s.latency, &stat),
        "http_req_waiting" => stat_of(&s.waiting, &stat),
        "iteration_duration" => stat_of(&s.iteration, &stat),
        "http_req_failed" => Some(if stat == "count" { s.failures as f64 } else { s.error_rate }),
        "http_reqs" => Some(if stat == "rate" { s.rps } else { s.requests as f64 }),
        "checks" => {
            let n = s.checks_pass + s.checks_fail;
            Some(if stat == "count" {
                s.checks_fail as f64
            } else if n == 0 {
                1.0
            } else {
                s.checks_pass as f64 / n as f64
            })
        }
        "data_received" => {
            Some(if stat == "rate" { s.bytes_in as f64 / s.duration_s.max(0.001) } else { s.bytes_in as f64 })
        }
        "apdex" => Some(s.apdex.score),
        "dropped_iterations" => Some(s.dropped_iterations as f64),
        "iterations" => Some(if stat == "rate" {
            s.iterations as f64 / s.duration_s.max(0.001)
        } else {
            s.iterations as f64
        }),
        _ => None,
    }
}

fn holds(a: f64, op: &str, v: f64) -> bool {
    match op.trim() {
        "<" => a < v,
        "<=" => a <= v,
        ">" => a > v,
        ">=" => a >= v,
        "==" | "=" => (a - v).abs() < 1e-9,
        "!=" => (a - v).abs() >= 1e-9,
        _ => false,
    }
}

pub fn expression(th: &Threshold) -> String {
    let scope = th.step.as_deref().filter(|x| !x.is_empty()).map(|s| format!("{{step:{s}}}")).unwrap_or_default();
    format!("{}{} {} {} {}", th.metric, scope, th.stat, th.op, th.value)
}

pub fn evaluate(s: &Summary, th: &Threshold) -> ThresholdResult {
    let a = actual(s, th);
    ThresholdResult {
        metric: th.metric.clone(),
        stat: th.stat.clone(),
        op: th.op.clone(),
        value: th.value,
        step: th.step.clone(),
        actual: a,
        pass: a.map(|x| holds(x, &th.op, th.value)).unwrap_or(false),
        expression: expression(th),
    }
}

/// Fill `thresholds` and `verdict`.
pub fn apply(s: &mut Summary, ths: &[Threshold]) {
    s.thresholds = ths.iter().map(|t| evaluate(s, t)).collect();
    s.verdict = if s.thresholds.iter().all(|t| t.pass) { "passed".into() } else { "failed".into() };
}

pub fn first_failure(s: &Summary, ths: &[Threshold]) -> Option<String> {
    ths.iter().map(|t| evaluate(s, t)).find(|r| !r.pass && r.actual.is_some()).map(|r| r.expression)
}
