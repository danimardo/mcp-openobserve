import { describe, it, expect } from 'vitest';
import {
  GatewayError,
  AuthError,
  ForbiddenError,
  GatewayValidationError,
  RateLimitError,
  BackendError,
  UnavailableError,
  TimeoutError,
  NetworkError,
  ValidationError,
} from '../../src/errors.js';

describe('GatewayError base class', () => {
  it('stores message and optional requestId', () => {
    const err = new GatewayError('test error', 'req_123');
    expect(err.message).toBe('test error');
    expect(err.requestId).toBe('req_123');
    expect(err.name).toBe('GatewayError');
  });

  it('requestId is optional', () => {
    const err = new GatewayError('test');
    expect(err.requestId).toBeUndefined();
  });
});

describe('AuthError (401)', () => {
  it('has correct message for 401', () => {
    const err = new AuthError();
    expect(err.message).toMatch(/API key/);
    expect(err.name).toBe('AuthError');
  });

  it('preserves requestId', () => {
    const err = new AuthError('req_abc');
    expect(err.requestId).toBe('req_abc');
  });

  it('is instance of GatewayError', () => {
    expect(new AuthError()).toBeInstanceOf(GatewayError);
  });
});

describe('ForbiddenError (403)', () => {
  it('accepts a context message', () => {
    const err = new ForbiddenError('El servicio X no está autorizado', 'req_def');
    expect(err.message).toContain('X');
    expect(err.requestId).toBe('req_def');
    expect(err.name).toBe('ForbiddenError');
  });

  it('is instance of GatewayError', () => {
    expect(new ForbiddenError('msg')).toBeInstanceOf(GatewayError);
  });
});

describe('GatewayValidationError (400)', () => {
  it('has correct name', () => {
    const err = new GatewayValidationError('campo inválido', 'req_ghi');
    expect(err.name).toBe('GatewayValidationError');
    expect(err.requestId).toBe('req_ghi');
  });

  it('is instance of GatewayError', () => {
    expect(new GatewayValidationError('msg')).toBeInstanceOf(GatewayError);
  });
});

describe('RateLimitError (429)', () => {
  it('has correct name and message', () => {
    const err = new RateLimitError('req_jkl');
    expect(err.name).toBe('RateLimitError');
    expect(err.message).toMatch(/rate limit|cola llena/i);
    expect(err.requestId).toBe('req_jkl');
  });
});

describe('BackendError (502)', () => {
  it('has correct name and message', () => {
    const err = new BackendError('req_mno');
    expect(err.name).toBe('BackendError');
    expect(err.message).toMatch(/gateway|almacenamiento/i);
    expect(err.requestId).toBe('req_mno');
  });
});

describe('UnavailableError (503)', () => {
  it('has correct name and message', () => {
    const err = new UnavailableError('req_pqr');
    expect(err.name).toBe('UnavailableError');
    expect(err.message).toMatch(/no está disponible/i);
    expect(err.requestId).toBe('req_pqr');
  });
});

describe('TimeoutError (AbortError)', () => {
  it('has correct name and message', () => {
    const err = new TimeoutError(15000);
    expect(err.name).toBe('TimeoutError');
    expect(err.message).toMatch(/timeout|15000/i);
  });
});

describe('NetworkError (connection failure)', () => {
  it('has correct name and includes URL', () => {
    const err = new NetworkError('http://localhost:8080', 'ECONNREFUSED');
    expect(err.name).toBe('NetworkError');
    expect(err.message).toContain('http://localhost:8080');
    expect(err.message).toContain('ECONNREFUSED');
  });
});

describe('ValidationError (pre-gateway input validation)', () => {
  it('is not a GatewayError', () => {
    const err = new ValidationError('parámetros inválidos');
    expect(err).not.toBeInstanceOf(GatewayError);
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('parámetros inválidos');
  });
});
