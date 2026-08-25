# Mini App System — Design Specification

**English** · Status: living specification (implemented incrementally)

This document is the design specification for BitFun's **Mini App** system. It
defines three things the runtime and UI must agree on:

1. **Lifecycle events** — `install`, `uninstall`, `start`, `stop`, each of which
   may trigger a user-defined script.
2. **View modes** — `background` (collapsed into a panel), `front` (default, in a
   tab), and `full` (an independent OS window).
3. **App management** — the standardized on-disk location and directory
   structure for an installed app.

It complements the architecture map in
[`product-architecture.md`](../architecture/product-architecture.md) and the
security boundary in
[`../sdlc-harness/architecture/security-boundary.md`](../sdlc-harness/architecture/security-boundary.md).
It does **not** cover BitFun Pages / Page Functions
(`bitfun-page-function-runtime`), which are a separate relay-hosted system.

Layer ownership follows the repository boundary rules:

| Concern | Owner layer | Crate / path |
| --- | --- | --- |
| Data shapes, pure lifecycle/view-mode decisions, path contract | Contracts | `src/crates/contracts/product-domains/src/miniapp` |
| Concrete filesystem IO, worker/script process execution | Services | `src/crates/services/services-integrations/src/miniapp` |
| Manager orchestration, `PathManager` wiring, event emission | Assembly | `src/crates/assembly/core/src/miniapp` |
| Tauri commands, independent windows | Interface (desktop) | `src/apps/desktop/src/api` |
| Gallery, scenes, panels, window hosting | Interface (web-ui) | `src/web-ui/src/app/scenes/miniapps` |

---

## 1. App management: local path and directory structure

### 1.1 Root location

Mini App data is **user-scoped**, not workspace-scoped. The root is resolved by
`PathManager`:

- `miniapps_dir()` → `{user_root}/data/miniapps/`
- `miniapp_dir(app_id)` → `{user_root}/data/miniapps/{app_id}/`

`{user_root}` is the platform BitFun home:

| OS | `{user_root}` |
| --- | --- |
| Linux | `~/.config/bitfun` |
| macOS | `~/Library/Application Support/BitFun` |
| Windows | `%APPDATA%/BitFun` |

The frontend mirrors the segment as `MINIAPP_DATA_PATH_SEGMENT =
'/data/miniapps/'`. Workspace services explicitly exclude these paths from
workspace files.

`app_id` is a UUID v4 for user-created / imported / draft apps; built-ins use a
stable `builtin-*` id.

### 1.2 Per-app directory layout

The canonical layout (owned by `MiniAppStorageLayout` in
`product-domains/.../miniapp/storage.rs`):

```
{user_root}/data/miniapps/{app_id}/
├── meta.json              # MiniAppMeta: identity, permissions, runtime state,
│                          #   view_mode, lifecycle scripts, i18n
├── compiled.html          # Generated sandbox document (UI + import map + bridge)
├── package.json           # npm deps for the worker
├── storage.json           # App key/value storage
├── .customization.json    # Origin / market / override metadata
├── .builtin-manifest.json # Built-in seed marker (built-ins only)
├── source/
│   ├── index.html
│   ├── style.css
│   ├── ui.js              # ESM browser module
│   ├── worker.js          # Node/Bun worker entry
│   └── esm_dependencies.json
├── hooks/                 # (optional) lifecycle scripts — see §2
│   ├── install.js
│   ├── uninstall.js
│   ├── start.js
│   └── stop.js
├── scripts/               # (optional) named capability scripts — see §2b
│   └── <name>.js
└── versions/
    └── v{N}.json          # Full snapshots for rollback
```

Drafts live under a sibling sandbox and never touch the active app until
applied:

```
{user_root}/data/miniapps/.drafts/{app_id}/{draft_id}/
```

Market install/update/rollback use temporary staging dirs
(`.market-install-*`, `.market-update-*`, `.market-rollback-*`) and commit
atomically so a failed install never leaves a half-written app.

The `hooks/` directory is a **recommended convention** (constant
`HOOKS_DIR = "hooks"`), not a hard requirement: a lifecycle script path is any
path relative to the app root (see §2.2). When an app is imported from a folder,
the whole `hooks/` directory is copied into the installed app dir so declared
lifecycle scripts exist at runtime.

---

## 2. Lifecycle events and scripts

### 2.1 Events

A Mini App has four host-driven lifecycle transitions
(`MiniAppLifecycleEvent`):

| Event | When it fires | Typical use |
| --- | --- | --- |
| `install` | After the app's files are first committed to disk (create / import / market install) | Fetch assets, initialize `storage.json`, scaffold data |
| `uninstall` | Before the app directory is removed | Clean up external state, revoke tokens |
| `start` | When the app is activated / its worker is brought up | Warm caches, open connections |
| `stop` | When the app is deactivated / its worker is torn down | Flush state, close connections |

These are distinct from the in-iframe UI hooks (`app.onActivate` /
`app.onDeactivate`) exposed by the bridge, which react to focus changes inside
an already-running app. Lifecycle scripts run in the **host JS runtime**
(Bun/Node), not in the sandboxed iframe.

### 2.2 Declaring scripts

Scripts are declared in `meta.json` under `lifecycle`
(`MiniAppLifecycleScripts`):

```json
{
  "lifecycle": {
    "install": "hooks/install.js",
    "uninstall": "hooks/uninstall.js",
    "start": "hooks/start.js",
    "stop": "hooks/stop.js"
  }
}
```

Rules:

- Each value is a path **relative to the app root**. `hooks/install.js` and
  `worker.js` are both valid; the recommended location is `hooks/`.
- Whitespace-only or absent entries mean "no script for this event".
- The field is omitted from `meta.json` entirely when no scripts are declared
  (`skip_serializing_if`), so existing apps are unaffected.

### 2.3 Resolution and safety

Path resolution is a **pure decision** in the contracts layer
(`plan_lifecycle_script` → `MiniAppStorageLayout::resolve_contained_relative`):

- The relative path is resolved against the app directory.
- Absolute paths, `..` parent components, and root/drive prefixes are
  **rejected** — a script can never escape its own app directory.
- A path that resolves back to the app root itself is rejected.

The services layer then confirms the file exists and executes it; the contracts
layer never touches the filesystem.

### 2.4 Execution semantics

- Scripts run with the detected runtime (`RuntimeKind::Bun` preferred, else
  `Node`), using the same non-interactive process facade as the worker
  (`bitfun_services_core::process_manager`), so no console window flashes on
  Windows and GUI/headless hosts behave identically.
- The working directory is the app directory; the resolved script path is
  passed as the entry.
- Scripts run with the app's resolved permission policy (fs/net/shell scopes),
  identical to the worker, so a lifecycle script cannot exceed what the app is
  already granted.
- Each run emits a `miniapp-lifecycle` event
  (`{ id, event, script, succeeded, exitCode, error }`) for the UI / telemetry,
  and the desktop command returns the outcome to the caller.
- Lifecycle scripts are **best-effort**: a failing script (non-zero exit,
  missing file, traversal attempt, or no runtime) is surfaced via the event,
  the command result, and logs, but it does **not** abort or roll back the
  surrounding flow. `install` runs after the app is committed, `uninstall` runs
  before removal (an app must always be removable), and `stop` runs as part of
  worker teardown. This mirrors how npm lifecycle scripts behave and keeps the
  app store consistent even when a hook misbehaves; authors that need hard
  guarantees should assert inside the script and react to the reported failure.

---

## 2b. Named scripts (capability extension)

Beyond the four fixed lifecycle hooks, an app may ship **named scripts** to
extend its capabilities — arbitrary commands the author bundles (recommended
under `scripts/`) and invokes on demand.

Declared in `meta.json` under `scripts` (`Vec<MiniAppScriptDef>`):

```json
{
  "scripts": [
    { "name": "build", "path": "scripts/build.js", "description": "Rebuild output" },
    { "name": "sync",  "path": "scripts/sync.js" }
  ]
}
```

- `name` is the stable invocation id; `path` is resolved against the app root
  with the same traversal guard as lifecycle scripts (`find_script_path` +
  `plan_named_script`), and run with the detected JS runtime.
- Invocation: `MiniAppManager::run_named_script(app_id, name, args)` →
  desktop command `miniapp_run_script` (emits a `miniapp-script` event with the
  outcome). The gallery detail modal lists declared scripts with a Run button;
  `MiniAppAPI.runScript` / `setScripts` back it.
- Execution semantics match §2.4: trusted host code in the app dir, with
  `BITFUN_MINIAPP_{ID,DIR,SCRIPT,POLICY}` env and forwarded CLI `args`,
  captured stdout/stderr/exit-code, best-effort (failures surfaced, never
  auto-rollback).
- Named scripts are part of the content hash and carried on import (the
  `scripts/` directory travels with the app).

## 3. View modes

### 3.1 Modes

`MiniAppViewMode` (persisted in `meta.json` as `view_mode`) selects how the host
presents the app:

| Mode | Wire value | Presentation |
| --- | --- | --- |
| `Background` | `background` | Collapsed into a compact resident panel (dock / side rail). Stays running without occupying the main content area. |
| `Front` (default) | `front` | Opens inside a tab in the main content scene area. This is today's behavior and the default for existing apps. |
| `Full` | `full` | Opens in its own independent OS window, detached from the main shell. |

`view_mode` defaults to `Front`; unknown wire values fall back to `Front`
(`MiniAppViewMode::from_wire`), so an older client reading a newer mode degrades
to a tab rather than failing.

### 3.2 Semantics

- The mode is a **persisted app property** (part of the content hash), editable
  by the author and via the view-mode command; it is the app's default
  presentation.
- The runtime may still let the user temporarily relocate an open app (e.g.
  pop a `front` app out to a window), but the persisted `view_mode` is the
  restore default.
- `background` apps keep their worker resident and surface through the nav
  running-apps entry and a compact panel; they do not claim a scene tab.
- `full` apps are hosted in an independent desktop window that loads the same
  compiled document and bridge as the tab host, so behavior and permissions are
  identical across modes.

### 3.3 Remote / non-desktop surfaces

View mode is a presentation hint. Surfaces that cannot honor a mode (mobile web,
CLl/TUI, peer host) must degrade explicitly to their supported presentation
(typically `front`-equivalent) rather than silently dropping the app, per the
repository's "degrade loudly" rule.

---

## 4. Data model and upgrade compatibility

`MiniApp` and `MiniAppMeta` gain two additive, defaulted fields:

- `view_mode: MiniAppViewMode` — `#[serde(default)]`, defaults to `Front`.
- `lifecycle: MiniAppLifecycleScripts` — `#[serde(default)]`, omitted when empty.

Both are included in `miniapp_content_hash`, so editing them is tracked like any
other content change. Because both deserialize from absent values, **existing
`meta.json` files load unchanged** and keep their current behavior (in-tab, no
scripts) after an upgrade. No field that old data cannot supply is required, and
no persisted field is repurposed — consistent with the upgrade-compatibility
rules in the root `AGENTS.md`.

---

## 5. Implementation status

The specification is delivered incrementally. Current state:

- [x] Contracts: `MiniAppViewMode`, `MiniAppLifecycleEvent`,
      `MiniAppLifecycleScripts`, `view_mode` / `lifecycle` fields, `HOOKS_DIR`,
      safe path resolver, `plan_lifecycle_script`, and event payload — with unit
      and contract tests in `bitfun-product-domains`.
- [x] Services: `run_lifecycle_script` runs a resolved script (Bun/Node) via the
      non-interactive process facade, injecting app/event/policy env and
      capturing stdout/stderr/exit code, in `bitfun-services-integrations`.
- [x] Assembly: `MiniAppManager::run_lifecycle_event` (traversal-guarded resolve
      + runtime detect + run + report), `set_view_mode`, and
      `set_lifecycle_scripts`, wired to `PathManager` and the permission policy,
      with tests.
- [x] Desktop: Tauri commands `miniapp_set_view_mode`,
      `miniapp_set_lifecycle_scripts`, `miniapp_run_lifecycle_event`, and
      `open_miniapp_full_window`; automatic `install` (create/import),
      `uninstall` (delete), and `stop` (worker stop) dispatch with
      `miniapp-lifecycle` events.
- [x] Web UI: `MiniAppAPI` gains `setViewMode` / `setLifecycleScripts` /
      `runLifecycleEvent` / `openFullWindow` and `view_mode` / `lifecycle` types;
      opening an app branches on view mode — `full` opens an independent OS
      window via the `?bitfunWindow=miniapp` standalone render, `background`
      stays resident in the collapsed `MiniAppBackgroundDock` panel, `front`
      opens a tab — and fires the `start` lifecycle event on activation. The
      gallery detail modal exposes a view-mode selector (background / tab /
      window).

### Verified

- Contracts/services/assembly: `cargo test` for `bitfun-product-domains`
  (58 lib + 39 contract), `bitfun-services-integrations` miniapp runtime + import
  IO, and `bitfun-core` `miniapp::manager` (incl. a real hook-script run).
- View modes: GUI-verified live — `background` dock, `front` tab, and `full`
  window all open, and the full window renders real app content.
- Lifecycle: end-to-end verified — importing an app with an `install` hook runs
  the script during the install event (marker file written with `BITFUN_MINIAPP_*`
  env context), with `hooks/` carried into the installed app dir.

- [x] Named scripts: `MiniAppScriptDef` + `scripts` manifest field,
      `find_script_path` / `plan_named_script`, args-aware `run_miniapp_script`,
      `MiniAppManager::run_named_script` / `set_scripts`, desktop
      `miniapp_run_script` / `miniapp_set_scripts`, `MiniAppAPI` + gallery Run
      UI, `scripts/` carried on import — with contract + manager tests.
- [x] Built-in seed writes `BuiltinMiniAppBundle.extra_files` at the app root
      (hooks and named scripts). Existing builtins keep an empty list so their
      content hash is unchanged.
- [x] Built-in NetBreaker2 (`builtin-netbreaker2`) ships a Clash/mihomo TUN
      client: named scripts under `scripts/`, elevation wrappers, and lifecycle
      hooks. It is a second builtin and does not replace NetBreaker.

### Design boundary: scripts and the market

Lifecycle hooks and named scripts run as **trusted, host-privileged** code
(outside the iframe sandbox). They are therefore supported for **user-created
and folder-imported** apps, where the user is the author/installer of that code.

Market-distributed packages intentionally do **not** carry `hooks/` or
`scripts/`: the market ZIP is a strict, separately-validated whitelist
(`meta.json` + `source/*`), and allowing a downloaded package to ship
host-privileged scripts that auto-run on install would be a security escalation.
Bringing scripts to market apps is a future item that requires an explicit
review/consent model (and matching client + server validator changes), not a
simple whitelist widening.

Each subsequent change keeps this table current.
