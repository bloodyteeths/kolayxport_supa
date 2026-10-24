import { describe, expect, it } from 'vitest';
import { ETSY_DEFAULT_API_BASE, ETSY_OPENAPI_BASE, etsyBaseWarning, resolveEtsyApiBase } from '@/lib/etsy/apiBase';

describe('Etsy API base (ETSY_API_BASE_URL)', () => {
  it('defaults to real Etsy', () => {
    expect(resolveEtsyApiBase(undefined)).toBe('https://openapi.etsy.com/v3/application');
    expect(resolveEtsyApiBase('  ')).toBe(ETSY_DEFAULT_API_BASE);
    expect(ETSY_OPENAPI_BASE).toBe(ETSY_DEFAULT_API_BASE); // unset in tests, as in production
  });
  it('accepts https anywhere and http only on localhost; trims trailing slashes', () => {
    expect(resolveEtsyApiBase('https://sandbox.example.com/v3/application/')).toBe('https://sandbox.example.com/v3/application');
    expect(resolveEtsyApiBase('http://localhost:3999/v3/application')).toBe('http://localhost:3999/v3/application');
    expect(resolveEtsyApiBase('http://127.0.0.1:3999/v3/application')).toBe('http://127.0.0.1:3999/v3/application');
  });
  it('never sends tokens over plain http to another host, and ignores garbage', () => {
    expect(resolveEtsyApiBase('http://evil.example/v3/application')).toBe(ETSY_DEFAULT_API_BASE);
    expect(resolveEtsyApiBase('not a url')).toBe(ETSY_DEFAULT_API_BASE);
    expect(resolveEtsyApiBase('ftp://localhost/v3')).toBe(ETSY_DEFAULT_API_BASE);
  });
  it('warns loudly whenever the base is not real Etsy, or an override was rejected', () => {
    expect(etsyBaseWarning(ETSY_DEFAULT_API_BASE, undefined)).toBeNull();
    expect(etsyBaseWarning('http://localhost:3999/v3/application', 'http://localhost:3999/v3/application')).toMatch(/WARNING.*localhost:3999/);
    expect(etsyBaseWarning(ETSY_DEFAULT_API_BASE, 'http://evil.example')).toMatch(/WARNING.*rejected/);
  });
});
