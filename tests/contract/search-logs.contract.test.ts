import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from '../../src/gateway-client.js';
import { searchLogsHandler, registerSearchLogs } from '../../src/tools/search-logs.js';
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

function makeFetchResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response;
}

function makeServices(allowQ: boolean): ServicesInfo {
  return {
    services: ['payments_api'],
    envs: ['prod'],
    scopes: ['read'],
    limits: { max_limit: 1000, allow_q: allowQ },
    request_id: 'req_svc',
  };
}

function makeQueryResult(items: number): QueryResult {
  return {
    items: Array(items)
      .fill(null)
      .map((_, i) => ({
        _timestamp: '2026-06-07T09:00:00.000Z',
        service: 'payments_api',
        level: 'error' as const,
        message: `error-${i}`,
        request_id: `req_${i}`,
      })),
    next_cursor: null,
    range_truncated: false,
    limit_truncated: false,
    request_id: 'req_gw',
  };
}

describe('search_logs contract', () => {
  beforeEach(() => {
    invalidateServicesCache();
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    invalidateServicesCache();
  });

  it('allow_q=true en caché + query válida → gateway recibe parámetro q', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse(makeServices(true)))
      .mockResolvedValueOnce(makeFetchResponse(makeQueryResult(2)));

    const client = new GatewayClient(testConfig);
    const result = await searchLogsHandler(
      { service: 'payments_api', query: 'timeout error', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const logsCall = calls.find(([url]) => String(url).includes('/logs')) as [string] | undefined;
    expect(logsCall).toBeDefined();
    expect(logsCall![0]).toContain('q=');
    expect(decodeURIComponent(logsCall![0])).toContain('q=timeout error');
  });

  it('allow_q=false en caché → error informativo inmediato, cero llamadas HTTP al gateway /logs', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(makeServices(false)));

    const client = new GatewayClient(testConfig);
    const result = await searchLogsHandler(
      { service: 'payments_api', query: 'error', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('allow_q=false');
    const logsCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([url]) => String(url).includes('/logs'));
    expect(logsCalls).toHaveLength(0);
  });

  it('query vacia se rechaza antes de consultar services o logs (FR-013)', async () => {
    const client = new GatewayClient(testConfig);
    const result = await searchLogsHandler(
      { service: 'payments_api', query: '', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/busqueda|búsqueda|vacio|vacío/i);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('level=warn → gateway recibe warn,error,fatal (FR-014, SC-012)', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse(makeServices(true)))
      .mockResolvedValueOnce(makeFetchResponse(makeQueryResult(1)));

    const client = new GatewayClient(testConfig);
    await searchLogsHandler(
      { service: 'svc_abc', query: 'texto', level: 'warn', sort: 'desc' },
      client,
      testConfig
    );

    const logsCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([url]) => String(url).includes('/logs'));
    expect(logsCalls.length).toBeGreaterThan(0);
    expect(String(logsCalls[0][0])).toContain('level=warn%2Cerror%2Cfatal');
  });

  it('filtros combinados env y ventana temporal aplicados cuando allow_q=true', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse(makeServices(true)))
      .mockResolvedValueOnce(makeFetchResponse(makeQueryResult(1)));

    const client = new GatewayClient(testConfig);
    await searchLogsHandler(
      {
        service: 'svc_abc',
        query: 'fallo',
        env: 'prod',
        from: '2026-06-07T08:00:00Z',
        to: '2026-06-07T09:00:00Z',
        sort: 'desc',
      },
      client,
      testConfig
    );

    const logsCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([url]) => String(url).includes('/logs'));
    expect(String(logsCalls[0][0])).toContain('env=prod');
  });

  it('sin caché + allow_q no conocido → envía la query al gateway de todos modos', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse({ request_id: 'r1', message: 'err' }, 500))
      .mockResolvedValueOnce(makeFetchResponse(makeQueryResult(1)));

    const client = new GatewayClient(testConfig);
    const result = await searchLogsHandler(
      { service: 'svc_abc', query: 'texto', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
  });

  it('resultado vacío → mensaje explícito sin isError', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse(makeServices(true)))
      .mockResolvedValueOnce(makeFetchResponse(makeQueryResult(0)));

    const client = new GatewayClient(testConfig);
    const result = await searchLogsHandler(
      { service: 'svc_abc', query: 'texto', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/no se encontraron|no.*logs/i);
  });

  it('error HTTP del gateway → isError=true (GatewayError)', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse(makeServices(true)))
      .mockResolvedValueOnce(
        makeFetchResponse({ message: 'Unauthorized', request_id: 'req_err' }, 401)
      );

    const client = new GatewayClient(testConfig);
    const result = await searchLogsHandler(
      { service: 'svc_abc', query: 'texto', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
  });

  it('registerSearchLogs registra la herramienta en el servidor', () => {
    const mockServer = { registerTool: vi.fn() } as unknown as McpServer;
    const client = new GatewayClient(testConfig);
    registerSearchLogs(mockServer, client, testConfig);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'search_logs',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    );
  });
});
