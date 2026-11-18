//! Load-test scenario definition (what the UI builds and stores in `loadScenarios/`).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::model::{KeyValue, RequestSpec};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    #[serde(default)]
    pub name: String,
    pub steps: Vec<Step>,
    pub profile: Profile,
    /// Baseline variables (environment + collection + globals, resolved by the UI).
    #[serde(default)]
    pub variables: Vec<KeyValue>,
    #[serde(default)]
    pub data: Option<DataSet>,
    #[serde(default)]
    pub thresholds: Vec<Threshold>,
    #[serde(default)]
    pub options: LoadOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub id: String,
    pub name: String,
    pub request: RequestSpec,
    #[serde(default)]
    pub checks: Vec<Rule>,
    #[serde(default)]
    pub extract: Vec<Extractor>,
    /// Pause after this step (ms).
    #[serde(default)]
    pub think_ms: u64,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

/// A check (k6) / assertion (JMeter): `source` [path] `op` `value`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    #[serde(default)]
    pub name: String,
    /// `status`, `duration`, `size`, `body`, `jsonpath`, `header`, `regex`.
    pub source: String,
    /// JSONPath, header name or regex, depending on `source`.
    #[serde(default)]
    pub path: String,
    /// `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `contains`, `notContains`, `exists`,
    /// `notExists`, `matches`, `in`.
    pub op: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "yes")]
    pub enabled: bool,
}

/// Post-processor: pull a value out of the response into a VU variable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extractor {
    pub var: String,
    /// `jsonpath`, `header`, `regex`, `status`, `body`, `cookie`.
    pub source: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub default: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSet {
    #[serde(default)]
    pub name: String,
    pub rows: Vec<HashMap<String, String>>,
    /// `sequential` (shared cursor, wraps), `random`, `perVu` (VU n reads row n).
    #[serde(default = "seq")]
    pub mode: String,
}

fn seq() -> String {
    "sequential".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage {
    pub duration_s: f64,
    pub target: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "executor", rename_all = "camelCase")]
pub enum Profile {
    /// Closed model: a number of looping virtual users following stages (JMeter thread group
    /// with ramp-up, k6 `ramping-vus` / `constant-vus`).
    #[serde(rename_all = "camelCase")]
    RampingVus {
        #[serde(default)]
        start_vus: u32,
        stages: Vec<Stage>,
        #[serde(default = "graceful")]
        graceful_stop_s: u64,
    },
    /// Open model: iterations started at a rate (per `time_unit_s`) regardless of response
    /// time (k6 `ramping-arrival-rate` / `constant-arrival-rate`).
    #[serde(rename_all = "camelCase")]
    ArrivalRate {
        #[serde(default)]
        start_rate: f64,
        #[serde(default = "one")]
        time_unit_s: f64,
        stages: Vec<Stage>,
        #[serde(default = "pre_vus")]
        pre_allocated_vus: u32,
        #[serde(default = "max_vus")]
        max_vus: u32,
        #[serde(default = "graceful")]
        graceful_stop_s: u64,
    },
    /// Fixed number of iterations shared by `vus` users (k6 `shared-iterations`, JMeter loop
    /// count).
    #[serde(rename_all = "camelCase")]
    Iterations {
        vus: u32,
        iterations: u64,
        #[serde(default = "max_dur")]
        max_duration_s: u64,
    },
}

fn graceful() -> u64 {
    30
}
fn one() -> f64 {
    1.0
}
fn pre_vus() -> u32 {
    10
}
fn max_vus() -> u32 {
    200
}
fn max_dur() -> u64 {
    600
}

impl Profile {
    /// Planned duration in seconds (iterations: the cap).
    pub fn planned_s(&self) -> f64 {
        match self {
            Profile::RampingVus { stages, .. } | Profile::ArrivalRate { stages, .. } => {
                stages.iter().map(|s| s.duration_s.max(0.0)).sum()
            }
            Profile::Iterations { max_duration_s, .. } => *max_duration_s as f64,
        }
    }
}

/// Linear interpolation over stages starting at `start` (k6 semantics).
pub fn stage_value(start: f64, stages: &[Stage], t: f64) -> f64 {
    let mut from = start;
    let mut t0 = 0.0;
    for s in stages {
        let d = s.duration_s.max(0.0);
        if t < t0 + d {
            if d == 0.0 {
                return s.target;
            }
            return from + (s.target - from) * ((t - t0) / d);
        }
        from = s.target;
        t0 += d;
    }
    from
}

/// ∫₀ᵗ stage_value — cumulative iterations for the arrival-rate executor.
pub fn stage_integral(start: f64, stages: &[Stage], t: f64) -> f64 {
    let mut from = start;
    let mut t0 = 0.0;
    let mut acc = 0.0;
    for s in stages {
        let d = s.duration_s.max(0.0);
        if t <= t0 {
            break;
        }
        let span = (t - t0).min(d);
        if d > 0.0 {
            let end_v = from + (s.target - from) * (span / d);
            acc += (from + end_v) / 2.0 * span;
        }
        from = s.target;
        t0 += d;
    }
    if t > t0 {
        acc += from * (t - t0);
    }
    acc
}

/// k6-style pass/fail criterion on an aggregated metric.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Threshold {
    /// `http_req_duration`, `http_req_waiting`, `http_req_failed`, `checks`, `http_reqs`,
    /// `iteration_duration`, `data_received`, `apdex`, `dropped_iterations`.
    pub metric: String,
    /// `avg`, `min`, `max`, `med`, `p(90)`, `p(95)`, `p(99)`, `rate`, `count`, `value`.
    pub stat: String,
    /// `<`, `<=`, `>`, `>=`, `==`, `!=`.
    pub op: String,
    pub value: f64,
    /// Restrict to one step (request) id.
    #[serde(default)]
    pub step: Option<String>,
    /// Stop the test as soon as this threshold fails (after `delay_s`).
    #[serde(default)]
    pub abort_on_fail: bool,
    #[serde(default)]
    pub delay_s: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LoadOptions {
    pub timeout_ms: u64,
    pub verify_tls: bool,
    pub follow_redirects: bool,
    pub http1_only: bool,
    pub proxy: String,
    /// Random pause between iterations.
    pub think_min_ms: u64,
    pub think_max_ms: u64,
    /// Apdex "T" in ms (satisfied ≤ T, tolerating ≤ 4T).
    pub apdex_ms: u64,
    /// Status codes that count as success, e.g. `200-399` or `200,201,404`.
    pub expected_status: String,
    /// JMeter style: a failed check marks the request as failed.
    pub checks_fail_request: bool,
    /// Own cookie jar per VU (k6/JMeter behaviour).
    pub cookies: bool,
    /// Drop connections after every iteration (JMeter "Use KeepAlive" off).
    pub new_connection_per_iteration: bool,
    /// Keep at most this many bytes of a body for checks/extractors.
    pub max_body_bytes: usize,
}

impl Default for LoadOptions {
    fn default() -> Self {
        Self {
            timeout_ms: 30_000,
            verify_tls: true,
            follow_redirects: true,
            http1_only: false,
            proxy: String::new(),
            think_min_ms: 0,
            think_max_ms: 0,
            apdex_ms: 500,
            expected_status: "200-399".into(),
            checks_fail_request: false,
            cookies: true,
            new_connection_per_iteration: false,
            max_body_bytes: 2 * 1024 * 1024,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolates_and_integrates() {
        let st = vec![
            Stage { duration_s: 10.0, target: 10.0 },
            Stage { duration_s: 10.0, target: 10.0 },
            Stage { duration_s: 5.0, target: 0.0 },
        ];
        assert_eq!(stage_value(0.0, &st, 5.0), 5.0);
        assert_eq!(stage_value(0.0, &st, 15.0), 10.0);
        assert_eq!(stage_value(0.0, &st, 22.5), 5.0);
        assert_eq!(stage_value(0.0, &st, 99.0), 0.0);
        assert!((stage_integral(0.0, &st, 10.0) - 50.0).abs() < 1e-9);
        assert!((stage_integral(0.0, &st, 20.0) - 150.0).abs() < 1e-9);
        assert!((stage_integral(0.0, &st, 25.0) - 175.0).abs() < 1e-9);
    }
}
