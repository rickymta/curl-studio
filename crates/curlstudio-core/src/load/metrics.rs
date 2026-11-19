//! Metric collection: one-second buckets for the live charts plus run-wide HDR histograms for
//! the summary (percentiles, Apdex, per-request aggregate report, error breakdown).

use std::collections::{BTreeMap, HashMap};

use hdrhistogram::Histogram;
use serde::Serialize;

/// Upper bounds (ms) of the latency heatmap rows; the last row is "above".
pub const HEAT_BOUNDS_MS: [f64; 17] = [
    1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 300.0, 500.0, 750.0, 1000.0, 1500.0, 2000.0,
    3000.0, 5000.0, 10000.0,
];
pub const HEAT_ROWS: usize = HEAT_BOUNDS_MS.len() + 1;

fn hist(sigfig: u8) -> Histogram<u64> {
    // Microseconds, 1µs … 1h.
    Histogram::new_with_bounds(1, 3_600_000_000, sigfig).expect("histogram bounds")
}

fn us(ms: f64) -> u64 {
    ((ms * 1000.0).round() as u64).clamp(1, 3_600_000_000)
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub count: u64,
    pub avg: f64,
    pub min: f64,
    pub max: f64,
    pub stddev: f64,
    pub p50: f64,
    pub p75: f64,
    pub p90: f64,
    pub p95: f64,
    pub p99: f64,
    pub p999: f64,
}

pub fn stats(h: &Histogram<u64>) -> Stats {
    if h.is_empty() {
        return Stats::default();
    }
    let q = |x: f64| h.value_at_quantile(x) as f64 / 1000.0;
    Stats {
        count: h.len(),
        avg: h.mean() / 1000.0,
        min: h.min() as f64 / 1000.0,
        max: h.max() as f64 / 1000.0,
        stddev: h.stdev() / 1000.0,
        p50: q(0.5),
        p75: q(0.75),
        p90: q(0.9),
        p95: q(0.95),
        p99: q(0.99),
        p999: q(0.999),
    }
}

/// One finished request.
pub struct Sample<'a> {
    pub step: &'a str,
    pub duration_ms: f64,
    pub waiting_ms: f64,
    pub status: u16,
    pub failed: bool,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub error: Option<String>,
}

#[derive(Default)]
struct StepSec {
    count: u64,
    failures: u64,
    sum_ms: f64,
    max_ms: f64,
}

struct Bucket {
    requests: u64,
    failures: u64,
    bytes_in: u64,
    bytes_out: u64,
    iterations: u64,
    checks_pass: u64,
    checks_fail: u64,
    vus: u32,
    lat: Histogram<u64>,
    wait_sum: f64,
    status: BTreeMap<u16, u64>,
    heat: [u64; HEAT_ROWS],
    apdex_s: u64,
    apdex_t: u64,
    steps: HashMap<String, StepSec>,
    dropped: u64,
}

impl Bucket {
    fn new() -> Self {
        Self {
            requests: 0,
            failures: 0,
            bytes_in: 0,
            bytes_out: 0,
            iterations: 0,
            checks_pass: 0,
            checks_fail: 0,
            vus: 0,
            lat: hist(2),
            wait_sum: 0.0,
            status: BTreeMap::new(),
            heat: [0; HEAT_ROWS],
            apdex_s: 0,
            apdex_t: 0,
            steps: HashMap::new(),
            dropped: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepPoint {
    pub count: u64,
    pub failures: u64,
    pub avg: f64,
    pub max: f64,
}

/// One second of the timeline as sent to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub t: u64,
    pub vus: u32,
    pub requests: u64,
    pub failures: u64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub iterations: u64,
    pub dropped: u64,
    pub checks_pass: u64,
    pub checks_fail: u64,
    pub avg: f64,
    pub min: f64,
    pub max: f64,
    pub p50: f64,
    pub p90: f64,
    pub p95: f64,
    pub p99: f64,
    pub wait_avg: f64,
    pub apdex: Option<f64>,
    pub status: BTreeMap<u16, u64>,
    pub heat: Vec<u64>,
    pub steps: BTreeMap<String, StepPoint>,
}

struct StepAgg {
    lat: Histogram<u64>,
    wait: Histogram<u64>,
    count: u64,
    failures: u64,
    bytes_in: u64,
    bytes_out: u64,
    status: BTreeMap<u16, u64>,
    apdex_s: u64,
    apdex_t: u64,
}

impl StepAgg {
    fn new() -> Self {
        Self {
            lat: hist(3),
            wait: hist(3),
            count: 0,
            failures: 0,
            bytes_in: 0,
            bytes_out: 0,
            status: BTreeMap::new(),
            apdex_s: 0,
            apdex_t: 0,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckStat {
    pub step: String,
    pub name: String,
    pub pass: u64,
    pub fail: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorStat {
    pub step: String,
    pub message: String,
    pub count: u64,
}

pub struct Metrics {
    apdex_ms: f64,
    open: BTreeMap<u64, Bucket>,
    pub timeline: Vec<Point>,
    lat: Histogram<u64>,
    wait: Histogram<u64>,
    iter: Histogram<u64>,
    steps: HashMap<String, StepAgg>,
    checks: BTreeMap<(String, String), CheckStat>,
    errors: HashMap<(String, String), u64>,
    pub requests: u64,
    pub failures: u64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub iterations: u64,
    pub dropped: u64,
    pub checks_pass: u64,
    pub checks_fail: u64,
    apdex_s: u64,
    apdex_t: u64,
    status: BTreeMap<u16, u64>,
    pub vus_max: u32,
}

impl Metrics {
    pub fn new(apdex_ms: u64) -> Self {
        Self {
            apdex_ms: apdex_ms.max(1) as f64,
            open: BTreeMap::new(),
            timeline: Vec::new(),
            lat: hist(3),
            wait: hist(3),
            iter: hist(3),
            steps: HashMap::new(),
            checks: BTreeMap::new(),
            errors: HashMap::new(),
            requests: 0,
            failures: 0,
            bytes_in: 0,
            bytes_out: 0,
            iterations: 0,
            dropped: 0,
            checks_pass: 0,
            checks_fail: 0,
            apdex_s: 0,
            apdex_t: 0,
            status: BTreeMap::new(),
            vus_max: 0,
        }
    }

    fn bucket(&mut self, sec: u64) -> &mut Bucket {
        // Late samples for an already flushed second land in the oldest open one.
        let first_open = self.timeline.last().map(|p| p.t + 1).unwrap_or(0);
        self.open
            .entry(sec.max(first_open))
            .or_insert_with(Bucket::new)
    }

    pub fn record(&mut self, sec: u64, s: Sample) {
        let apdex_t = self.apdex_ms;
        let (sat, tol) = if s.failed {
            (false, false)
        } else {
            (s.duration_ms <= apdex_t, s.duration_ms <= 4.0 * apdex_t)
        };
        let row = HEAT_BOUNDS_MS
            .iter()
            .position(|b| s.duration_ms <= *b)
            .unwrap_or(HEAT_ROWS - 1);
        {
            let b = self.bucket(sec);
            b.requests += 1;
            b.failures += s.failed as u64;
            b.bytes_in += s.bytes_in;
            b.bytes_out += s.bytes_out;
            let _ = b.lat.record(us(s.duration_ms));
            b.wait_sum += s.waiting_ms;
            *b.status.entry(s.status).or_default() += 1;
            b.heat[row] += 1;
            if sat {
                b.apdex_s += 1;
            } else if tol {
                b.apdex_t += 1;
            }
            let st = b.steps.entry(s.step.to_string()).or_default();
            st.count += 1;
            st.failures += s.failed as u64;
            st.sum_ms += s.duration_ms;
            st.max_ms = st.max_ms.max(s.duration_ms);
        }
        self.requests += 1;
        self.failures += s.failed as u64;
        self.bytes_in += s.bytes_in;
        self.bytes_out += s.bytes_out;
        let _ = self.lat.record(us(s.duration_ms));
        let _ = self.wait.record(us(s.waiting_ms));
        *self.status.entry(s.status).or_default() += 1;
        if sat {
            self.apdex_s += 1;
        } else if tol {
            self.apdex_t += 1;
        }
        let a = self
            .steps
            .entry(s.step.to_string())
            .or_insert_with(StepAgg::new);
        a.count += 1;
        a.failures += s.failed as u64;
        a.bytes_in += s.bytes_in;
        a.bytes_out += s.bytes_out;
        let _ = a.lat.record(us(s.duration_ms));
        let _ = a.wait.record(us(s.waiting_ms));
        *a.status.entry(s.status).or_default() += 1;
        if sat {
            a.apdex_s += 1;
        } else if tol {
            a.apdex_t += 1;
        }
        if let Some(e) = s.error {
            let key = (s.step.to_string(), e);
            if self.errors.len() < 200 || self.errors.contains_key(&key) {
                *self.errors.entry(key).or_default() += 1;
            }
        }
    }

    pub fn record_check(&mut self, sec: u64, step: &str, name: &str, ok: bool) {
        let b = self.bucket(sec);
        if ok {
            b.checks_pass += 1;
        } else {
            b.checks_fail += 1;
        }
        if ok {
            self.checks_pass += 1;
        } else {
            self.checks_fail += 1;
        }
        let c = self
            .checks
            .entry((step.to_string(), name.to_string()))
            .or_insert_with(|| CheckStat {
                step: step.to_string(),
                name: name.to_string(),
                pass: 0,
                fail: 0,
            });
        if ok {
            c.pass += 1;
        } else {
            c.fail += 1;
        }
    }

    pub fn record_iteration(&mut self, sec: u64, ms: f64) {
        self.bucket(sec).iterations += 1;
        self.iterations += 1;
        let _ = self.iter.record(us(ms));
    }

    pub fn record_dropped(&mut self, sec: u64, n: u64) {
        self.bucket(sec).dropped += n;
        self.dropped += n;
    }

    pub fn set_vus(&mut self, sec: u64, vus: u32) {
        let b = self.bucket(sec);
        b.vus = b.vus.max(vus);
        self.vus_max = self.vus_max.max(vus);
    }

    /// Close every second strictly before `upto` (fills gaps so the timeline is continuous).
    pub fn flush(&mut self, upto: u64, current_vus: u32) {
        let mut next = self.timeline.last().map(|p| p.t + 1).unwrap_or(0);
        while next < upto {
            let b = self.open.remove(&next).unwrap_or_else(|| {
                let mut b = Bucket::new();
                b.vus = current_vus;
                b
            });
            self.timeline.push(point(next, b));
            next += 1;
        }
    }

    pub fn summary(
        &self,
        names: &HashMap<String, (String, String, String)>,
        elapsed_s: f64,
    ) -> Summary {
        let elapsed = elapsed_s.max(0.001);
        let lat = stats(&self.lat);
        let total = self.requests.max(1) as f64;
        let mut steps: Vec<StepSummary> = self
            .steps
            .iter()
            .map(|(id, a)| {
                let (name, method, url) = names.get(id).cloned().unwrap_or_default();
                let n = a.count.max(1) as f64;
                StepSummary {
                    id: id.clone(),
                    name,
                    method,
                    url,
                    count: a.count,
                    failures: a.failures,
                    error_rate: a.failures as f64 / n,
                    rps: a.count as f64 / elapsed,
                    bytes_in: a.bytes_in,
                    bytes_out: a.bytes_out,
                    latency: stats(&a.lat),
                    waiting: stats(&a.wait),
                    status: a.status.clone(),
                    apdex: (a.apdex_s as f64 + a.apdex_t as f64 / 2.0) / n,
                }
            })
            .collect();
        steps.sort_by(|a, b| a.name.cmp(&b.name));
        let mut errors: Vec<ErrorStat> = self
            .errors
            .iter()
            .map(|((step, message), count)| ErrorStat {
                step: step.clone(),
                message: message.clone(),
                count: *count,
            })
            .collect();
        errors.sort_by_key(|a| std::cmp::Reverse(a.count));
        let peak_rps = self.timeline.iter().map(|p| p.requests).max().unwrap_or(0);
        Summary {
            duration_s: elapsed_s,
            requests: self.requests,
            failures: self.failures,
            error_rate: self.failures as f64 / total,
            rps: self.requests as f64 / elapsed,
            peak_rps,
            bytes_in: self.bytes_in,
            bytes_out: self.bytes_out,
            iterations: self.iterations,
            dropped_iterations: self.dropped,
            vus_max: self.vus_max,
            checks_pass: self.checks_pass,
            checks_fail: self.checks_fail,
            latency: lat.clone(),
            waiting: stats(&self.wait),
            iteration: stats(&self.iter),
            apdex: Apdex {
                t_ms: self.apdex_ms,
                satisfied: self.apdex_s,
                tolerating: self.apdex_t,
                frustrated: self.requests - self.apdex_s - self.apdex_t,
                score: if self.requests == 0 {
                    1.0
                } else {
                    (self.apdex_s as f64 + self.apdex_t as f64 / 2.0) / total
                },
            },
            status: self.status.clone(),
            steps,
            checks: self.checks.values().cloned().collect(),
            errors,
            distribution: distribution(&self.lat),
            thresholds: Vec::new(),
            verdict: String::new(),
        }
    }
}

fn point(t: u64, b: Bucket) -> Point {
    let s = stats(&b.lat);
    let steps = b
        .steps
        .into_iter()
        .map(|(k, v)| {
            let avg = if v.count > 0 {
                v.sum_ms / v.count as f64
            } else {
                0.0
            };
            (
                k,
                StepPoint {
                    count: v.count,
                    failures: v.failures,
                    avg,
                    max: v.max_ms,
                },
            )
        })
        .collect();
    Point {
        t,
        vus: b.vus,
        requests: b.requests,
        failures: b.failures,
        bytes_in: b.bytes_in,
        bytes_out: b.bytes_out,
        iterations: b.iterations,
        dropped: b.dropped,
        checks_pass: b.checks_pass,
        checks_fail: b.checks_fail,
        avg: s.avg,
        min: s.min,
        max: s.max,
        p50: s.p50,
        p90: s.p90,
        p95: s.p95,
        p99: s.p99,
        wait_avg: if b.requests > 0 {
            b.wait_sum / b.requests as f64
        } else {
            0.0
        },
        apdex: (b.requests > 0)
            .then(|| (b.apdex_s as f64 + b.apdex_t as f64 / 2.0) / b.requests as f64),
        status: b.status,
        heat: b.heat.to_vec(),
        steps,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bin {
    pub from: f64,
    pub to: f64,
    pub count: u64,
}

/// Response-time histogram: 40 equal bins from min to p99.5, plus one overflow bin.
fn distribution(h: &Histogram<u64>) -> Vec<Bin> {
    if h.is_empty() {
        return Vec::new();
    }
    let lo = h.min();
    let hi = h.value_at_quantile(0.995).max(lo + 1);
    let n = 40u64;
    let width = ((hi - lo) / n).max(1);
    let mut out = Vec::new();
    for i in 0..n {
        let a = lo + i * width;
        let b = if i == n - 1 { hi } else { a + width - 1 };
        out.push(Bin {
            from: a as f64 / 1000.0,
            to: b as f64 / 1000.0,
            count: h.count_between(a, b),
        });
    }
    let over = h.count_between(hi + 1, h.max().max(hi + 1));
    if over > 0 {
        out.push(Bin {
            from: hi as f64 / 1000.0,
            to: h.max() as f64 / 1000.0,
            count: over,
        });
    }
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Apdex {
    pub t_ms: f64,
    pub satisfied: u64,
    pub tolerating: u64,
    pub frustrated: u64,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepSummary {
    pub id: String,
    pub name: String,
    pub method: String,
    pub url: String,
    pub count: u64,
    pub failures: u64,
    pub error_rate: f64,
    pub rps: f64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub latency: Stats,
    pub waiting: Stats,
    pub status: BTreeMap<u16, u64>,
    pub apdex: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThresholdResult {
    pub metric: String,
    pub stat: String,
    pub op: String,
    pub value: f64,
    pub step: Option<String>,
    pub actual: Option<f64>,
    pub pass: bool,
    pub expression: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub duration_s: f64,
    pub requests: u64,
    pub failures: u64,
    pub error_rate: f64,
    pub rps: f64,
    pub peak_rps: u64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub iterations: u64,
    pub dropped_iterations: u64,
    pub vus_max: u32,
    pub checks_pass: u64,
    pub checks_fail: u64,
    pub latency: Stats,
    pub waiting: Stats,
    pub iteration: Stats,
    pub apdex: Apdex,
    pub status: BTreeMap<u16, u64>,
    pub steps: Vec<StepSummary>,
    pub checks: Vec<CheckStat>,
    pub errors: Vec<ErrorStat>,
    pub distribution: Vec<Bin>,
    pub thresholds: Vec<ThresholdResult>,
    pub verdict: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buckets_and_summary() {
        let mut m = Metrics::new(500);
        for i in 0..100u64 {
            m.record(
                i / 50,
                Sample {
                    step: "s1",
                    duration_ms: (i + 1) as f64,
                    waiting_ms: 1.0,
                    status: if i % 10 == 0 { 500 } else { 200 },
                    failed: i % 10 == 0,
                    bytes_in: 10,
                    bytes_out: 5,
                    error: None,
                },
            );
        }
        m.flush(3, 1);
        assert_eq!(m.timeline.len(), 3);
        assert_eq!(m.timeline[0].requests, 50);
        assert_eq!(m.timeline[2].requests, 0);
        let mut names = HashMap::new();
        names.insert("s1".into(), ("Get".into(), "GET".into(), "/".into()));
        let s = m.summary(&names, 2.0);
        assert_eq!(s.requests, 100);
        assert_eq!(s.failures, 10);
        assert!((s.latency.p50 - 50.0).abs() < 1.0);
        assert_eq!(s.steps[0].count, 100);
        assert!(s.apdex.score > 0.85);
        assert!(!s.distribution.is_empty());
    }
}
