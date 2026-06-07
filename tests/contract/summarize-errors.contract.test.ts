import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from '../../src/gateway-client.js';
import {
  summarizeErrorsHandler,
  registerSummarizeErrors,
} from '../../src/tools/summarize-errors.js';
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

function makeResultWithMessages(messages: string[], nextCursor: string | null = null): QueryResult {
  return {
    items: messages.map((msg, i) => ({
      _timestamp: `2026-06-07T09:0${i}:00.000Z`,
      service: 'payments_api',
      level: 'error' as const,
      message: msg,
    })),
    next_cursor: nextCursor,
    range_truncated: false,
    limit_truncated: false,
    request_id: `req_gw_${Math.floor(Math.random() * 1000)}`,
  };
}

describe('summarize_errors contract', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('3 eventos con mismo mensaje normalizado → group count=3 (US-009 CA-1)', async () => {
    const messages = ['Payment timeout', 'Payment timeout', 'Payment timeout'];
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse(makeResultWithMessages(messages))
    );
    const client = new GatewayClient(testConfig);
    const result = await summarizeErrorsHandler(
      { service: 'payments_api', top: 10 },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('[3x]');
    expect(result.content[0].text).toContain('Payment timeout');
  });

  it('autopaginación 2 páginas acumula todos los eventos', async () => {
    const page1 = makeResultWithMessages(['Error A', 'Error B'], 'cursor_p2');
    const page2 = makeResultWithMessages(['Error A', 'Error C'], null);

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse(page1))
      .mockResolvedValueOnce(makeFetchResponse(page2));

    const client = new GatewayClient(testConfig);
    const result = await summarizeErrorsHandler(
      { service: 'payments_api', max_pages: 2, top: 10 },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('4 eventos');
    expect(result.content[0].text).toContain('[2x]');
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });

  it('max_pages=1 con next_cursor presente → indicador de resumen parcial (US-009 CA-2)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse(makeResultWithMessages(['Error A', 'Error B'], 'cursor_next'))
    );
    const client = new GatewayClient(testConfig);
    const result = await summarizeErrorsHandler(
      { service: 'payments_api', max_pages: 1, top: 10 },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('parcial');
    expect(result.content[0].text).toMatch(/puede haber más|no representados/i);
  });

  it('items vacíos → mensaje "no se encontraron errores"', async () => {
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
    const result = await summarizeErrorsHandler(
      { service: 'payments_api', top: 10 },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/no se encontraron errores/i);
  });

  it('top fuera de rango se rechaza antes de llamar al gateway (FR-013)', async () => {
    const client = new GatewayClient(testConfig);
    const result = await summarizeErrorsHandler(
      { service: 'payments_api', top: 100 },
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('top N ordena por count descendente', async () => {
    const messages = [
      'Rare error',
      'Common error',
      'Common error',
      'Common error',
      'Medium error',
      'Medium error',
    ];
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse(makeResultWithMessages(messages))
    );
    const client = new GatewayClient(testConfig);
    const result = await summarizeErrorsHandler(
      { service: 'payments_api', top: 3 },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    const commonIdx = text.indexOf('Common error');
    const mediumIdx = text.indexOf('Medium error');
    const rareIdx = text.indexOf('Rare error');
    expect(commonIdx).toBeLessThan(mediumIdx);
    expect(mediumIdx).toBeLessThan(rareIdx);
  });

  it('normalización trim+colapso-de-espacios agrupa mensajes equivalentes (US-009 CA-1)', async () => {
    const messages = ['  timeout error  ', 'timeout error', 'timeout  error'];
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse(makeResultWithMessages(messages))
    );
    const client = new GatewayClient(testConfig);
    const result = await summarizeErrorsHandler(
      { service: 'payments_api', top: 10 },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('[3x]');
  });

  it('gateway siempre recibe level=error,fatal', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse(makeResultWithMessages(['Error X']))
    );
    const client = new GatewayClient(testConfig);
    await summarizeErrorsHandler({ service: 'payments_api', top: 10 }, client, testConfig);

    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(callUrl).toContain('level=error%2Cfatal');
  });

  it('acepta sort y lo envia al gateway (FR-038)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse(makeResultWithMessages(['Error X']))
    );
    const client = new GatewayClient(testConfig);
    const result = await summarizeErrorsHandler(
      { service: 'payments_api', sort: 'asc' },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    const [callUrl] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(callUrl).toContain('sort=asc');
  });

  it('error HTTP del gateway → isError=true (GatewayError)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse({ message: 'Unauthorized', request_id: 'req_err' }, 401)
    );
    const client = new GatewayClient(testConfig);
    const result = await summarizeErrorsHandler(
      { service: 'payments_api', top: 10 },
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/API key|401/i);
  });

  it('registerSummarizeErrors registra la herramienta en el servidor', () => {
    const mockServer = { registerTool: vi.fn() } as unknown as McpServer;
    const client = new GatewayClient(testConfig);
    registerSummarizeErrors(mockServer, client, testConfig);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'summarize_errors',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    );
  });
});
