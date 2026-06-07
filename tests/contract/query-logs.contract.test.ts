import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from '../../src/gateway-client.js';
import { queryLogsHandler, registerQueryLogs } from '../../src/tools/query-logs.js';
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

function makeQueryResult(
  items: number,
  nextCursor: string | null = null,
  overrides: Partial<QueryResult> = {}
): QueryResult {
  return {
    items: Array(items)
      .fill(null)
      .map((_, i) => ({
        _timestamp: '2026-06-07T09:00:00.000Z',
        service: 'payments_api',
        level: 'info' as const,
        message: `event-${i}`,
        request_id: `req_${i}`,
      })),
    next_cursor: nextCursor,
    range_truncated: false,
    limit_truncated: false,
    request_id: 'req_gateway_123',
    ...overrides,
  };
}

function mockFetchResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response;
}

describe('query_logs contract', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('consulta básica usa MCP_DEFAULT_SINCE y sort=desc', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(makeQueryResult(3)));
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler({ service: 'payments_api' }, client, testConfig);

    expect(result.isError).toBeFalsy();
    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(callUrl).toContain('sort=desc');
    expect(callUrl).toContain('from=');
    expect(callUrl).toContain('to=');
  });

  it('sin max_pages obtiene una sola pagina aunque haya next_cursor (FR-019)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse(makeQueryResult(3, 'crs_more'))
    );
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler({ service: 'payments_api' }, client, testConfig);

    expect(result.isError).toBeFalsy();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain('crs_more');
  });

  it('cursor explicito se envia en la primera peticion (FR-017)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(makeQueryResult(1)));
    const client = new GatewayClient(testConfig);
    await queryLogsHandler({ service: 'payments_api', cursor: 'crs_prev' }, client, testConfig);

    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(callUrl).toContain('cursor=crs_prev');
  });

  it('aplica defaultEnv y defaultSince de la config validada (FR-003)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(makeQueryResult(1)));
    const config = { ...testConfig, defaultEnv: 'prod', defaultSince: '2h' };
    const client = new GatewayClient(config);
    const before = Date.now();
    await queryLogsHandler({ service: 'payments_api' }, client, config);
    const after = Date.now();

    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    const url = new URL(callUrl);
    expect(url.searchParams.get('env')).toBe('prod');
    const fromMs = new Date(url.searchParams.get('from') ?? '').getTime();
    expect(fromMs).toBeGreaterThanOrEqual(before - 2 * 60 * 60 * 1000 - 1000);
    expect(fromMs).toBeLessThanOrEqual(after - 2 * 60 * 60 * 1000 + 1000);
  });

  it('service invalido se rechaza antes de llamar al gateway (FR-013)', async () => {
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler({ service: 'Bad-Service' }, client, testConfig);

    expect(result.isError).toBe(true);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('level=warn envía warn,error,fatal al gateway (SC-012, FR-014)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(makeQueryResult(1)));
    const client = new GatewayClient(testConfig);
    await queryLogsHandler({ service: 'svc', level: 'warn' }, client, testConfig);

    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(callUrl).toContain('level=warn%2Cerror%2Cfatal');
  });

  it('level=error envía error,fatal al gateway', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(makeQueryResult(1)));
    const client = new GatewayClient(testConfig);
    await queryLogsHandler({ service: 'svc', level: 'error' }, client, testConfig);

    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(callUrl).toContain('level=error%2Cfatal');
  });

  it('since+from simultáneos → error de validación, cero llamadas HTTP', async () => {
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler(
      { service: 'svc', since: '1h', from: '2026-06-07T08:00:00Z' },
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/mutuamente excluyentes|since.*from/i);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('solo-to → error de validación', async () => {
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler(
      { service: 'svc', to: '2026-06-07T09:00:00Z' },
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('from>to → error de validación', async () => {
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler(
      { service: 'svc', from: '2026-06-07T10:00:00Z', to: '2026-06-07T09:00:00Z' },
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('solo from → to=now', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(makeQueryResult(1)));
    const client = new GatewayClient(testConfig);
    const before = Date.now();
    await queryLogsHandler({ service: 'svc', from: '2026-06-07T08:00:00Z' }, client, testConfig);
    const after = Date.now();

    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    const toParam = new URL(callUrl).searchParams.get('to');
    const toTime = toParam ? new Date(toParam).getTime() : 0;
    expect(toTime).toBeGreaterThanOrEqual(before - 1000);
    expect(toTime).toBeLessThanOrEqual(after + 1000);
  });

  it('filtro env pasado correctamente', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(makeQueryResult(1)));
    const client = new GatewayClient(testConfig);
    await queryLogsHandler({ service: 'svc', env: 'prod' }, client, testConfig);

    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(callUrl).toContain('env=prod');
  });

  it('limit > MCP_MAX_LIMIT recortado silenciosamente', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(makeQueryResult(1)));
    const client = new GatewayClient(testConfig);
    await queryLogsHandler({ service: 'svc', limit: 9999 }, client, testConfig);

    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    const limitParam = new URL(callUrl).searchParams.get('limit');
    expect(Number(limitParam)).toBeLessThanOrEqual(testConfig.maxLimit);
  });

  it('items vacíos → mensaje explícito sin isError', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(makeQueryResult(0)));
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler({ service: 'svc' }, client, testConfig);

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/no se encontraron|no.*logs/i);
  });

  it('next_cursor incluido en respuesta cuando presente', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse(makeQueryResult(3, 'crs_next'))
    );
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler({ service: 'svc', max_pages: 1 }, client, testConfig);

    expect(result.content[0].text).toContain('crs_next');
  });

  it('preserva range_truncated, limit_truncated y total si el gateway los devuelve (FR-040)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse(
        makeQueryResult(1, null, {
          range_truncated: true,
          limit_truncated: true,
          total: 123,
        })
      )
    );
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler({ service: 'payments_api' }, client, testConfig);

    expect(result.content[0].text).toContain('range_truncated=true');
    expect(result.content[0].text).toContain('limit_truncated=true');
    expect(result.content[0].text).toContain('total=123');
  });

  it('401 → mensaje de API key', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse({ message: 'Unauthorized', request_id: 'req_err' }, 401)
    );
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler({ service: 'svc' }, client, testConfig);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/API key/i);
  });

  it('403 → mensaje de no autorizado', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse({ message: 'Forbidden', request_id: 'req_err' }, 403)
    );
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler({ service: 'svc' }, client, testConfig);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/ForbiddenError/);
  });

  it('429 → mensaje de rate limit', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse({ request_id: 'req_429' }, 429)
    );
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler({ service: 'svc' }, client, testConfig);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/rate limit|cola llena/i);
  });

  it('502 → mensaje de backend error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse({ request_id: 'req_502' }, 502)
    );
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler({ service: 'svc' }, client, testConfig);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/gateway|almacenamiento/i);
  });

  it('registerQueryLogs registra la herramienta en el servidor', () => {
    const mockServer = { registerTool: vi.fn() } as unknown as McpServer;
    const client = new GatewayClient(testConfig);
    registerQueryLogs(mockServer, client, testConfig);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'query_logs',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    );
  });

  it('request_id del gateway preservado en errores (FR-025)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse({ message: 'Unauthorized', request_id: 'req_preserved' }, 401)
    );
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler({ service: 'svc' }, client, testConfig);

    expect(result.content[0].text).toContain('req_preserved');
  });

  it('parsea el formato de error OpenAPI anidado del gateway (FR-024, FR-025)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse(
        {
          error: {
            code: 'forbidden',
            message: 'El servicio payments_api no esta autorizado para esta key',
          },
          request_id: 'req_nested',
        },
        403
      )
    );
    const client = new GatewayClient(testConfig);
    const result = await queryLogsHandler({ service: 'payments_api' }, client, testConfig);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('payments_api');
    expect(result.content[0].text).toContain('req_nested');
  });
});
