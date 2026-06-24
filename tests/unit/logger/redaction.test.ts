import { describe, it, expect } from 'vitest';
import { REDACT_PATHS } from '../../../src/logger/redaction.js';

describe('REDACT_PATHS', () => {
  it('is an array', () => {
    expect(Array.isArray(REDACT_PATHS)).toBe(true);
  });

  it('includes authorization header paths', () => {
    expect(REDACT_PATHS).toContain('authorization');
    expect(REDACT_PATHS).toContain('headers.authorization');
    expect(REDACT_PATHS).toContain('headers.Authorization');
  });

  it('includes apiKey paths', () => {
    expect(REDACT_PATHS).toContain('apiKey');
    expect(REDACT_PATHS).toContain('api_key');
  });

  it('includes password and token paths', () => {
    expect(REDACT_PATHS).toContain('password');
    expect(REDACT_PATHS).toContain('token');
    expect(REDACT_PATHS).toContain('secret');
  });

  it('includes wildcard paths for nested objects', () => {
    expect(REDACT_PATHS).toContain('*.authorization');
    expect(REDACT_PATHS).toContain('*.token');
    expect(REDACT_PATHS).toContain('*.password');
    expect(REDACT_PATHS).toContain('*.apiKey');
    expect(REDACT_PATHS).toContain('*.api_key');
  });

  it('does not include paths for normal log fields', () => {
    expect(REDACT_PATHS).not.toContain('message');
    expect(REDACT_PATHS).not.toContain('level');
    expect(REDACT_PATHS).not.toContain('service');
    expect(REDACT_PATHS).not.toContain('timestamp');
  });
});
