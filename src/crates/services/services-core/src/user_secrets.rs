//! Encrypted file-backed vault for user secret variables (`{{name}}`).
//!
//! Layout (under the product user data directory):
//! - `.user_secrets_vault.key` — 32-byte AES key (0600 on Unix)
//! - `user_secrets_vault.json` — base64 ciphertext map keyed by secret name
//!
//! List APIs expose names and timestamps only. Plaintext is loaded only for
//! tool-argument resolution on the executing host.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use bitfun_core_types::{is_valid_user_secret_name, UserSecretSummary};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

const NONCE_LEN: usize = 12;
pub const USER_SECRETS_VAULT_FILE: &str = "user_secrets_vault.json";
pub const USER_SECRETS_KEY_FILE: &str = ".user_secrets_vault.key";

#[derive(Debug, Clone, thiserror::Error)]
pub enum UserSecretsError {
    #[error("{0}")]
    InvalidName(String),
    #[error("{0}")]
    InvalidValue(String),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    Crypto(String),
}

#[derive(Serialize, Deserialize, Default)]
struct VaultFile {
    /// name -> { ciphertext, updated_at }
    entries: HashMap<String, VaultEntry>,
}

#[derive(Serialize, Deserialize)]
struct VaultEntry {
    ciphertext: String,
    updated_at: i64,
}

/// AES-GCM vault for user-defined secret variables.
pub struct UserSecretsVault {
    key_path: PathBuf,
    vault_path: PathBuf,
    lock: Mutex<()>,
}

impl UserSecretsVault {
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        let data_dir = data_dir.as_ref();
        Self {
            key_path: data_dir.join(USER_SECRETS_KEY_FILE),
            vault_path: data_dir.join(USER_SECRETS_VAULT_FILE),
            lock: Mutex::new(()),
        }
    }

    pub fn vault_path(&self) -> &Path {
        &self.vault_path
    }

    async fn ensure_key(&self) -> Result<[u8; 32], UserSecretsError> {
        if self.key_path.exists() {
            let bytes = tokio::fs::read(&self.key_path)
                .await
                .map_err(|e| UserSecretsError::Io(format!("read user secrets vault key: {e}")))?;
            if bytes.len() != 32 {
                return Err(UserSecretsError::Crypto(
                    "invalid user secrets vault key length".into(),
                ));
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
        if let Some(parent) = self.key_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| UserSecretsError::Io(format!("create secrets vault dir: {e}")))?;
        }
        let mut key = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut key);
        tokio::fs::write(&self.key_path, key.as_slice())
            .await
            .map_err(|e| UserSecretsError::Io(format!("write user secrets vault key: {e}")))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ =
                std::fs::set_permissions(&self.key_path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(key)
    }

    fn encrypt(key: &[u8; 32], plaintext: &str) -> Result<String, UserSecretsError> {
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| UserSecretsError::Crypto(format!("aes init: {e}")))?;
        let mut nonce = [0u8; NONCE_LEN];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let ct = cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
            .map_err(|e| UserSecretsError::Crypto(format!("encrypt: {e}")))?;
        let mut blob = Vec::with_capacity(NONCE_LEN + ct.len());
        blob.extend_from_slice(&nonce);
        blob.extend_from_slice(&ct);
        Ok(B64.encode(blob))
    }

    fn decrypt(key: &[u8; 32], blob_b64: &str) -> Result<String, UserSecretsError> {
        let blob = B64
            .decode(blob_b64)
            .map_err(|e| UserSecretsError::Crypto(format!("base64 decode: {e}")))?;
        if blob.len() <= NONCE_LEN {
            return Err(UserSecretsError::Crypto(
                "user secrets vault entry too short".into(),
            ));
        }
        let (nonce, ct) = blob.split_at(NONCE_LEN);
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| UserSecretsError::Crypto(format!("aes init: {e}")))?;
        let pt = cipher
            .decrypt(Nonce::from_slice(nonce), ct)
            .map_err(|e| UserSecretsError::Crypto(format!("decrypt: {e}")))?;
        String::from_utf8(pt).map_err(|e| UserSecretsError::Crypto(format!("utf8: {e}")))
    }

    async fn read_file(&self) -> Result<VaultFile, UserSecretsError> {
        if !self.vault_path.exists() {
            return Ok(VaultFile::default());
        }
        let s = tokio::fs::read_to_string(&self.vault_path)
            .await
            .map_err(|e| UserSecretsError::Io(format!("read user secrets vault: {e}")))?;
        Ok(serde_json::from_str(&s).unwrap_or_default())
    }

    async fn write_file(&self, file: &VaultFile) -> Result<(), UserSecretsError> {
        if let Some(parent) = self.vault_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| UserSecretsError::Io(format!("create secrets vault dir: {e}")))?;
        }
        let body = serde_json::to_string_pretty(file)
            .map_err(|e| UserSecretsError::Io(format!("serialize secrets vault: {e}")))?;
        tokio::fs::write(&self.vault_path, body)
            .await
            .map_err(|e| UserSecretsError::Io(format!("write user secrets vault: {e}")))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ =
                std::fs::set_permissions(&self.vault_path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// List secret names and timestamps (never values).
    pub async fn list(&self) -> Result<Vec<UserSecretSummary>, UserSecretsError> {
        let _g = self.lock.lock().await;
        let file = self.read_file().await?;
        let mut rows: Vec<UserSecretSummary> = file
            .entries
            .into_iter()
            .map(|(name, entry)| UserSecretSummary {
                name,
                updated_at: entry.updated_at,
            })
            .collect();
        rows.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(rows)
    }

    /// Upsert a secret value. Rejects invalid names and empty values.
    pub async fn upsert(
        &self,
        name: &str,
        value: &str,
    ) -> Result<UserSecretSummary, UserSecretsError> {
        if !is_valid_user_secret_name(name) {
            return Err(UserSecretsError::InvalidName(format!(
                "Invalid secret name '{name}'. Use letters, digits, and underscore; must start with a letter or underscore."
            )));
        }
        if value.is_empty() {
            return Err(UserSecretsError::InvalidValue(
                "Secret value must not be empty".into(),
            ));
        }
        let _g = self.lock.lock().await;
        let key = self.ensure_key().await?;
        let mut file = self.read_file().await?;
        let updated_at = Self::now_ms();
        let ciphertext = Self::encrypt(&key, value)?;
        file.entries.insert(
            name.to_string(),
            VaultEntry {
                ciphertext,
                updated_at,
            },
        );
        self.write_file(&file).await?;
        Ok(UserSecretSummary {
            name: name.to_string(),
            updated_at,
        })
    }

    /// Delete a secret. Returns true when an entry was removed.
    pub async fn delete(&self, name: &str) -> Result<bool, UserSecretsError> {
        let _g = self.lock.lock().await;
        let mut file = self.read_file().await?;
        let removed = file.entries.remove(name).is_some();
        if removed {
            self.write_file(&file).await?;
        }
        Ok(removed)
    }

    /// Load all secrets as name → plaintext for tool-argument resolution.
    pub async fn load_all_values(&self) -> Result<HashMap<String, String>, UserSecretsError> {
        let _g = self.lock.lock().await;
        if !self.vault_path.exists() || !self.key_path.exists() {
            return Ok(HashMap::new());
        }
        let key = self.ensure_key().await?;
        let file = self.read_file().await?;
        let mut out = HashMap::new();
        for (name, entry) in file.entries {
            match Self::decrypt(&key, &entry.ciphertext) {
                Ok(value) => {
                    out.insert(name, value);
                }
                Err(error) => {
                    log::warn!("Failed to decrypt user secret '{}': {}", name, error);
                }
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn round_trips_secrets_and_lists_without_values() {
        let dir = tempfile::tempdir().unwrap();
        let vault = UserSecretsVault::new(dir.path());

        let summary = vault.upsert("api_token", "s3cret-value").await.unwrap();
        assert_eq!(summary.name, "api_token");

        let listed = vault.list().await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "api_token");

        let values = vault.load_all_values().await.unwrap();
        assert_eq!(
            values.get("api_token").map(String::as_str),
            Some("s3cret-value")
        );

        // Ciphertext file must not contain plaintext.
        let raw = tokio::fs::read_to_string(vault.vault_path()).await.unwrap();
        assert!(!raw.contains("s3cret-value"));

        assert!(vault.delete("api_token").await.unwrap());
        assert!(vault.list().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn rejects_invalid_names_and_empty_values() {
        let dir = tempfile::tempdir().unwrap();
        let vault = UserSecretsVault::new(dir.path());
        assert!(matches!(
            vault.upsert("bad-name", "x").await,
            Err(UserSecretsError::InvalidName(_))
        ));
        assert!(matches!(
            vault.upsert("ok", "").await,
            Err(UserSecretsError::InvalidValue(_))
        ));
    }
}
