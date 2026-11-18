//! Executors and virtual users.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use rand::Rng;
use reqwest_cookie_store::CookieStoreMutex;
use serde_json::{Value, json};

use super::metrics::{Metrics, Sample, Summary};
use super::model::{Profile, Scenario, stage_integral, stage_value};
use super::rules::{self, Observed};
use super::thresholds;
use crate::error::{Error, Result};
use crate::model::RequestOptions;
use crate::vars;

pub struct Run {
    pub id: String,
    pub scenario: Scenario,
    pub meta: Value,
    pub started: Instant,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub metrics: Mutex<Metrics>,
    /// Graceful stop: VUs finish their current iteration.
    pub stopping: AtomicBool,
    /// Hard stop: in-flight requests are abandoned.
    pub killed: AtomicBool,
    pub vus: AtomicU32,
    pub state: Mutex<String>,
    pub reason: Mutex<Option<String>>,
    pub result: Mutex<Option<Value>>,
    data_cursor: AtomicUsize,
    names: HashMap<String, (String, String, String)>,
}

impl Run {
    fn sec(&self) -> u64 {
        self.started.elapsed().as_secs()
    }
    fn elapsed(&self) -> f64 {
        self.started.elapsed().as_secs_f64()
    }
    pub fn summary(&self) -> Summary {
        let m = self.metrics.lock().unwrap();
        let mut s = m.summary(&self.names, self.elapsed());
        drop(m);
        thresholds::apply(&mut s, &self.scenario.thresholds);
        s
    }
}

fn runs() -> &'static Mutex<HashMap<String, Arc<Run>>> {
    static R: OnceLock<Mutex<HashMap<String, Arc<Run>>>> = OnceLock::new();
    R.get_or_init(Default::default)
}

pub fn get(id: &str) -> Result<Arc<Run>> {
    runs().lock().unwrap().get(id).cloned().ok_or_else(|| Error::NotFound(format!("run {id}")))
}

pub fn active() -> Vec<Value> {
    runs()
        .lock()
        .unwrap()
        .values()
        .map(|r| json!({"id": r.id, "name": r.scenario.name, "state": *r.state.lock().unwrap()}))
        .collect()
}

pub fn forget(id: &str) {
    runs().lock().unwrap().remove(id);
}

fn request_options(sc: &Scenario) -> RequestOptions {
    let o = &sc.options;
    RequestOptions {
        timeout_ms: o.timeout_ms,
        follow_redirects: o.follow_redirects,
        max_redirects: 10,
        verify_tls: o.verify_tls,
        proxy: o.proxy.clone(),
        http1_only: o.http1_only,
        cookies: o.cookies,
        max_body_bytes: o.max_body_bytes.max(1024),
    }
}

pub fn validate(sc: &Scenario) -> Result<()> {
    if !sc.steps.iter().any(|s| s.enabled) {
        return Err(Error::Invalid("the scenario has no enabled request".into()));
    }
    match &sc.profile {
        Profile::RampingVus { stages, start_vus, .. } => {
            if stages.is_empty() {
                return Err(Error::Invalid("add at least one stage".into()));
            }
            let peak = stages.iter().map(|s| s.target).fold(*start_vus as f64, f64::max);
            if peak > 20_000.0 {
                return Err(Error::Invalid("more than 20,000 VUs is not supported".into()));
            }
        }
        Profile::ArrivalRate { stages, max_vus, .. } => {
            if stages.is_empty() {
                return Err(Error::Invalid("add at least one stage".into()));
            }
            if *max_vus == 0 || *max_vus > 20_000 {
                return Err(Error::Invalid("max VUs must be between 1 and 20,000".into()));
            }
        }
        Profile::Iterations { vus, iterations, .. } => {
            if *vus == 0 || *iterations == 0 {
                return Err(Error::Invalid("VUs and iterations must be positive".into()));
            }
        }
    }
    Ok(())
}

/// Start a run in the background and return its id.
pub fn start(scenario: Scenario, meta: Value) -> Result<String> {
    validate(&scenario)?;
    crate::http::init_tls();
    let id = format!(
        "{}-{}",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        &uuid::Uuid::new_v4().simple().to_string()[..6]
    );
    let names = scenario
        .steps
        .iter()
        .map(|s| (s.id.clone(), (s.name.clone(), s.request.method.clone(), s.request.url.clone())))
        .collect();
    let run = Arc::new(Run {
        id: id.clone(),
        metrics: Mutex::new(Metrics::new(scenario.options.apdex_ms)),
        scenario,
        meta,
        started: Instant::now(),
        started_at: chrono::Utc::now(),
        stopping: AtomicBool::new(false),
        killed: AtomicBool::new(false),
        vus: AtomicU32::new(0),
        state: Mutex::new("running".into()),
        reason: Mutex::new(None),
        result: Mutex::new(None),
        data_cursor: AtomicUsize::new(0),
        names,
    });
    runs().lock().unwrap().insert(id.clone(), run.clone());
    tokio::spawn(controller(run));
    Ok(id)
}

pub fn stop(id: &str, hard: bool) -> Result<()> {
    let r = get(id)?;
    r.reason.lock().unwrap().get_or_insert_with(|| "Stopped by user".into());
    r.stopping.store(true, Ordering::SeqCst);
    if hard {
        r.killed.store(true, Ordering::SeqCst);
    }
    Ok(())
}

// ---- virtual user ------------------------------------------------------------------------------

struct Vu {
    n: u32,
    client: Option<reqwest::Client>,
    vars: HashMap<String, String>,
}

impl Vu {
    fn new(n: u32, run: &Run) -> Self {
        let mut vars: HashMap<String, String> = HashMap::new();
        for kv in &run.scenario.variables {
            vars.insert(kv.key.clone(), kv.value.clone());
        }
        vars.insert("__VU".into(), n.to_string());
        Self { n, client: None, vars }
    }

    fn client(&mut self, run: &Run) -> Result<reqwest::Client> {
        if self.client.is_none() {
            let o = request_options(&run.scenario);
            let jar = o.cookies.then(|| Arc::new(CookieStoreMutex::default()));
            self.client = Some(crate::http::build_client(&o, jar)?);
        }
        Ok(self.client.clone().unwrap())
    }

    fn load_data_row(&mut self, run: &Run, iteration: u64) {
        let Some(ds) = &run.scenario.data else { return };
        if ds.rows.is_empty() {
            return;
        }
        let idx = match ds.mode.as_str() {
            "random" => rand::rng().random_range(0..ds.rows.len()),
            "perVu" => (self.n as usize).saturating_sub(1) % ds.rows.len(),
            _ => run.data_cursor.fetch_add(1, Ordering::Relaxed) % ds.rows.len(),
        };
        for (k, v) in &ds.rows[idx] {
            self.vars.insert(k.clone(), v.clone());
        }
        self.vars.insert("__ITER".into(), iteration.to_string());
    }
}

fn classify(e: &Error) -> String {
    let msg = e.to_string();
    let lower = msg.to_ascii_lowercase();
    let kind = if matches!(e, Error::Timeout(_)) || lower.contains("timed out") {
        "timeout"
    } else if lower.contains("dns") || lower.contains("resolve") {
        "dns"
    } else if lower.contains("certificate") || lower.contains("tls") {
        "tls"
    } else if lower.contains("connection refused") || lower.contains("connect") {
        "connect"
    } else if lower.contains("reset") || lower.contains("closed") {
        "connection reset"
    } else {
        "error"
    };
    let short: String = msg.chars().take(180).collect();
    format!("{kind}: {short}")
}

/// One pass over every enabled step. Returns false when the run is being killed.
async fn iteration(vu: &mut Vu, run: &Run, iter_no: u64) -> bool {
    let started = Instant::now();
    vu.load_data_row(run, iter_no);
    let opts = request_options(&run.scenario);
    let expected = run.scenario.options.expected_status.clone();
    for step in run.scenario.steps.iter().filter(|s| s.enabled) {
        if run.killed.load(Ordering::Relaxed) {
            return false;
        }
        let mut spec = vars::resolve_request(&step.request, &vu.vars);
        spec.options = RequestOptions {
            timeout_ms: if step.request.options.timeout_ms > 0 {
                step.request.options.timeout_ms.min(opts.timeout_ms.max(1))
            } else {
                opts.timeout_ms
            },
            ..opts.clone()
        };
        let client = match vu.client(run) {
            Ok(c) => c,
            Err(e) => {
                *run.reason.lock().unwrap() = Some(e.to_string());
                run.stopping.store(true, Ordering::SeqCst);
                return false;
            }
        };
        let t0 = Instant::now();
        let res = tokio::select! {
            r = crate::http::execute(&client, &spec) => r,
            _ = wait_killed(run) => return false,
        };
        let sec = run.sec();
        match res {
            Ok(raw) => {
                let headers: Vec<(String, String)> = raw
                    .headers
                    .iter()
                    .map(|(k, v)| (k.as_str().to_string(), String::from_utf8_lossy(v.as_bytes()).to_string()))
                    .collect();
                let body = String::from_utf8_lossy(&raw.body);
                let duration = raw.timings.total_ms;
                let hdr_bytes: u64 = headers.iter().map(|(k, v)| (k.len() + v.len() + 4) as u64).sum();
                let obs = Observed::new(raw.status, duration, raw.size, &headers, &body);
                let mut all_ok = true;
                let mut check_results = Vec::new();
                for c in step.checks.iter().filter(|c| c.enabled) {
                    let ok = rules::check(c, &obs);
                    all_ok &= ok;
                    check_results.push((rules::rule_name(c), ok));
                }
                for ex in &step.extract {
                    if let Some(v) = rules::extract(ex, &obs) {
                        vu.vars.insert(ex.var.clone(), v);
                    }
                }
                let status_ok = rules::expected(raw.status, &expected);
                let failed = !status_ok || (run.scenario.options.checks_fail_request && !all_ok);
                let error = if !status_ok {
                    Some(format!("HTTP {} {}", raw.status, raw.status_text))
                } else if failed {
                    Some(format!(
                        "check failed: {}",
                        check_results.iter().filter(|c| !c.1).map(|c| c.0.as_str()).collect::<Vec<_>>().join(", ")
                    ))
                } else {
                    None
                };
                let mut m = run.metrics.lock().unwrap();
                m.record(
                    sec,
                    Sample {
                        step: &step.id,
                        duration_ms: duration,
                        waiting_ms: raw.timings.wait_ms,
                        status: raw.status,
                        failed,
                        bytes_in: raw.size + hdr_bytes,
                        bytes_out: raw.sent_bytes,
                        error,
                    },
                );
                for (name, ok) in check_results {
                    m.record_check(sec, &step.id, &name, ok);
                }
            }
            Err(e) => {
                let ms = t0.elapsed().as_secs_f64() * 1000.0;
                let mut m = run.metrics.lock().unwrap();
                m.record(
                    sec,
                    Sample {
                        step: &step.id,
                        duration_ms: ms,
                        waiting_ms: ms,
                        status: 0,
                        failed: true,
                        bytes_in: 0,
                        bytes_out: 0,
                        error: Some(classify(&e)),
                    },
                );
                for c in step.checks.iter().filter(|c| c.enabled) {
                    m.record_check(sec, &step.id, &rules::rule_name(c), false);
                }
            }
        }
        if step.think_ms > 0 && !sleep_or_kill(run, step.think_ms).await {
            return false;
        }
    }
    run.metrics
        .lock()
        .unwrap()
        .record_iteration(run.sec(), started.elapsed().as_secs_f64() * 1000.0);
    if run.scenario.options.new_connection_per_iteration {
        vu.client = None;
    }
    let (lo, hi) = (run.scenario.options.think_min_ms, run.scenario.options.think_max_ms);
    if hi > 0 {
        let ms = if hi > lo { rand::rng().random_range(lo..=hi) } else { hi };
        if !sleep_or_kill(run, ms).await {
            return false;
        }
    }
    true
}

async fn wait_killed(run: &Run) {
    while !run.killed.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn sleep_or_kill(run: &Run, ms: u64) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_millis(ms)) => true,
        _ = wait_killed(run) => false,
    }
}

// ---- executors ---------------------------------------------------------------------------------

struct Looping {
    stop: Arc<AtomicBool>,
    handle: tokio::task::JoinHandle<()>,
}

fn spawn_looping(run: Arc<Run>, n: u32, live: Arc<AtomicU32>) -> Looping {
    let stop = Arc::new(AtomicBool::new(false));
    let s = stop.clone();
    let handle = tokio::spawn(async move {
        live.fetch_add(1, Ordering::SeqCst);
        let mut vu = Vu::new(n, &run);
        let mut i = 0u64;
        while !s.load(Ordering::Relaxed) && !run.stopping.load(Ordering::Relaxed) {
            if !iteration(&mut vu, &run, i).await {
                break;
            }
            i += 1;
        }
        live.fetch_sub(1, Ordering::SeqCst);
    });
    Looping { stop, handle }
}

async fn controller(run: Arc<Run>) {
    let tick = Duration::from_millis(200);
    let live = Arc::new(AtomicU32::new(0));
    let planned = run.scenario.profile.planned_s();
    let mut last_threshold_check = 0.0;

    let mut looping: Vec<Looping> = Vec::new();
    let mut next_vu: u32 = 1;
    // Arrival-rate state.
    let (ticket_tx, ticket_rx) = tokio::sync::mpsc::unbounded_channel::<u64>();
    let ticket_rx = Arc::new(tokio::sync::Mutex::new(ticket_rx));
    let idle = Arc::new(AtomicUsize::new(0));
    let mut workers: Vec<tokio::task::JoinHandle<()>> = Vec::new();
    let mut started_iters: u64 = 0;
    // Iterations state.
    let shared_counter = Arc::new(AtomicU64::new(0));

    let spawn_worker = |n: u32, workers: &mut Vec<tokio::task::JoinHandle<()>>| {
        let run = run.clone();
        let rx = ticket_rx.clone();
        let idle = idle.clone();
        let live = live.clone();
        workers.push(tokio::spawn(async move {
            live.fetch_add(1, Ordering::SeqCst);
            let mut vu = Vu::new(n, &run);
            loop {
                idle.fetch_add(1, Ordering::SeqCst);
                let t = { rx.lock().await.recv().await };
                idle.fetch_sub(1, Ordering::SeqCst);
                let Some(i) = t else { break };
                if run.stopping.load(Ordering::Relaxed) || !iteration(&mut vu, &run, i).await {
                    break;
                }
            }
            live.fetch_sub(1, Ordering::SeqCst);
        }));
    };

    match &run.scenario.profile {
        Profile::ArrivalRate { pre_allocated_vus, .. } => {
            for _ in 0..*pre_allocated_vus {
                spawn_worker(next_vu, &mut workers);
                next_vu += 1;
            }
        }
        Profile::Iterations { vus, iterations, .. } => {
            for _ in 0..*vus {
                let run = run.clone();
                let counter = shared_counter.clone();
                let live = live.clone();
                let total = *iterations;
                let n = next_vu;
                next_vu += 1;
                workers.push(tokio::spawn(async move {
                    live.fetch_add(1, Ordering::SeqCst);
                    let mut vu = Vu::new(n, &run);
                    loop {
                        let i = counter.fetch_add(1, Ordering::SeqCst);
                        if i >= total || run.stopping.load(Ordering::Relaxed) {
                            break;
                        }
                        if !iteration(&mut vu, &run, i).await {
                            break;
                        }
                    }
                    live.fetch_sub(1, Ordering::SeqCst);
                }));
            }
        }
        Profile::RampingVus { .. } => {}
    }

    loop {
        let t = run.elapsed();
        let sec = run.sec();
        let stopping = run.stopping.load(Ordering::Relaxed);
        match &run.scenario.profile {
            Profile::RampingVus { start_vus, stages, .. } => {
                if !stopping {
                    let target = stage_value(*start_vus as f64, stages, t).round().max(0.0) as usize;
                    looping.retain(|l| !l.handle.is_finished());
                    while looping.len() < target {
                        looping.push(spawn_looping(run.clone(), next_vu, live.clone()));
                        next_vu += 1;
                    }
                    while looping.len() > target {
                        if let Some(l) = looping.pop() {
                            l.stop.store(true, Ordering::SeqCst);
                        }
                    }
                }
                if t >= planned {
                    run.stopping.store(true, Ordering::SeqCst);
                }
            }
            Profile::ArrivalRate {
                start_rate,
                time_unit_s,
                stages,
                max_vus,
                ..
            } => {
                if !stopping {
                    let unit = time_unit_s.max(0.001);
                    let due = (stage_integral(*start_rate, stages, t.min(planned)) / unit).floor() as u64;
                    let mut dropped = 0;
                    while started_iters < due {
                        if idle.load(Ordering::SeqCst) == 0 {
                            if (workers.len() as u32) < *max_vus {
                                spawn_worker(next_vu, &mut workers);
                                next_vu += 1;
                            } else {
                                dropped += 1;
                                started_iters += 1;
                                continue;
                            }
                        }
                        let _ = ticket_tx.send(started_iters);
                        started_iters += 1;
                    }
                    if dropped > 0 {
                        run.metrics.lock().unwrap().record_dropped(sec, dropped);
                    }
                }
                if t >= planned {
                    run.stopping.store(true, Ordering::SeqCst);
                }
            }
            Profile::Iterations { max_duration_s, .. } => {
                if t >= *max_duration_s as f64 {
                    run.stopping.store(true, Ordering::SeqCst);
                    run.reason.lock().unwrap().get_or_insert_with(|| "Max duration reached".into());
                }
            }
        }
        let vus = live.load(Ordering::SeqCst);
        run.vus.store(vus, Ordering::SeqCst);
        {
            let mut m = run.metrics.lock().unwrap();
            m.set_vus(sec, vus);
            m.flush(sec, vus);
        }
        // Thresholds marked abort-on-fail, every 2 s.
        if t - last_threshold_check >= 2.0 && !run.stopping.load(Ordering::Relaxed) {
            last_threshold_check = t;
            let ths: Vec<_> = run
                .scenario
                .thresholds
                .iter()
                .filter(|th| th.abort_on_fail && t >= th.delay_s as f64)
                .cloned()
                .collect();
            if !ths.is_empty() {
                let s = run.summary();
                if let Some(bad) = thresholds::first_failure(&s, &ths) {
                    *run.reason.lock().unwrap() = Some(format!("Aborted: threshold `{bad}` failed"));
                    run.stopping.store(true, Ordering::SeqCst);
                }
            }
        }
        let all_done = match &run.scenario.profile {
            Profile::Iterations { .. } => workers.iter().all(|w| w.is_finished()),
            _ => false,
        };
        if all_done {
            run.stopping.store(true, Ordering::SeqCst);
        }
        if run.stopping.load(Ordering::Relaxed) {
            break;
        }
        tokio::time::sleep(tick).await;
    }

    // Graceful stop: let in-flight iterations finish, then kill.
    *run.state.lock().unwrap() = "stopping".into();
    drop(ticket_tx);
    for l in &looping {
        l.stop.store(true, Ordering::SeqCst);
    }
    let grace = match &run.scenario.profile {
        Profile::RampingVus { graceful_stop_s, .. } | Profile::ArrivalRate { graceful_stop_s, .. } => {
            *graceful_stop_s
        }
        Profile::Iterations { .. } => 30,
    };
    let deadline = Instant::now() + Duration::from_secs(grace);
    while live.load(Ordering::SeqCst) > 0 && Instant::now() < deadline && !run.killed.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let sec = run.sec();
        let vus = live.load(Ordering::SeqCst);
        run.vus.store(vus, Ordering::SeqCst);
        let mut m = run.metrics.lock().unwrap();
        m.set_vus(sec, vus);
        m.flush(sec, vus);
    }
    run.killed.store(true, Ordering::SeqCst);
    for l in looping {
        l.handle.abort();
    }
    for w in workers {
        w.abort();
    }
    run.vus.store(0, Ordering::SeqCst);
    let end_sec = run.elapsed().ceil() as u64;
    run.metrics.lock().unwrap().flush(end_sec.max(1), 0);
    let summary = run.summary();
    let aborted = run.reason.lock().unwrap().clone();
    let state = if aborted.as_deref().map(|r| r.starts_with("Aborted")).unwrap_or(false) {
        "aborted"
    } else {
        "finished"
    };
    let record = json!({
        "id": run.id,
        "name": run.scenario.name,
        "meta": run.meta,
        "state": state,
        "reason": aborted,
        "startedAt": run.started_at.to_rfc3339(),
        "endedAt": chrono::Utc::now().to_rfc3339(),
        "scenario": run.scenario,
        "summary": summary,
        "timeline": run.metrics.lock().unwrap().timeline,
        "heatBoundsMs": super::metrics::HEAT_BOUNDS_MS,
    });
    let _ = crate::store::put("loadRuns", &run.id, &record);
    *run.result.lock().unwrap() = Some(record);
    *run.state.lock().unwrap() = state.into();
}

/// Live status for the dashboard: timeline points after `since` plus a fresh summary.
pub fn status(id: &str, since: Option<u64>) -> Result<Value> {
    let run = get(id)?;
    let state = run.state.lock().unwrap().clone();
    if let Some(done) = run.result.lock().unwrap().clone() {
        return Ok(json!({ "state": state, "done": true, "run": done }));
    }
    let points: Vec<Value> = {
        let m = run.metrics.lock().unwrap();
        m.timeline
            .iter()
            .filter(|p| since.map(|s| p.t > s).unwrap_or(true))
            .map(|p| serde_json::to_value(p).unwrap_or(Value::Null))
            .collect()
    };
    Ok(json!({
        "state": state,
        "done": false,
        "elapsedS": run.elapsed(),
        "plannedS": run.scenario.profile.planned_s(),
        "vus": run.vus.load(Ordering::SeqCst),
        "points": points,
        "summary": run.summary(),
        "reason": *run.reason.lock().unwrap(),
        "heatBoundsMs": super::metrics::HEAT_BOUNDS_MS,
    }))
}

/// Run one iteration with a single VU and report what each step did (scenario debugger).
pub async fn debug(scenario: Scenario) -> Result<Value> {
    crate::http::init_tls();
    let mut vars: HashMap<String, String> =
        scenario.variables.iter().map(|kv| (kv.key.clone(), kv.value.clone())).collect();
    if let Some(ds) = &scenario.data {
        if let Some(row) = ds.rows.first() {
            vars.extend(row.clone());
        }
    }
    vars.insert("__VU".into(), "1".into());
    vars.insert("__ITER".into(), "0".into());
    let o = request_options(&scenario);
    let client = crate::http::build_client(&o, o.cookies.then(|| Arc::new(CookieStoreMutex::default())))?;
    let mut out = Vec::new();
    for step in scenario.steps.iter().filter(|s| s.enabled) {
        let mut spec = vars::resolve_request(&step.request, &vars);
        spec.options = o.clone();
        let unresolved: Vec<String> = find_unresolved(&spec.url)
            .into_iter()
            .chain(spec.headers.iter().flat_map(|h| find_unresolved(&h.value)))
            .collect();
        match crate::http::execute(&client, &spec).await {
            Ok(raw) => {
                let headers: Vec<(String, String)> = raw
                    .headers
                    .iter()
                    .map(|(k, v)| (k.as_str().to_string(), String::from_utf8_lossy(v.as_bytes()).to_string()))
                    .collect();
                let body = String::from_utf8_lossy(&raw.body).to_string();
                let obs = Observed::new(raw.status, raw.timings.total_ms, raw.size, &headers, &body);
                let checks: Vec<Value> = step
                    .checks
                    .iter()
                    .filter(|c| c.enabled)
                    .map(|c| json!({"name": rules::rule_name(c), "pass": rules::check(c, &obs)}))
                    .collect();
                let mut extracted = serde_json::Map::new();
                for ex in &step.extract {
                    let v = rules::extract(ex, &obs);
                    if let Some(v) = &v {
                        vars.insert(ex.var.clone(), v.clone());
                    }
                    extracted.insert(ex.var.clone(), v.map(Value::String).unwrap_or(Value::Null));
                }
                out.push(json!({
                    "step": step.id, "name": step.name,
                    "method": spec.method, "url": spec.url,
                    "status": raw.status, "durationMs": raw.timings.total_ms,
                    "size": raw.size, "checks": checks, "extracted": extracted,
                    "unresolved": unresolved,
                    "expected": rules::expected(raw.status, &scenario.options.expected_status),
                    "body": body.chars().take(4000).collect::<String>(),
                }));
            }
            Err(e) => out.push(json!({
                "step": step.id, "name": step.name, "method": spec.method, "url": spec.url,
                "error": e.to_string(), "unresolved": unresolved,
            })),
        }
    }
    Ok(json!({ "steps": out }))
}

fn find_unresolved(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = s;
    while let Some(i) = rest.find("{{") {
        let after = &rest[i + 2..];
        if let Some(j) = after.find("}}") {
            out.push(after[..j].to_string());
            rest = &after[j + 2..];
        } else {
            break;
        }
    }
    out
}
