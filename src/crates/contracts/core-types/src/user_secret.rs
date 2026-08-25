//! User-defined secret variables used as `{{name}}` placeholders in chat.
//!
//! Values never appear in read models. List/summary APIs expose only names and
//! timestamps so settings UIs and peers cannot read plaintext.

use serde::{Deserialize, Serialize};

/// Allowed secret name: `[A-Za-z_][A-Za-z0-9_]*`.
pub fn is_valid_user_secret_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Secret-safe listing row. Never includes the value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserSecretSummary {
    pub name: String,
    /// Unix millis when the secret was last written.
    pub updated_at: i64,
}

/// Write-only upsert. Empty `value` is rejected by the host.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSecretUpsert {
    pub name: String,
    pub value: String,
}

impl std::fmt::Debug for UserSecretUpsert {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UserSecretUpsert")
            .field("name", &self.name)
            .field("value", &"<redacted>")
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_secret_names() {
        assert!(is_valid_user_secret_name("api_token"));
        assert!(is_valid_user_secret_name("_private"));
        assert!(is_valid_user_secret_name("A1"));
        assert!(!is_valid_user_secret_name(""));
        assert!(!is_valid_user_secret_name("1bad"));
        assert!(!is_valid_user_secret_name("has-dash"));
        assert!(!is_valid_user_secret_name("has space"));
        assert!(!is_valid_user_secret_name("中文"));
    }
}
