//! Resolve `{{secret_name}}` placeholders in tool-call JSON arguments.
//!
//! This helper is intentionally pure: callers supply the secret map. Chat
//! messages and model-visible history must keep placeholders unchanged; only
//! the tool-execution argument path should call this.

use bitfun_core_types::is_valid_user_secret_name;
use serde_json::Value;
use std::collections::HashMap;

/// Error when a placeholder cannot be resolved for tool execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretPlaceholderError {
    pub name: String,
}

impl std::fmt::Display for SecretPlaceholderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Unknown or unset secret variable '{{{{{}}}}}'. Add it in Settings → Secrets.",
            self.name
        )
    }
}

impl std::error::Error for SecretPlaceholderError {}

/// Walk `value` and replace every `{{name}}` in string leaves using `secrets`.
///
/// - Placeholders whose name is a valid secret id but missing from `secrets`
///   fail closed.
/// - Text that does not match `{{valid_name}}` is left unchanged.
/// - Non-string JSON nodes are walked recursively; structure is preserved.
pub fn resolve_secret_placeholders_in_value(
    value: &Value,
    secrets: &HashMap<String, String>,
) -> Result<Value, SecretPlaceholderError> {
    match value {
        Value::String(text) => Ok(Value::String(resolve_secret_placeholders_in_text(
            text, secrets,
        )?)),
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.push(resolve_secret_placeholders_in_value(item, secrets)?);
            }
            Ok(Value::Array(out))
        }
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (key, child) in map {
                out.insert(
                    key.clone(),
                    resolve_secret_placeholders_in_value(child, secrets)?,
                );
            }
            Ok(Value::Object(out))
        }
        other => Ok(other.clone()),
    }
}

/// Replace `{{name}}` occurrences in a single string.
pub fn resolve_secret_placeholders_in_text(
    text: &str,
    secrets: &HashMap<String, String>,
) -> Result<String, SecretPlaceholderError> {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
            if let Some((name, end)) = parse_placeholder(text, i) {
                let value = secrets.get(name).ok_or_else(|| SecretPlaceholderError {
                    name: name.to_string(),
                })?;
                out.push_str(value);
                i = end;
                continue;
            }
        }
        // Copy one UTF-8 char safely.
        let ch = text[i..].chars().next().expect("index inside string");
        out.push(ch);
        i += ch.len_utf8();
    }
    Ok(out)
}

/// Returns `(name, end_index_exclusive)` when `text[start..]` begins with
/// `{{valid_name}}`.
fn parse_placeholder(text: &str, start: usize) -> Option<(&str, usize)> {
    if !text[start..].starts_with("{{") {
        return None;
    }
    let name_start = start + 2;
    let rest = &text[name_start..];
    let name_end_rel = rest.find("}}")?;
    let name = &rest[..name_end_rel];
    if !is_valid_user_secret_name(name) {
        return None;
    }
    Some((name, name_start + name_end_rel + 2))
}

/// True when `text` contains at least one resolvable-shape placeholder.
pub fn text_contains_secret_placeholder(text: &str) -> bool {
    let mut i = 0;
    let bytes = text.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'{' && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
            if parse_placeholder(text, i).is_some() {
                return true;
            }
        }
        let ch = text[i..].chars().next().expect("index inside string");
        i += ch.len_utf8();
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn resolves_nested_json_strings() {
        let secrets = map(&[("token", "s3cret"), ("host", "example.com")]);
        let input = json!({
            "url": "https://{{host}}/v1",
            "headers": { "Authorization": "Bearer {{token}}" },
            "tags": ["plain", "x-{{token}}"]
        });
        let resolved = resolve_secret_placeholders_in_value(&input, &secrets).unwrap();
        assert_eq!(
            resolved,
            json!({
                "url": "https://example.com/v1",
                "headers": { "Authorization": "Bearer s3cret" },
                "tags": ["plain", "x-s3cret"]
            })
        );
    }

    #[test]
    fn unknown_secret_fails_closed() {
        let secrets = map(&[("token", "s3cret")]);
        let err = resolve_secret_placeholders_in_text("use {{missing}}", &secrets).unwrap_err();
        assert_eq!(err.name, "missing");
        assert!(err.to_string().contains("{{{{missing}}}}") || err.to_string().contains("missing"));
    }

    #[test]
    fn invalid_placeholder_shape_is_left_alone() {
        let secrets = map(&[]);
        let text = "keep {{bad-name}} and {single} and {{}}";
        assert_eq!(
            resolve_secret_placeholders_in_text(text, &secrets).unwrap(),
            text
        );
    }

    #[test]
    fn detects_placeholder_presence() {
        assert!(text_contains_secret_placeholder("hi {{api_key}}"));
        assert!(!text_contains_secret_placeholder("hi {{bad-name}}"));
        assert!(!text_contains_secret_placeholder("no placeholders"));
    }

    #[test]
    fn history_shape_is_unchanged_when_not_resolved() {
        // Document the invariant: callers must keep the original Value for
        // persistence; this test just shows resolve returns a new tree.
        let secrets = map(&[("x", "1")]);
        let original = json!({ "cmd": "echo {{x}}" });
        let _resolved = resolve_secret_placeholders_in_value(&original, &secrets).unwrap();
        assert_eq!(original, json!({ "cmd": "echo {{x}}" }));
    }
}
