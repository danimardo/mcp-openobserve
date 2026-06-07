import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseConfig } from '../../src/config.js';

const REQUIRED_VARS = ['LOG_GATEWAY_URL', 'LOG_GATEWAY_API_KEY'];
const OO_VARS = ['OO_URL', 'OO_USER', 'OO_PASSWORD', 'OO_ORG', 'OO_STREAM'];
const ALL_OPTIONAL = [
  'LOG_GATEWAY_API_PREFIX',
  'LOG_LEVEL',
  'PUBLIC_LOG_LEVEL',
  'MCP_DEFAULT_ENV',
  'MCP_DEFAULT_SINCE',
  'MCP_DEFAULT_LIMIT',
  'MCP_MAX_LIMIT',
  'MCP_MAX_PAGES',
  'MCP_REQUEST_TIMEOUT_MS',
  'MCP_ENABLE_METRICS_TOOL',
  'MCP_MAX_SERVICES_FANOUT',
  'MCP_RESPONSE_MAX_CHARS',
];


describe('parseConfig', () => {
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv = {};
    for (const key of [...REQUIRED_VARS, ...OO_VARS, ...ALL_OPTIONAL]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  describe('variables obligatorias', () => {
    it('throws with clear message when LOG_GATEWAY_URL is missing', () => {
      process.env.LOG_GATEWAY_API_KEY = 'test_key.secret';
      expect(() => parseConfig()).toThrow(/LOG_GATEWAY_URL/);
    });

    it('throws with clear message when LOG_GATEWAY_API_KEY is missing', () => {
      process.env.LOG_GATEWAY_URL = 'http://localhost:8080';
      expect(() => parseConfig()).toThrow(/LOG_GATEWAY_API_KEY/);
    });

    it('does not include the key value in the error message when key is missing', () => {
      process.env.LOG_GATEWAY_URL = 'http://localhost:8080';
      process.env.LOG_GATEWAY_API_KEY = 'supersecret_key_value';
      // Setting required vars correctly, but this test checks error when both missing
      delete process.env.LOG_GATEWAY_API_KEY;
      const error = (() => {
        try { parseConfig(); return null; } catch (e) { return (e as Error).message; }
      })();
      expect(error).not.toBeNull();
      expect(error).not.toContain('supersecret_key_value');
    });
  });

  describe('variables OO_* rechazadas', () => {
    beforeEach(() => {
      process.env.LOG_GATEWAY_URL = 'http://localhost:8080';
      process.env.LOG_GATEWAY_API_KEY = 'test_key.secret';
    });

    for (const ooVar of OO_VARS) {
      it(`throws when ${ooVar} is present`, () => {
        process.env[ooVar] = 'some-value';
        expect(() => parseConfig()).toThrow(new RegExp(ooVar));
        delete process.env[ooVar];
      });
    }
  });

  describe('valores por defecto de variables opcionales', () => {
    beforeEach(() => {
      process.env.LOG_GATEWAY_URL = 'http://localhost:8080';
      process.env.LOG_GATEWAY_API_KEY = 'test_key.secret';
    });

    it('uses /api/v1 as default API prefix', () => {
      const config = parseConfig();
      expect(config.apiPrefix).toBe('/api/v1');
    });

    it('uses 1h as default since', () => {
      const config = parseConfig();
      expect(config.defaultSince).toBe('1h');
    });

    it('uses 100 as default limit', () => {
      const config = parseConfig();
      expect(config.defaultLimit).toBe(100);
    });

    it('uses 1000 as max limit', () => {
      const config = parseConfig();
      expect(config.maxLimit).toBe(1000);
    });

    it('uses 5 as max pages', () => {
      const config = parseConfig();
      expect(config.maxPages).toBe(5);
    });

    it('uses 15000 as request timeout', () => {
      const config = parseConfig();
      expect(config.requestTimeoutMs).toBe(15000);
    });

    it('enables metrics tool by default', () => {
      const config = parseConfig();
      expect(config.enableMetricsTool).toBe(true);
    });

    it('uses 20 as max services fanout', () => {
      const config = parseConfig();
      expect(config.maxServicesFanout).toBe(20);
    });

    it('uses 50000 as response max chars', () => {
      const config = parseConfig();
      expect(config.responseMaxChars).toBe(50000);
    });

    it('strips trailing slash from gateway URL', () => {
      process.env.LOG_GATEWAY_URL = 'http://localhost:8080/';
      const config = parseConfig();
      expect(config.gatewayUrl).toBe('http://localhost:8080');
    });
  });
});
