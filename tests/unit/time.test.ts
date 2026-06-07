import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveTimeWindow, expandLevel } from '../../src/time.js';

describe('resolveTimeWindow', () => {
  let savedDefaultSince: string | undefined;

  beforeEach(() => {
    savedDefaultSince = process.env.MCP_DEFAULT_SINCE;
  });

  afterEach(() => {
    if (savedDefaultSince === undefined) delete process.env.MCP_DEFAULT_SINCE;
    else process.env.MCP_DEFAULT_SINCE = savedDefaultSince;
  });

  describe('since parsing', () => {
    it('parses 30s correctly', () => {
      const result = resolveTimeWindow({ since: '30s' });
      const from = new Date(result.from).getTime();
      const to = new Date(result.to).getTime();
      expect(to - from).toBeCloseTo(30 * 1000, -2);
    });

    it('parses 15m correctly', () => {
      const result = resolveTimeWindow({ since: '15m' });
      const from = new Date(result.from).getTime();
      const to = new Date(result.to).getTime();
      expect(to - from).toBeCloseTo(15 * 60 * 1000, -2);
    });

    it('parses 1h correctly', () => {
      const result = resolveTimeWindow({ since: '1h' });
      const from = new Date(result.from).getTime();
      const to = new Date(result.to).getTime();
      expect(to - from).toBeCloseTo(1 * 60 * 60 * 1000, -2);
    });

    it('parses 24h correctly', () => {
      const result = resolveTimeWindow({ since: '24h' });
      const from = new Date(result.from).getTime();
      const to = new Date(result.to).getTime();
      expect(to - from).toBeCloseTo(24 * 60 * 60 * 1000, -2);
    });

    it('parses 7d correctly', () => {
      const result = resolveTimeWindow({ since: '7d' });
      const from = new Date(result.from).getTime();
      const to = new Date(result.to).getTime();
      expect(to - from).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -2);
    });
  });

  describe('mutually exclusive constraints', () => {
    it('throws when since and from are both provided', () => {
      expect(() =>
        resolveTimeWindow({ since: '1h', from: '2026-06-07T08:00:00Z' })
      ).toThrow(/mutuamente excluyentes|since.*from/i);
    });

    it('throws when since and to are both provided', () => {
      expect(() =>
        resolveTimeWindow({ since: '1h', to: '2026-06-07T09:00:00Z' })
      ).toThrow(/mutuamente excluyentes|since.*to/i);
    });

    it('throws when only to is provided without from', () => {
      expect(() =>
        resolveTimeWindow({ to: '2026-06-07T09:00:00Z' })
      ).toThrow(/from.*to|to.*from/i);
    });

    it('throws when from is after to', () => {
      expect(() =>
        resolveTimeWindow({
          from: '2026-06-07T10:00:00Z',
          to: '2026-06-07T09:00:00Z',
        })
      ).toThrow(/from.*to|posterior|anterior/i);
    });
  });

  describe('from without to defaults to now', () => {
    it('sets to to approximately now when only from is provided', () => {
      const beforeCall = Date.now();
      const result = resolveTimeWindow({ from: '2026-06-07T08:00:00Z' });
      const afterCall = Date.now();
      const to = new Date(result.to).getTime();
      expect(to).toBeGreaterThanOrEqual(beforeCall - 1000);
      expect(to).toBeLessThanOrEqual(afterCall + 1000);
    });
  });

  describe('default since', () => {
    it('uses MCP_DEFAULT_SINCE when no params provided', () => {
      process.env.MCP_DEFAULT_SINCE = '2h';
      const result = resolveTimeWindow({});
      const from = new Date(result.from).getTime();
      const to = new Date(result.to).getTime();
      expect(to - from).toBeCloseTo(2 * 60 * 60 * 1000, -2);
    });

    it('defaults to 1h when MCP_DEFAULT_SINCE not set', () => {
      delete process.env.MCP_DEFAULT_SINCE;
      const result = resolveTimeWindow({});
      const from = new Date(result.from).getTime();
      const to = new Date(result.to).getTime();
      expect(to - from).toBeCloseTo(1 * 60 * 60 * 1000, -2);
    });
  });

  describe('ISO-8601 output', () => {
    it('returns valid ISO-8601 strings', () => {
      const result = resolveTimeWindow({ since: '1h' });
      expect(() => new Date(result.from)).not.toThrow();
      expect(() => new Date(result.to)).not.toThrow();
      expect(new Date(result.from).toISOString()).toBe(result.from);
      expect(new Date(result.to).toISOString()).toBe(result.to);
    });
  });
});

describe('expandLevel', () => {
  it('trace expands to all levels', () => {
    expect(expandLevel('trace')).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
  });

  it('debug expands to debug and above', () => {
    expect(expandLevel('debug')).toEqual(['debug', 'info', 'warn', 'error', 'fatal']);
  });

  it('info expands to info and above', () => {
    expect(expandLevel('info')).toEqual(['info', 'warn', 'error', 'fatal']);
  });

  it('warn expands to warn and above', () => {
    expect(expandLevel('warn')).toEqual(['warn', 'error', 'fatal']);
  });

  it('error expands to error and fatal', () => {
    expect(expandLevel('error')).toEqual(['error', 'fatal']);
  });

  it('fatal expands to only fatal', () => {
    expect(expandLevel('fatal')).toEqual(['fatal']);
  });

  it('throws ValidationError for invalid level', () => {
    expect(() => expandLevel('invalid')).toThrow(/nivel.*inválido|invalid.*level/i);
  });

  it('throws for empty string', () => {
    expect(() => expandLevel('')).toThrow();
  });
});
