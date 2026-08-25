//! User secret variables (`{{name}}`) facade for settings CRUD and tool resolution.
//!
//! Values live in an AES-GCM vault under the user data directory. Chat / model
//! history keep placeholders unchanged; only tool-argument resolution loads
//! plaintext on the executing host.

use crate::infrastructure::app_paths::path_manager::{get_path_manager_arc, PathManager};
use crate::util::errors::{BitFunError, BitFunResult};
use bitfun_core_types::{UserSecretSummary, UserSecretUpsert};
use bitfun_services_core::user_secrets::UserSecretsVault;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

static GLOBAL_USER_SECRETS: OnceLock<Arc<UserSecretsVault>> = OnceLock::new();

fn vault_for(path_manager: &PathManager) -> Arc<UserSecretsVault> {
    Arc::new(UserSecretsVault::new(path_manager.user_secrets_dir()))
}

/// Initialize the global vault (called once at desktop/CLI startup).
pub fn initialize_global_user_secrets(path_manager: Arc<PathManager>) {
    let _ = GLOBAL_USER_SECRETS.set(vault_for(path_manager.as_ref()));
}

fn global_vault() -> BitFunResult<Arc<UserSecretsVault>> {
    if let Some(vault) = GLOBAL_USER_SECRETS.get() {
        return Ok(vault.clone());
    }
    // Fall back to the global PathManager when startup did not initialize yet
    // (tests / late callers).
    let path_manager = get_path_manager_arc();
    let vault = vault_for(path_manager.as_ref());
    let _ = GLOBAL_USER_SECRETS.set(Arc::clone(&vault));
    Ok(GLOBAL_USER_SECRETS.get().cloned().unwrap_or(vault))
}

pub async fn list_user_secrets() -> BitFunResult<Vec<UserSecretSummary>> {
    global_vault()?
        .list()
        .await
        .map_err(|e| BitFunError::service(e.to_string()))
}

pub async fn upsert_user_secret(request: UserSecretUpsert) -> BitFunResult<UserSecretSummary> {
    global_vault()?
        .upsert(&request.name, &request.value)
        .await
        .map_err(|e| BitFunError::service(e.to_string()))
}

pub async fn delete_user_secret(name: &str) -> BitFunResult<bool> {
    global_vault()?
        .delete(name)
        .await
        .map_err(|e| BitFunError::service(e.to_string()))
}

/// Load plaintext map for tool-argument resolution only. Do not expose to UI.
pub async fn load_user_secret_values() -> BitFunResult<HashMap<String, String>> {
    global_vault()?
        .load_all_values()
        .await
        .map_err(|e| BitFunError::service(e.to_string()))
}
