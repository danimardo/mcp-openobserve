import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GatewayClient } from '../../src/gateway-client.js';
import { checkGatewayHealthHandler } from '../../src/tools/check-gateway-health.js';
import { listServicesHandler, invalidateServicesCache } from '../../src/tools/list-services.js';
import { queryLogsHandler } from '../../src/tools/query-logs.js';
import type { Config } from '../../src/config.js';

const testConfig: Config = {
  gatewayUrl: 'http://localhost:59999',
  apiKey: 'test_key.test_secret',
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
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response;
}

describe('flujo de integración — health, services y logs (SC-009, FR-047)', () => {
  beforeEach(() => {
    invalidateServicesCache();
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    invalidateServicesCache();
  });

  it('flujo completo: check_gateway_health → list_services → query_logs', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse({ status: 'ok' }))
      .mockResolvedValueOnce(
        makeFetchResponse({
          services: ['payments_api', 'auth_service'],
          envs: ['prod', 'staging'],
          scopes: ['read'],
          request_id: 'req_svc',
        })
      )
      .mockResolvedValueOnce(
        makeFetchResponse({
          items: [
            { _timestamp: '2026-06-07T09:00:00Z', service: 'payments_api', level: 'info', message: 'Payment processed' },
          ],
          next_cursor: null,
          range_truncated: false,
          limit_truncated: false,
          request_id: 'req_logs',
        })
      );

    const client = new GatewayClient(testConfig);

    const healthResult = await checkGatewayHealthHandler({ include_ready: false }, client, testConfig);
    expect(healthResult.isError).toBeFalsy();
    expect(healthResult.content[0].text).toContain('Liveness: ok');

    const servicesResult = await listServicesHandler({}, client, testConfig);
    expect(servicesResult.isError).toBeFalsy();
    expect(servicesResult.content[0].text).toContain('payments_api');

    const logsResult = await queryLogsHandler({ service: 'payments_api', sort: 'desc' }, client, testConfig);
    expect(logsResult.isError).toBeFalsy();
    expect(logsResult.content[0].text).toContain('Payment processed');

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3);
  });

  it('stdout permanece limpio: handlers no escriben en stdout (SC-009, FR-047)', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse({ status: 'ok' }))
      .mockResolvedValueOnce(
        makeFetchResponse({
          services: ['svc_a'],
          envs: ['prod'],
          scopes: ['read'],
          request_id: 'req_svc',
        })
      );

    const stdoutWrites: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...args) => {
      stdoutWrites.push(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
      return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    });

    try {
      const client = new GatewayClient(testConfig);
      await checkGatewayHealthHandler({ include_ready: false }, client, testConfig);
      await listServicesHandler({}, client, testConfig);
    } finally {
      stdoutSpy.mockRestore();
    }

    for (const write of stdoutWrites) {
      expect(write).not.toMatch(/"level"\s*:/);
      expect(write).not.toMatch(/\b(INFO|WARN|ERROR|DEBUG|FATAL)\b/);
    }
  });

  it('lista de servicios se cachea: segunda llamada no genera petición HTTP extra', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        makeFetchResponse({
          services: ['svc_a'],
          envs: ['prod'],
          scopes: ['read'],
          request_id: 'req_svc',
        })
      )
      .mockResolvedValueOnce(
        makeFetchResponse({
          items: [{ _timestamp: '2026-06-07T09:00:00Z', service: 'svc_a', level: 'info', message: 'ok' }],
          next_cursor: null,
          range_truncated: false,
          limit_truncated: false,
          request_id: 'req_logs',
        })
      );

    const client = new GatewayClient(testConfig);

    await listServicesHandler({}, client, testConfig);
    await listServicesHandler({}, client, testConfig);
    await queryLogsHandler({ service: 'svc_a', sort: 'desc' }, client, testConfig);

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });

  it('check_gateway_health con liveness + readiness: 2 llamadas HTTP sin Authorization (SC-009)', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse({ status: 'ok' }))
      .mockResolvedValueOnce(makeFetchResponse({ status: 'ready' }));

    const client = new GatewayClient(testConfig);
    const result = await checkGatewayHealthHandler({ include_ready: true }, client, testConfig);

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Liveness: ok');
    expect(result.content[0].text).toContain('Readiness: ready');

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    for (const call of calls) {
      const options = call[1] as RequestInit | undefined;
      const headers = options?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBeUndefined();
    }
  });

  it('gateway inaccesible: check_gateway_health isError=true, list_services isError=true', async () => {
    const networkError = new TypeError('fetch failed');
    vi.mocked(globalThis.fetch).mockRejectedValue(networkError);

    const client = new GatewayClient(testConfig);

    const healthResult = await checkGatewayHealthHandler({ include_ready: false }, client, testConfig);
    expect(healthResult.isError).toBe(true);
    expect(healthResult.content[0].text).toMatch(/conectividad|conectar|LOG_GATEWAY_URL/i);

    const servicesResult = await listServicesHandler({}, client, testConfig);
    expect(servicesResult.isError).toBe(true);
  });
});
