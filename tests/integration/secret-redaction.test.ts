import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GatewayClient } from '../../src/gateway-client.js';
import { listServicesHandler } from '../../src/tools/list-services.js';
import { queryLogsHandler } from '../../src/tools/query-logs.js';
import { searchLogsHandler } from '../../src/tools/search-logs.js';
import { getRecentErrorsHandler } from '../../src/tools/get-recent-errors.js';
import { summarizeErrorsHandler } from '../../src/tools/summarize-errors.js';
import { getLogByTraceOrRequestHandler } from '../../src/tools/get-log-by-trace-or-request.js';
import { checkGatewayHealthHandler } from '../../src/tools/check-gateway-health.js';
import { getMetricsHandler } from '../../src/tools/get-metrics.js';
import { invalidateServicesCache } from '../../src/tools/list-services.js';
import type { Config } from '../../src/config.js';

const SECRET_KEY = 'super_secret_bearer_token_12345_never_expose_this_value';

const testConfig: Config = {
  gatewayUrl: 'http://localhost:59999',
  apiKey: SECRET_KEY,
  apiPrefix: '/api/v1',
  logLevel: 'warn',
  publicLogLevel: 'warn',
  defaultEnv: '',
  defaultSince: '1h',
  defaultLimit: 100,
  maxLimit: 1000,
  maxPages: 5,
  requestTimeoutMs: 5000,
  enableMetricsTool: true,
  maxServicesFanout: 20,
  responseMaxChars: 50000,
};

function makeFetchResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

function assertNoSecretLeak(text: string) {
  expect(text).not.toContain(SECRET_KEY);
  expect(text).not.toContain('super_secret_bearer_token');
  expect(text).not.toContain('never_expose_this_value');
}

describe('secret-redaction — API key nunca visible en outputs (SC-003, SC-010, FR-048)', () => {
  beforeEach(() => {
    invalidateServicesCache();
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    invalidateServicesCache();
  });

  describe('list_services', () => {
    it('respuesta de éxito no contiene API key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({ services: ['svc_a'], envs: ['prod'], scopes: ['read'], request_id: 'req_1' })
      );
      const client = new GatewayClient(testConfig);
      const result = await listServicesHandler({}, client, testConfig);
      assertNoSecretLeak(result.content[0].text);
    });

    it('error 401 no filtra API key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({ message: 'Unauthorized', request_id: 'req_err' }, 401)
      );
      const client = new GatewayClient(testConfig);
      const result = await listServicesHandler({}, client, testConfig);
      expect(result.isError).toBe(true);
      assertNoSecretLeak(result.content[0].text);
    });
  });

  describe('query_logs', () => {
    it('respuesta con eventos no contiene API key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({
          items: [{ _timestamp: '2026-06-07T09:00:00Z', service: 'svc', level: 'info', message: 'ok' }],
          next_cursor: null,
          range_truncated: false,
          limit_truncated: false,
          request_id: 'req_q',
        })
      );
      const client = new GatewayClient(testConfig);
      const result = await queryLogsHandler({ service: 'svc', sort: 'desc' }, client, testConfig);
      assertNoSecretLeak(result.content[0].text);
    });

    it('error 403 no filtra API key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({ message: 'Forbidden', request_id: 'req_403' }, 403)
      );
      const client = new GatewayClient(testConfig);
      const result = await queryLogsHandler({ service: 'svc', sort: 'desc' }, client, testConfig);
      expect(result.isError).toBe(true);
      assertNoSecretLeak(result.content[0].text);
    });

    it('error 429 no filtra API key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({ request_id: 'req_429' }, 429)
      );
      const client = new GatewayClient(testConfig);
      const result = await queryLogsHandler({ service: 'svc', sort: 'desc' }, client, testConfig);
      expect(result.isError).toBe(true);
      assertNoSecretLeak(result.content[0].text);
    });

    it('error 502 no filtra API key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({ request_id: 'req_502' }, 502)
      );
      const client = new GatewayClient(testConfig);
      const result = await queryLogsHandler({ service: 'svc', sort: 'desc' }, client, testConfig);
      expect(result.isError).toBe(true);
      assertNoSecretLeak(result.content[0].text);
    });

    it('error de red no filtra API key ni URL con credenciales', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
      const client = new GatewayClient(testConfig);
      const result = await queryLogsHandler({ service: 'svc', sort: 'desc' }, client, testConfig);
      expect(result.isError).toBe(true);
      assertNoSecretLeak(result.content[0].text);
    });
  });

  describe('search_logs', () => {
    it('respuesta de éxito no contiene API key', async () => {
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          makeFetchResponse({ services: ['svc'], envs: ['prod'], scopes: ['read'], limits: { max_limit: 1000, allow_q: true }, request_id: 'req_svc' })
        )
        .mockResolvedValueOnce(
          makeFetchResponse({
            items: [{ _timestamp: '2026-06-07T09:00:00Z', service: 'svc', level: 'error', message: 'timeout' }],
            next_cursor: null,
            range_truncated: false,
            limit_truncated: false,
            request_id: 'req_q',
          })
        );
      const client = new GatewayClient(testConfig);
      const result = await searchLogsHandler({ service: 'svc', query: 'timeout', sort: 'desc' }, client, testConfig);
      assertNoSecretLeak(result.content[0].text);
    });

    it('allow_q=false: mensaje informativo no contiene API key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({ services: ['svc'], envs: ['prod'], scopes: ['read'], limits: { max_limit: 1000, allow_q: false }, request_id: 'req_svc' })
      );
      const client = new GatewayClient(testConfig);
      const result = await searchLogsHandler({ service: 'svc', query: 'timeout', sort: 'desc' }, client, testConfig);
      assertNoSecretLeak(result.content[0].text);
    });
  });

  describe('get_recent_errors', () => {
    it('error 401 no filtra API key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({ message: 'Unauthorized', request_id: 'req_err' }, 401)
      );
      const client = new GatewayClient(testConfig);
      const result = await getRecentErrorsHandler({ service: 'svc', sort: 'desc' }, client, testConfig);
      expect(result.isError).toBe(true);
      assertNoSecretLeak(result.content[0].text);
    });

    it('respuesta de éxito no contiene API key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({
          items: [{ _timestamp: '2026-06-07T09:00:00Z', service: 'svc', level: 'error', message: 'Error grave' }],
          next_cursor: null,
          range_truncated: false,
          limit_truncated: false,
          request_id: 'req_ok',
        })
      );
      const client = new GatewayClient(testConfig);
      const result = await getRecentErrorsHandler({ service: 'svc', sort: 'desc' }, client, testConfig);
      assertNoSecretLeak(result.content[0].text);
    });
  });

  describe('summarize_errors', () => {
    it('error 502 no filtra API key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({ request_id: 'req_502' }, 502)
      );
      const client = new GatewayClient(testConfig);
      const result = await summarizeErrorsHandler({ service: 'svc', top: 10 }, client, testConfig);
      expect(result.isError).toBe(true);
      assertNoSecretLeak(result.content[0].text);
    });
  });

  describe('get_log_by_trace_or_request', () => {
    it('respuesta de éxito no contiene API key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({
          items: [{ _timestamp: '2026-06-07T09:00:00Z', service: 'svc', level: 'info', message: 'ok', request_id: 'req_abc' }],
          next_cursor: null,
          range_truncated: false,
          limit_truncated: false,
          request_id: 'req_gw',
        })
      );
      const client = new GatewayClient(testConfig);
      const result = await getLogByTraceOrRequestHandler(
        { request_id: 'req_abc', service: 'svc', sort: 'asc' },
        client,
        testConfig
      );
      assertNoSecretLeak(result.content[0].text);
    });

    it('error de red no filtra API key', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
      const client = new GatewayClient(testConfig);
      const result = await getLogByTraceOrRequestHandler(
        { request_id: 'req_abc', service: 'svc', sort: 'asc' },
        client,
        testConfig
      );
      expect(result.isError).toBe(true);
      assertNoSecretLeak(result.content[0].text);
    });
  });

  describe('check_gateway_health', () => {
    it('respuesta de éxito no contiene API key (sin auth en health endpoints)', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({ status: 'ok' })
      );
      const client = new GatewayClient(testConfig);
      const result = await checkGatewayHealthHandler({ include_ready: false }, client, testConfig);
      assertNoSecretLeak(result.content[0].text);
    });

    it('error de red no filtra API key en mensaje de conectividad', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
      const client = new GatewayClient(testConfig);
      const result = await checkGatewayHealthHandler({ include_ready: false }, client, testConfig);
      expect(result.isError).toBe(true);
      assertNoSecretLeak(result.content[0].text);
    });
  });

  describe('get_metrics', () => {
    it('texto Prometheus no contiene API key', async () => {
      const prometheusText = '# HELP requests_total Total\nrequests_total 42\n';
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(prometheusText));
      const client = new GatewayClient(testConfig);
      const result = await getMetricsHandler({}, client, testConfig);
      assertNoSecretLeak(result.content[0].text);
    });

    it('deshabilitada: mensaje informativo no contiene API key', async () => {
      const disabledConfig = { ...testConfig, enableMetricsTool: false };
      const client = new GatewayClient(disabledConfig);
      const result = await getMetricsHandler({}, client, disabledConfig);
      assertNoSecretLeak(result.content[0].text);
    });

    it('error del gateway: mensaje de error no contiene API key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({ message: 'Internal Server Error', request_id: 'req_err' }, 500)
      );
      const client = new GatewayClient(testConfig);
      const result = await getMetricsHandler({}, client, testConfig);
      expect(result.isError).toBe(true);
      assertNoSecretLeak(result.content[0].text);
    });
  });

  describe('cabeceras HTTP nunca exponen el token en outputs', () => {
    it('query_logs: Authorization enviada al gateway pero no en respuesta al agente', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        makeFetchResponse({
          items: [],
          next_cursor: null,
          range_truncated: false,
          limit_truncated: false,
          request_id: 'req_q',
        })
      );
      const client = new GatewayClient(testConfig);
      const result = await queryLogsHandler({ service: 'svc', sort: 'desc' }, client, testConfig);

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const options = calls[0][1] as RequestInit | undefined;
      const headers = options?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toContain('Bearer');
      expect(headers?.Authorization).toContain(SECRET_KEY);

      assertNoSecretLeak(result.content[0].text);
    });
  });
});
