//! MiniApp lifecycle-script execution.
//!
//! Runs a resolved lifecycle script (see
//! [`bitfun_product_domains::miniapp::lifecycle::plan_lifecycle_script`]) as a
//! one-shot child process using the detected JS runtime (Bun/Node), through the
//! shared non-interactive process facade so no console window flashes on Windows
//! and GUI/headless hosts behave identically.
//!
//! Path containment and event selection are pure decisions owned by
//! `bitfun-product-domains`; this module only performs the concrete process
//! execution and result capture.

use bitfun_product_domains::miniapp::runtime::DetectedRuntime;
use std::path::Path;
use std::process::Output;
use std::time::Duration;

/// Default per-script timeout when the caller does not specify one.
pub const DEFAULT_LIFECYCLE_TIMEOUT_MS: u64 = 30_000;

/// Result of running a lifecycle script.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LifecycleScriptOutcome {
    pub succeeded: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl LifecycleScriptOutcome {
    /// Build an outcome from a finished process `Output`. Kept pure and separate
    /// from spawning so the success/exit-code/stream mapping is unit-testable.
    pub fn from_output(output: &Output) -> Self {
        Self {
            succeeded: output.status.success(),
            exit_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }
    }
}

/// Run `script_path` with `runtime`, using `app_dir` as the working directory.
///
/// The script path must already be validated as contained within the app
/// directory by the caller. Returns an error only when the process cannot be
/// spawned/awaited or exceeds `timeout_ms`; a script that runs but exits
/// non-zero returns `Ok` with `succeeded == false` so the caller can decide how
/// to react per event.
pub async fn run_lifecycle_script(
    runtime: &DetectedRuntime,
    script_path: &Path,
    app_dir: &Path,
    timeout_ms: u64,
) -> Result<LifecycleScriptOutcome, String> {
    let exe = runtime.path.to_string_lossy();
    let script = script_path.to_string_lossy();

    let mut command = bitfun_services_core::process_manager::create_tokio_command(&*exe);
    command
        .arg(&*script)
        .current_dir(app_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let effective_timeout = if timeout_ms == 0 {
        DEFAULT_LIFECYCLE_TIMEOUT_MS
    } else {
        timeout_ms
    };

    let run = command.output();
    match tokio::time::timeout(Duration::from_millis(effective_timeout), run).await {
        Ok(Ok(output)) => Ok(LifecycleScriptOutcome::from_output(&output)),
        Ok(Err(error)) => Err(format!("Failed to run lifecycle script: {error}")),
        Err(_) => Err(format!(
            "Lifecycle script timed out after {effective_timeout}ms"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_product_domains::miniapp::runtime::{detect_runtime, RuntimeKind};

    #[cfg(unix)]
    fn output_from(code: i32, stdout: &str, stderr: &str) -> Output {
        // Constructing an ExitStatus directly is only supported on Unix; the
        // stream/exit-code mapping under test is platform-independent.
        use std::os::unix::process::ExitStatusExt;
        Output {
            status: std::process::ExitStatus::from_raw((code & 0xff) << 8),
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
        }
    }

    #[cfg(unix)]
    #[test]
    fn from_output_maps_success_and_streams() {
        let ok = LifecycleScriptOutcome::from_output(&output_from(0, "hello", ""));
        assert!(ok.succeeded);
        assert_eq!(ok.exit_code, Some(0));
        assert_eq!(ok.stdout, "hello");
        assert_eq!(ok.stderr, "");

        let failed = LifecycleScriptOutcome::from_output(&output_from(3, "", "boom"));
        assert!(!failed.succeeded);
        assert_eq!(failed.exit_code, Some(3));
        assert_eq!(failed.stderr, "boom");
    }

    #[tokio::test]
    async fn runs_a_real_script_when_a_js_runtime_is_available() {
        // Hermetic-friendly: skip when no Bun/Node is present (e.g. minimal CI).
        let Some(runtime) = detect_runtime() else {
            eprintln!("no JS runtime detected; skipping live lifecycle-script run");
            return;
        };

        let dir = std::env::temp_dir().join(format!("miniapp-lifecycle-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("hook.js");
        // Print to stdout, then exit non-zero to prove exit-code capture.
        std::fs::write(
            &script,
            "console.log('lifecycle-ok'); process.exit(2);\n",
        )
        .unwrap();

        let outcome = run_lifecycle_script(&runtime, &script, &dir, 10_000)
            .await
            .expect("script should run");

        assert!(outcome.stdout.contains("lifecycle-ok"));
        assert!(!outcome.succeeded);
        // Bun and Node both honor process.exit(2).
        assert_eq!(outcome.exit_code, Some(2));
        assert!(matches!(runtime.kind, RuntimeKind::Bun | RuntimeKind::Node));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
