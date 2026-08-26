import { describe, expect, it } from 'vitest';
import {
  BUILTIN_DEFAULT_DOMAIN,
  relayBaseUrlFromDomain,
  resolveDefaultDomain,
  validateDefaultDomain,
} from './defaultDomain';

describe('defaultDomain', () => {
  it('treats empty as unset and resolves to the built-in hostname', () => {
    expect(validateDefaultDomain('')).toEqual({ ok: true, value: '' });
    expect(validateDefaultDomain('   ')).toEqual({ ok: true, value: '' });
    expect(resolveDefaultDomain('')).toBe(BUILTIN_DEFAULT_DOMAIN);
    expect(relayBaseUrlFromDomain('')).toBe('https://remote.openbitfun.com/relay');
  });

  it('accepts host and host:port', () => {
    expect(validateDefaultDomain('remote.openbitfun.com')).toEqual({
      ok: true,
      value: 'remote.openbitfun.com',
    });
    expect(validateDefaultDomain('example.com:8443')).toEqual({
      ok: true,
      value: 'example.com:8443',
    });
    expect(validateDefaultDomain('127.0.0.1:9700').ok).toBe(true);
    expect(validateDefaultDomain('[::1]:9700').ok).toBe(true);
  });

  it('rejects scheme, path, and spaces', () => {
    expect(validateDefaultDomain('https://remote.openbitfun.com').ok).toBe(false);
    expect(validateDefaultDomain('remote.openbitfun.com/relay').ok).toBe(false);
    expect(validateDefaultDomain('remote openbitfun.com').ok).toBe(false);
  });

  it('does not silently fall back when the stored value is invalid', () => {
    expect(() => resolveDefaultDomain('https://remote.openbitfun.com/relay')).toThrow(
      /Invalid default domain/,
    );
  });
});
