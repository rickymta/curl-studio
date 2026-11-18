//! Load and performance testing: k6-style executors (ramping VUs, arrival rate, shared
//! iterations), JMeter-style assertions/extractors and aggregate reports, live per-second
//! metrics and thresholds.

pub mod engine;
pub mod metrics;
pub mod model;
pub mod rules;
pub mod thresholds;

pub use engine::{debug, start, status, stop};
pub use model::Scenario;
