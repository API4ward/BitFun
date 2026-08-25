//! MiniApp types — data model and permissions (V2: ESM UI + Node Worker).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// ESM dependency for Import Map (browser UI).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EsmDep {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// NPM dependency for Worker (package.json).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NpmDep {
    pub name: String,
    pub version: String,
}

/// MiniApp source: UI layer (browser) + Worker layer (Node.js).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MiniAppSource {
    pub html: String,
    pub css: String,
    /// ESM module code running in the browser.
    #[serde(rename = "ui_js")]
    pub ui_js: String,
    #[serde(default, rename = "esm_dependencies")]
    pub esm_dependencies: Vec<EsmDep>,
    /// Node.js Worker logic (source/worker.js).
    #[serde(rename = "worker_js")]
    pub worker_js: String,
    #[serde(default, rename = "npm_dependencies")]
    pub npm_dependencies: Vec<NpmDep>,
}

/// Permissions manifest (resolved to policy for JS Worker).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppPermissions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fs: Option<FsPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell: Option<ShellPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub net: Option<NetPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<NodePermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai: Option<AiPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notifications: Option<NotificationPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<HostPermissions>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FsPermissions {
    /// Path scopes: "{appdata}", "{workspace}", "{home}", or absolute paths.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellPermissions {
    /// Command allowlist (e.g. ["git", "ffmpeg"]). Empty = all forbidden.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NetPermissions {
    /// Domain allowlist. "*" = all.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow: Option<Vec<String>>,
}

/// Node.js Worker permissions (memory, timeout).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodePermissions {
    #[serde(default = "default_node_enabled")]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_memory_mb: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

fn default_node_enabled() -> bool {
    true
}

/// AI permissions — controls access to the host application's AI client.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiPermissions {
    /// Whether AI access is enabled for this MiniApp.
    #[serde(default)]
    pub enabled: bool,
    /// Allowed model references (e.g. ["primary", "fast"] or specific model ids).
    /// Empty or absent means only "primary" is allowed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_models: Option<Vec<String>>,
    /// Maximum output tokens per single request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens_per_request: Option<u32>,
    /// Maximum number of AI requests per minute (per app).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_per_minute: Option<u32>,
}

/// Full agent-run permissions for MiniApps.
///
/// Unlike `AiPermissions` (raw single-call LLM access), this grants the MiniApp the
/// ability to run complete host agent turns (agent loop with tools such as
/// WebSearch/WebFetch and skills) through the host agent bridge.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentPermissions {
    /// Whether full agent-run access is enabled for this MiniApp.
    #[serde(default)]
    pub enabled: bool,
    /// Maximum number of agent runs per minute (per app). 0 / absent = unlimited.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_per_minute: Option<u32>,
}

/// Host notification permissions for MiniApps.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationPermissions {
    #[serde(default)]
    pub system: bool,
}

/// Trusted-host UI capabilities. Marketplace MiniApps default-deny every
/// capability in this group when the field is absent.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostPermissions {
    #[serde(default)]
    pub dialog: bool,
    #[serde(default)]
    pub clipboard_read: bool,
    #[serde(default)]
    pub clipboard_write: bool,
    #[serde(default)]
    pub open_external: bool,
    #[serde(default)]
    pub reveal_in_folder: bool,
    #[serde(default)]
    pub deck_render: bool,
    #[serde(default)]
    pub chat_composer: bool,
    #[serde(default)]
    pub system_info: bool,
}

/// Per-locale overrides for user-facing strings (gallery name / description / tags).
///
/// Lives optionally in `meta.json` as `i18n.locales[<locale-id>]`. Whichever fields are
/// present override the top-level `name`/`description`/`tags`; missing fields fall back
/// to the top-level value (which itself acts as the default / fallback locale).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppLocaleStrings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

/// MiniApp i18n bundle.
///
/// Map key is a locale id (e.g. `"zh-CN"`, `"en-US"`). The frontend picks the best
/// match using `currentLanguage → "en-US" → "zh-CN" → top-level name/description`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppI18n {
    #[serde(default)]
    pub locales: HashMap<String, MiniAppLocaleStrings>,
}

/// AI context for iteration (stored in meta, not in compiled HTML).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MiniAppAiContext {
    pub original_prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub iteration_history: Vec<String>,
}

/// Runtime lifecycle state persisted in meta.json.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct MiniAppRuntimeState {
    /// Revision used for UI / source lifecycle changes.
    pub source_revision: String,
    /// Stable hash of the persisted MiniApp content, excluding version/runtime metadata.
    ///
    /// Direct file edits leave this value unchanged until the MiniApp is finalized,
    /// which lets the lifecycle distinguish a real content update from a recompile.
    pub content_hash: String,
    /// Revision derived from npm dependencies.
    pub deps_revision: String,
    /// Dependencies changed and need install before reliable worker startup.
    pub deps_dirty: bool,
    /// Worker should be restarted on next runtime use.
    pub worker_restart_required: bool,
    /// UI assets should be recompiled before next render.
    pub ui_recompile_required: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MiniAppRuntimeProfile {
    #[default]
    Compatibility,
    MarketStrict,
}

/// How a MiniApp is presented in the host shell.
///
/// - `Background`: collapsed into a compact panel (dock/side rail) that keeps the
///   app resident without occupying the main content area.
/// - `Front` (default): opens inside a tab in the main content scene area.
/// - `Full`: opens in its own independent OS window, detached from the main shell.
///
/// Persisted in `meta.json` as `view_mode`; absent values default to `Front` so
/// existing installs keep their current in-tab behavior after an upgrade.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MiniAppViewMode {
    Background,
    #[default]
    Front,
    Full,
}

impl MiniAppViewMode {
    /// Stable wire identifier shared with the frontend and Tauri layer.
    pub fn as_str(&self) -> &'static str {
        match self {
            MiniAppViewMode::Background => "background",
            MiniAppViewMode::Front => "front",
            MiniAppViewMode::Full => "full",
        }
    }

    /// Parse a wire identifier; unknown values fall back to the default (`Front`).
    pub fn from_wire(value: &str) -> Self {
        match value {
            "background" => MiniAppViewMode::Background,
            "full" => MiniAppViewMode::Full,
            _ => MiniAppViewMode::Front,
        }
    }
}

/// A MiniApp lifecycle transition that can trigger a user-defined script.
///
/// The host runs the matching script (see [`MiniAppLifecycleScripts`]) at each
/// transition:
/// - `Install`: after the app's files are committed to disk for the first time.
/// - `Uninstall`: before the app directory is removed.
/// - `Start`: when the app is activated / its worker is brought up.
/// - `Stop`: when the app is deactivated / its worker is torn down.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MiniAppLifecycleEvent {
    Install,
    Uninstall,
    Start,
    Stop,
}

impl MiniAppLifecycleEvent {
    /// Stable wire identifier shared with the frontend and Tauri layer.
    pub fn as_str(&self) -> &'static str {
        match self {
            MiniAppLifecycleEvent::Install => "install",
            MiniAppLifecycleEvent::Uninstall => "uninstall",
            MiniAppLifecycleEvent::Start => "start",
            MiniAppLifecycleEvent::Stop => "stop",
        }
    }

    /// Parse a wire identifier.
    pub fn from_wire(value: &str) -> Option<Self> {
        match value {
            "install" => Some(MiniAppLifecycleEvent::Install),
            "uninstall" => Some(MiniAppLifecycleEvent::Uninstall),
            "start" => Some(MiniAppLifecycleEvent::Start),
            "stop" => Some(MiniAppLifecycleEvent::Stop),
            _ => None,
        }
    }

    /// All lifecycle events, in canonical order.
    pub fn all() -> [MiniAppLifecycleEvent; 4] {
        [
            MiniAppLifecycleEvent::Install,
            MiniAppLifecycleEvent::Uninstall,
            MiniAppLifecycleEvent::Start,
            MiniAppLifecycleEvent::Stop,
        ]
    }
}

/// User-declared scripts run at MiniApp lifecycle transitions.
///
/// Each value is a path relative to the app root (for example `hooks/install.js`
/// or `worker.js`). The host resolves it against the app directory, rejecting any
/// path that escapes the app root, and executes it with the detected JS runtime
/// (Bun/Node). Absent entries mean "no script for this event".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppLifecycleScripts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uninstall: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop: Option<String>,
}

impl MiniAppLifecycleScripts {
    /// The declared script for `event`, if any (trimmed, non-empty).
    pub fn script_for(&self, event: MiniAppLifecycleEvent) -> Option<&str> {
        let raw = match event {
            MiniAppLifecycleEvent::Install => self.install.as_deref(),
            MiniAppLifecycleEvent::Uninstall => self.uninstall.as_deref(),
            MiniAppLifecycleEvent::Start => self.start.as_deref(),
            MiniAppLifecycleEvent::Stop => self.stop.as_deref(),
        };
        raw.map(str::trim).filter(|value| !value.is_empty())
    }

    /// Whether no lifecycle script is declared. Used by `skip_serializing_if` so
    /// apps without hooks keep a clean `meta.json`.
    pub fn is_empty(&self) -> bool {
        MiniAppLifecycleEvent::all()
            .iter()
            .all(|event| self.script_for(*event).is_none())
    }
}

/// A named, user-declared script that extends a MiniApp's capabilities.
///
/// Unlike the fixed lifecycle hooks, named scripts are arbitrary commands the
/// app author ships (recommended under `scripts/`), invokable on demand by the
/// user, the app UI (via the host bridge), or the agent. `path` is resolved
/// against the app root with the same traversal guard as lifecycle scripts and
/// run with the detected JS runtime (Bun/Node).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppScriptDef {
    /// Stable identifier used to invoke the script (e.g. `build`, `sync`).
    pub name: String,
    /// Path to the script file, relative to the app root.
    pub path: String,
    /// Optional human-facing description shown in the UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl MiniAppScriptDef {
    /// The script path if both `name` and `path` are non-empty after trimming.
    pub fn resolved_path(&self) -> Option<&str> {
        let path = self.path.trim();
        if self.name.trim().is_empty() || path.is_empty() {
            None
        } else {
            Some(path)
        }
    }
}

/// Look up a declared script by name (trimmed, exact match) and return its
/// relative path.
pub fn find_script_path<'a>(scripts: &'a [MiniAppScriptDef], name: &str) -> Option<&'a str> {
    let target = name.trim();
    scripts
        .iter()
        .find(|script| script.name.trim() == target)
        .and_then(MiniAppScriptDef::resolved_path)
}

/// Full MiniApp entity (in-memory / API).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MiniApp {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub version: u32,
    pub created_at: i64,
    pub updated_at: i64,

    pub source: MiniAppSource,
    /// Assembled HTML with Import Map + Runtime Adapter (generated by compiler).
    pub compiled_html: String,

    #[serde(default)]
    pub permissions: MiniAppPermissions,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_context: Option<MiniAppAiContext>,

    #[serde(default)]
    pub runtime: MiniAppRuntimeState,

    #[serde(default)]
    pub runtime_profile: MiniAppRuntimeProfile,

    /// How the app is presented in the host shell (background panel / front tab /
    /// full window). Defaults to `Front`.
    #[serde(default)]
    pub view_mode: MiniAppViewMode,

    /// User-declared lifecycle scripts (install / uninstall / start / stop).
    #[serde(default, skip_serializing_if = "MiniAppLifecycleScripts::is_empty")]
    pub lifecycle: MiniAppLifecycleScripts,

    /// Named scripts the app ships to extend its capabilities.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scripts: Vec<MiniAppScriptDef>,

    /// Optional per-locale overrides for `name` / `description` / `tags`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub i18n: Option<MiniAppI18n>,
}

/// MiniApp metadata only (for list views; no source/compiled_html).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MiniAppMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub version: u32,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub permissions: MiniAppPermissions,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_context: Option<MiniAppAiContext>,
    #[serde(default)]
    pub runtime: MiniAppRuntimeState,
    #[serde(default)]
    pub runtime_profile: MiniAppRuntimeProfile,
    /// How the app is presented in the host shell. Defaults to `Front`.
    #[serde(default)]
    pub view_mode: MiniAppViewMode,
    /// User-declared lifecycle scripts (install / uninstall / start / stop).
    #[serde(default, skip_serializing_if = "MiniAppLifecycleScripts::is_empty")]
    pub lifecycle: MiniAppLifecycleScripts,
    /// Named scripts the app ships to extend its capabilities.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scripts: Vec<MiniAppScriptDef>,
    /// Optional per-locale overrides for `name` / `description` / `tags`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub i18n: Option<MiniAppI18n>,
}

impl From<&MiniApp> for MiniAppMeta {
    fn from(app: &MiniApp) -> Self {
        Self {
            id: app.id.clone(),
            name: app.name.clone(),
            description: app.description.clone(),
            icon: app.icon.clone(),
            category: app.category.clone(),
            tags: app.tags.clone(),
            version: app.version,
            created_at: app.created_at,
            updated_at: app.updated_at,
            permissions: app.permissions.clone(),
            ai_context: app.ai_context.clone(),
            runtime: app.runtime.clone(),
            runtime_profile: app.runtime_profile,
            view_mode: app.view_mode,
            lifecycle: app.lifecycle.clone(),
            scripts: app.scripts.clone(),
            i18n: app.i18n.clone(),
        }
    }
}

/// Path scope for permission policy resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathScope {
    AppData,
    Workspace,
    UserSelected,
    Home,
    Custom(Vec<std::path::PathBuf>),
}

impl PathScope {
    pub fn from_manifest_value(s: &str) -> Self {
        match s {
            "{appdata}" => PathScope::AppData,
            "{workspace}" => PathScope::Workspace,
            "{user-selected}" => PathScope::UserSelected,
            "{home}" => PathScope::Home,
            _ => PathScope::Custom(vec![std::path::PathBuf::from(s)]),
        }
    }
}
