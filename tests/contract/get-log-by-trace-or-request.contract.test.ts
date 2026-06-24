import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from '../../src/gateway-client.js';
import {
  getLogByTraceOrRequestHandler,
  registerGetLogByTraceOrRequest,
} from '../../src/tools/get-log-by-trace-or-request.js';
import { invalidateServicesCache } from '../../src/tools/list-services.js';
import type { Config } from '../../src/config.js';
import type { QueryResult, ServicesInfo } from '../../src/types.js';

const testConfig: Config = {
  gatewayUrl: 'http://localhost:59999',
  apiKey: 'test_key.secret_value',
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

const fanoutConfig: Config = { ...testConfig, maxServicesFanout: 3 };

function makeFetchResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response;
}

function makeQueryResult(items = 1, reqId = 'req_gw'): QueryResult {
  return {
    items: Array(items)
      .fill(null)
      .map((_, i) => ({
        _timestamp: '2026-06-07T08:30:00.000Z',
        service: 'svc',
        level: 'info' as const,
        message: `event-${i}`,
        request_id: 'req_abc123',
      })),
    next_cursor: null,
    range_truncated: false,
    limit_truncated: false,
    request_id: reqId,
  };
}

function makeServicesResponse(services: string[]): ServicesInfo {
  return {
    services,
    envs: ['prod'],
    scopes: ['read'],
    request_id: 'req_svc',
  };
}

describe('get_log_by_trace_or_request contract', () => {
  beforeEach(() => {
    invalidateServicesCache();
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    invalidateServicesCache();
  });

  it('request_id + service → consulta única con filtro request_id', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(makeQueryResult(2)));
    const client = new GatewayClient(testConfig);
    const result = await getLogByTraceOrRequestHandler(
      { request_id: 'req_abc123', service: 'payments_api', sort: 'asc' },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(callUrl).toContain('request_id=req_abc123');
  });

  it('trace_id + service → consulta única con filtro trace_id', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(makeQueryResult(1)));
    const client = new GatewayClient(testConfig);
    await getLogByTraceOrRequestHandler(
      { trace_id: 'trc_xyz', service: 'payments_api', sort: 'asc' },
      client,
      testConfig
    );

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(callUrl).toContain('trace_id=trc_xyz');
  });

  it('env se propaga al gateway en busquedas por correlacion (FR-010)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(makeQueryResult(1)));
    const client = new GatewayClient(testConfig);
    await getLogByTraceOrRequestHandler(
      { request_id: 'req_abc', service: 'payments_api', env: 'prod' },
      client,
      testConfig
    );

    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(callUrl).toContain('env=prod');
  });

  it('sin request_id NI trace_id → error de validación, cero llamadas HTTP', async () => {
    const client = new GatewayClient(testConfig);
    const result = await getLogByTraceOrRequestHandler(
      { service: 'payments_api', sort: 'asc' } as Parameters<
        typeof getLogByTraceOrRequestHandler
      >[0],
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/request_id|trace_id/i);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('sin service → list_services + fan-out de 3 servicios con Promise.allSettled', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse(makeServicesResponse(['svc_a', 'svc_b', 'svc_c'])))
      .mockResolvedValueOnce(makeFetchResponse(makeQueryResult(1, 'req_a')))
      .mockResolvedValueOnce(makeFetchResponse(makeQueryResult(1, 'req_b')))
      .mockResolvedValueOnce(makeFetchResponse(makeQueryResult(1, 'req_c')));

    const client = new GatewayClient(testConfig);
    const result = await getLogByTraceOrRequestHandler(
      { request_id: 'req_abc', sort: 'asc' },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(4);
  });

  it('fan-out: 2 OK + 1 con 403 → resultados de los 2, servicio fallido reportado, isError=false (SC-007)', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse(makeServicesResponse(['svc_a', 'svc_b', 'svc_c'])))
      .mockResolvedValueOnce(makeFetchResponse(makeQueryResult(2, 'req_a')))
      .mockResolvedValueOnce(makeFetchResponse(makeQueryResult(1, 'req_b')))
      .mockResolvedValueOnce(
        makeFetchResponse({ message: 'Forbidden', request_id: 'req_403' }, 403)
      );

    const client = new GatewayClient(testConfig);
    const result = await getLogByTraceOrRequestHandler(
      { request_id: 'req_abc', sort: 'asc' },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/error de consulta|svc_c/i);
  });

  it('MCP_MAX_SERVICES_FANOUT=3 con 5 servicios → solo 3 consultados', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        makeFetchResponse(makeServicesResponse(['svc_a', 'svc_b', 'svc_c', 'svc_d', 'svc_e']))
      )
      .mockResolvedValue(makeFetchResponse(makeQueryResult(0)));

    const client = new GatewayClient(fanoutConfig);
    await getLogByTraceOrRequestHandler(
      { request_id: 'req_abc', sort: 'asc' },
      client,
      fanoutConfig
    );

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1 + 3);
  });

  it('sort=asc es el sort por defecto (US-010)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(makeQueryResult(1)));
    const client = new GatewayClient(testConfig);
    await getLogByTraceOrRequestHandler(
      { request_id: 'req_abc', service: 'svc_a', sort: 'asc' },
      client,
      testConfig
    );

    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(callUrl).toContain('sort=asc');
  });

  it('request_id + service sin resultados → mensaje informativo, isError=false', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(makeQueryResult(0)));
    const client = new GatewayClient(testConfig);
    const result = await getLogByTraceOrRequestHandler(
      { request_id: 'req_notfound', service: 'payments_api', sort: 'asc' },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/no se encontraron/i);
  });

  it('registerGetLogByTraceOrRequest registra la herramienta en el servidor', () => {
    const mockServer = { registerTool: vi.fn() } as unknown as McpServer;
    const client = new GatewayClient(testConfig);
    registerGetLogByTraceOrRequest(mockServer, client, testConfig);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'get_log_by_trace_or_request',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    );
  });
});
