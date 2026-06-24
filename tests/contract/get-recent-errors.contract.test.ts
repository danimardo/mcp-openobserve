import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from '../../src/gateway-client.js';
import {
  getRecentErrorsHandler,
  registerGetRecentErrors,
} from '../../src/tools/get-recent-errors.js';
import type { Config } from '../../src/config.js';
import type { QueryResult } from '../../src/types.js';

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

function makeQueryResult(items = 2, nextCursor: string | null = null): QueryResult {
  return {
    items: Array(items)
      .fill(null)
      .map((_, i) => ({
        _timestamp: '2026-06-07T09:00:00.000Z',
        service: 'auth_service',
        level: 'error' as const,
        message: `Token validation failed ${i}`,
        request_id: `req_${i}`,
        trace_id: `trc_${i}`,
        span_id: `sp_${i}`,
      })),
    next_cursor: nextCursor,
    range_truncated: false,
    limit_truncated: false,
    request_id: 'req_gw_456',
  };
}

describe('get_recent_errors contract', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gateway siempre recibe level=error,fatal fijo (US-008)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(makeQueryResult(1)));
    const client = new GatewayClient(testConfig);
    await getRecentErrorsHandler({ service: 'auth_service', sort: 'desc' }, client, testConfig);

    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(callUrl).toContain('level=error%2Cfatal');
  });

  it('eventos con request_id+trace_id+span_id → campos de correlación en output (US-008 CA-3)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(makeQueryResult(1)));
    const client = new GatewayClient(testConfig);
    const result = await getRecentErrorsHandler(
      { service: 'auth_service', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('req_0');
    expect(result.content[0].text).toContain('trc_0');
    expect(result.content[0].text).toContain('sp_0');
  });

  it('items vacíos → mensaje explícito, isError=false (US-008 CA-2)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse({
        items: [],
        next_cursor: null,
        range_truncated: false,
        limit_truncated: false,
        request_id: 'req_empty',
      })
    );
    const client = new GatewayClient(testConfig);
    const result = await getRecentErrorsHandler(
      { service: 'auth_service', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/no se encontraron errores/i);
  });

  it('401 → mensaje "API key ausente, inválida o mal configurada"', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse({ message: 'Unauthorized', request_id: 'req_err' }, 401)
    );
    const client = new GatewayClient(testConfig);
    const result = await getRecentErrorsHandler(
      { service: 'auth_service', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/API key/i);
  });

  it('service invalido se rechaza antes de llamar al gateway (FR-013)', async () => {
    const client = new GatewayClient(testConfig);
    const result = await getRecentErrorsHandler({ service: 'Bad-Service' }, client, testConfig);

    expect(result.isError).toBe(true);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('429 → mensaje de rate limit o cola llena', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse({ request_id: 'req_429' }, 429)
    );
    const client = new GatewayClient(testConfig);
    const result = await getRecentErrorsHandler(
      { service: 'auth_service', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/rate limit|cola llena/i);
  });

  it('502 → mensaje "gateway no pudo consultar el almacenamiento"', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse({ request_id: 'req_502' }, 502)
    );
    const client = new GatewayClient(testConfig);
    const result = await getRecentErrorsHandler(
      { service: 'auth_service', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/almacenamiento|gateway/i);
  });

  it('request_id del gateway preservado en todos los errores (FR-025)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse({ message: 'Unauthorized', request_id: 'req_preserved_789' }, 401)
    );
    const client = new GatewayClient(testConfig);
    const result = await getRecentErrorsHandler(
      { service: 'auth_service', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.content[0].text).toContain('req_preserved_789');
  });

  it('respuesta con resultados incluye request_id del gateway', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(makeQueryResult(2)));
    const client = new GatewayClient(testConfig);
    const result = await getRecentErrorsHandler(
      { service: 'auth_service', sort: 'desc' },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('req_gw_456');
  });

  it('registerGetRecentErrors registra la herramienta en el servidor', () => {
    const mockServer = { registerTool: vi.fn() } as unknown as McpServer;
    const client = new GatewayClient(testConfig);
    registerGetRecentErrors(mockServer, client, testConfig);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'get_recent_errors',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    );
  });
});
