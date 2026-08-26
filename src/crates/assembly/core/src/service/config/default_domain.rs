//! User-configured default hostname for Remote Connect / relay.
//!
//! This is a settings value, not product identity. Empty/unset uses the
//! built-in default (`remote.openbitfun.com`). The stored form is `host[:port]`
//! with no scheme or path.

/// Built-in Remote Connect hostname used when the setting is empty or unset.
pub const BUILTIN_DEFAULT_DOMAIN: &str = "remote.openbitfun.com";

/// Path appended when turning a hostname into the official relay base URL.
pub const BUILTIN_DEFAULT_RELAY_PATH: &str = "/relay";

/// Validates a user-entered default domain.
///
/// Accepts empty (unset), `host`, or `host:port`. Rejects schemes, paths,
/// spaces, userinfo, query, and fragment. Returns the trimmed stored form.
pub fn validate_default_domain(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err("Default domain must not contain spaces".to_string());
    }
    if trimmed.contains("://") {
        return Err("Default domain must be a hostname, not a URL (no scheme)".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Default domain must not include a path".to_string());
    }
    if trimmed.contains('?') || trimmed.contains('#') || trimmed.contains('@') {
        return Err("Default domain must be host[:port] only".to_string());
    }

    let (host, port) = split_host_port(trimmed)?;
    validate_host(host)?;
    if let Some(port) = port {
        validate_port(port)?;
    }
    Ok(trimmed.to_string())
}

/// Resolves the hostname used at runtime. Empty/unset → built-in default.
pub fn resolve_default_domain(stored: &str) -> Result<String, String> {
    let validated = validate_default_domain(stored)?;
    if validated.is_empty() {
        Ok(BUILTIN_DEFAULT_DOMAIN.to_string())
    } else {
        Ok(validated)
    }
}

/// Builds `https://{domain}/relay` from a stored or resolved hostname.
pub fn relay_base_url_from_domain(domain: &str) -> Result<String, String> {
    let host = resolve_default_domain(domain)?;
    Ok(format!("https://{host}{BUILTIN_DEFAULT_RELAY_PATH}"))
}

fn split_host_port(value: &str) -> Result<(&str, Option<&str>), String> {
    if value.starts_with('[') {
        let close = value.find(']').ok_or_else(|| {
            "Default domain IPv6 host must be written as [host] or [host]:port".to_string()
        })?;
        let host = &value[1..close];
        let rest = &value[close + 1..];
        if rest.is_empty() {
            return Ok((host, None));
        }
        let port = rest
            .strip_prefix(':')
            .filter(|port| !port.is_empty())
            .ok_or_else(|| "Default domain IPv6 host must be [host] or [host]:port".to_string())?;
        return Ok((host, Some(port)));
    }

    if value.matches(':').count() > 1 {
        return Err("Default domain IPv6 hosts must be wrapped in brackets".to_string());
    }
    match value.rsplit_once(':') {
        Some((host, port)) if !host.is_empty() && !port.is_empty() => Ok((host, Some(port))),
        Some(_) => Err("Default domain must be host[:port]".to_string()),
        None => Ok((value, None)),
    }
}

fn validate_host(host: &str) -> Result<(), String> {
    if host.is_empty() {
        return Err("Default domain host is required".to_string());
    }
    if host.len() > 253 {
        return Err("Default domain host is too long".to_string());
    }
    if host.starts_with('.') || host.ends_with('.') {
        return Err("Default domain host must not start or end with a dot".to_string());
    }
    if is_ipv4(host) {
        return Ok(());
    }
    if is_ipv6(host) {
        return Ok(());
    }
    if !host
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '.')
    {
        return Err(
            "Default domain host may contain only letters, digits, dots, and hyphens".to_string(),
        );
    }
    for label in host.split('.') {
        if label.is_empty() || label.len() > 63 {
            return Err("Default domain host labels must be 1-63 characters".to_string());
        }
        if label.starts_with('-') || label.ends_with('-') {
            return Err(
                "Default domain host labels must not start or end with a hyphen".to_string(),
            );
        }
        if !label
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
        {
            return Err(
                "Default domain host labels may contain only letters, digits, and hyphens"
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn validate_port(port: &str) -> Result<(), String> {
    let parsed: u16 = port
        .parse()
        .map_err(|_| "Default domain port must be an integer from 1 to 65535".to_string())?;
    if parsed == 0 {
        return Err("Default domain port must be an integer from 1 to 65535".to_string());
    }
    Ok(())
}

fn is_ipv4(host: &str) -> bool {
    let mut parts = host.split('.');
    let mut count = 0;
    for part in parts.by_ref() {
        count += 1;
        if count > 4 {
            return false;
        }
        if part.len() > 3 || part.is_empty() || part.bytes().any(|b| !b.is_ascii_digit()) {
            return false;
        }
        if part.len() > 1 && part.starts_with('0') {
            return false;
        }
        if part.parse::<u8>().is_err() {
            return false;
        }
    }
    count == 4
}

fn is_ipv6(host: &str) -> bool {
    host.parse::<std::net::Ipv6Addr>().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_is_valid_and_resolves_to_builtin() {
        assert_eq!(validate_default_domain("").unwrap(), "");
        assert_eq!(validate_default_domain("   ").unwrap(), "");
        assert_eq!(resolve_default_domain("").unwrap(), BUILTIN_DEFAULT_DOMAIN);
        assert_eq!(
            relay_base_url_from_domain("").unwrap(),
            "https://remote.openbitfun.com/relay"
        );
    }

    #[test]
    fn accepts_hostname_and_optional_port() {
        assert_eq!(
            validate_default_domain("remote.openbitfun.com").unwrap(),
            "remote.openbitfun.com"
        );
        assert_eq!(
            validate_default_domain("example.com:8443").unwrap(),
            "example.com:8443"
        );
        assert_eq!(validate_default_domain("localhost").unwrap(), "localhost");
        assert_eq!(
            validate_default_domain("127.0.0.1:9700").unwrap(),
            "127.0.0.1:9700"
        );
        assert_eq!(validate_default_domain("[::1]:9700").unwrap(), "[::1]:9700");
    }

    #[test]
    fn rejects_scheme_path_and_spaces() {
        assert!(validate_default_domain("https://remote.openbitfun.com").is_err());
        assert!(validate_default_domain("remote.openbitfun.com/relay").is_err());
        assert!(validate_default_domain("remote.openbitfun.com /relay").is_err());
        assert!(validate_default_domain("remote openbitfun.com").is_err());
        assert!(validate_default_domain("user@host").is_err());
        assert!(validate_default_domain("host?x=1").is_err());
        assert!(validate_default_domain("host#frag").is_err());
    }

    #[test]
    fn invalid_domain_does_not_silently_fall_back() {
        let error = resolve_default_domain("https://remote.openbitfun.com/relay")
            .expect_err("invalid stored domain must fail loudly");
        assert!(error.contains("hostname") || error.contains("scheme") || error.contains("path"));
    }

    #[test]
    fn relay_url_uses_https_and_relay_path() {
        assert_eq!(
            relay_base_url_from_domain("relay.example.com:8443").unwrap(),
            "https://relay.example.com:8443/relay"
        );
    }
}
