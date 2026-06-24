import { describe, it, expect } from 'vitest';
import {
  formatLogsResponse,
  formatEmptyResponse,
  formatErrorResponse,
  truncateIfNeeded,
} from '../../src/formatters.js';
import { AuthError, BackendError, RateLimitError } from '../../src/errors.js';
import type { LogEvent } from '../../src/types.js';

const sampleEvents: LogEvent[] = [
  {
    _timestamp: '2026-06-07T09:00:01.000Z',
    service: 'payments_api',
    env: 'prod',
    level: 'error',
    message: 'Payment processing failed: timeout',
    request_id: 'req_xyz',
    trace_id: 'trc_abc',
  },
  {
    _timestamp: '2026-06-07T08:55:00.000Z',
    service: 'payments_api',
    env: 'prod',
    level: 'info',
    message: 'Payment request received',
  },
];

describe('formatLogsResponse', () => {
  const meta = {
    service: 'payments_api',
    env: 'prod',
    from: '2026-06-07T08:00:00.000Z',
    to: '2026-06-07T09:00:00.000Z',
    sort: 'desc' as const,
    nextCursor: null,
    rangeTruncated: false,
    limitTruncated: false,
    requestId: 'req_gateway_123',
  };

  it('includes service name in header', () => {
    const text = formatLogsResponse(sampleEvents, meta);
    expect(text).toContain('payments_api');
  });

  it('includes event count', () => {
    const text = formatLogsResponse(sampleEvents, meta);
    expect(text).toContain('2');
  });

  it('includes each message', () => {
    const text = formatLogsResponse(sampleEvents, meta);
    expect(text).toContain('Payment processing failed');
    expect(text).toContain('Payment request received');
  });

  it('includes correlation fields when present', () => {
    const text = formatLogsResponse(sampleEvents, meta);
    expect(text).toContain('req_xyz');
    expect(text).toContain('trc_abc');
  });

  it('includes gateway request-id', () => {
    const text = formatLogsResponse(sampleEvents, meta);
    expect(text).toContain('req_gateway_123');
  });

  it('includes sort order', () => {
    const text = formatLogsResponse(sampleEvents, meta);
    expect(text.toLowerCase()).toContain('desc');
  });

  it('includes next_cursor when present', () => {
    const withCursor = formatLogsResponse(sampleEvents, {
      ...meta,
      nextCursor: 'crs_next',
    });
    expect(withCursor).toContain('crs_next');
  });

  it('returns string', () => {
    expect(typeof formatLogsResponse(sampleEvents, meta)).toBe('string');
  });
});

describe('formatEmptyResponse', () => {
  it('returns explicit "no logs found" message', () => {
    const text = formatEmptyResponse('payments_api', {
      from: '2026-06-07T08:00:00.000Z',
      to: '2026-06-07T09:00:00.000Z',
    });
    expect(text).toMatch(/no se encontraron|no.*logs/i);
    expect(text).toContain('payments_api');
  });

  it('is not an error response (does not contain isError markers)', () => {
    const text = formatEmptyResponse('svc', {
      from: '2026-06-07T08:00:00.000Z',
      to: '2026-06-07T09:00:00.000Z',
    });
    expect(text).not.toContain('Error:');
  });
});

describe('formatErrorResponse', () => {
  it('includes error type name', () => {
    const text = formatErrorResponse(new AuthError('req_err_1'));
    expect(text).toContain('AuthError');
  });

  it('includes error message', () => {
    const text = formatErrorResponse(new AuthError('req_err_1'));
    expect(text).toMatch(/API key/i);
  });

  it('includes request_id when present', () => {
    const text = formatErrorResponse(new BackendError('req_err_2'));
    expect(text).toContain('req_err_2');
  });

  it('handles error without request_id', () => {
    const text = formatErrorResponse(new RateLimitError());
    expect(text).toBeTruthy();
    expect(text).toContain('RateLimitError');
  });
});

describe('truncateIfNeeded', () => {
  it('returns text unchanged when under limit', () => {
    const text = 'short text';
    expect(truncateIfNeeded(text, 100)).toBe(text);
  });

  it('truncates text when over limit and adds marker', () => {
    const longText = 'a'.repeat(200);
    const result = truncateIfNeeded(longText, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain('truncada');
  });

  it('truncated result contains beginning of original', () => {
    const longText = 'start_' + 'x'.repeat(200);
    const result = truncateIfNeeded(longText, 50);
    expect(result).toContain('start_');
  });
});
