export const BUILTIN_DEFAULT_DOMAIN = 'remote.openbitfun.com';
export const BUILTIN_DEFAULT_RELAY_PATH = '/relay';

export type DefaultDomainValidation =
  | { ok: true; value: string }
  | { ok: false; error: 'spaces' | 'scheme' | 'path' | 'shape' | 'host' | 'port' };

export function validateDefaultDomain(input: string): DefaultDomainValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: '' };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, error: 'spaces' };
  }
  if (trimmed.includes('://')) {
    return { ok: false, error: 'scheme' };
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return { ok: false, error: 'path' };
  }
  if (trimmed.includes('?') || trimmed.includes('#') || trimmed.includes('@')) {
    return { ok: false, error: 'shape' };
  }

  const split = splitHostPort(trimmed);
  if (!split) {
    return { ok: false, error: 'shape' };
  }
  if (!isValidHost(split.host)) {
    return { ok: false, error: 'host' };
  }
  if (split.port !== undefined && !isValidPort(split.port)) {
    return { ok: false, error: 'port' };
  }
  return { ok: true, value: trimmed };
}

export function resolveDefaultDomain(stored: string): string {
  const result = validateDefaultDomain(stored);
  if (!result.ok) {
    throw new Error(`Invalid default domain: ${result.error}`);
  }
  return result.value || BUILTIN_DEFAULT_DOMAIN;
}

export function relayBaseUrlFromDomain(stored: string): string {
  return `https://${resolveDefaultDomain(stored)}${BUILTIN_DEFAULT_RELAY_PATH}`;
}

function splitHostPort(value: string): { host: string; port?: string } | null {
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close < 0) return null;
    const host = value.slice(1, close);
    const rest = value.slice(close + 1);
    if (!rest) return { host };
    if (!rest.startsWith(':') || rest.length === 1) return null;
    return { host, port: rest.slice(1) };
  }
  if ((value.match(/:/g) ?? []).length > 1) {
    return null;
  }
  const colon = value.lastIndexOf(':');
  if (colon < 0) {
    return { host: value };
  }
  const host = value.slice(0, colon);
  const port = value.slice(colon + 1);
  if (!host || !port) return null;
  return { host, port };
}

function isValidHost(host: string): boolean {
  if (!host || host.length > 253 || host.startsWith('.') || host.endsWith('.')) {
    return false;
  }
  if (isIpv4(host) || isIpv6(host)) {
    return true;
  }
  if (!/^[A-Za-z0-9.-]+$/.test(host)) {
    return false;
  }
  return host.split('.').every((label) => (
    label.length > 0
    && label.length <= 63
    && !label.startsWith('-')
    && !label.endsWith('-')
    && /^[A-Za-z0-9-]+$/.test(label)
  ));
}

function isValidPort(port: string): boolean {
  if (!/^[1-9]\d{0,4}$/.test(port)) return false;
  const n = Number(port);
  return n >= 1 && n <= 65535;
}

function isIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function isIpv6(host: string): boolean {
  return host.includes(':') && host.split(':').length >= 3 && /^[0-9A-Fa-f:]+$/.test(host);
}
