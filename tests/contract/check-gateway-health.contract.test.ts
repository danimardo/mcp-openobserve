import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from '../../src/gateway-client.js';
import { checkGatewayHealthHandler, registerCheckGatewayHealth } from '../../src/tools/check-gateway-health.js';
import type { Config } from '../../src/config.js';

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

describe('check_gateway_health contract', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('/health 200 + include_ready=false → "Liveness: ok ✓"', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse({ status: 'ok' })
    );
    const client = new GatewayClient(testConfig);
    const result = await checkGatewayHealthHandler(
      { include_ready: false },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Liveness: ok');
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  it('/health 200 + /health/ready 200 → liveness ok + readiness ready', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse({ status: 'ok' }))
      .mockResolvedValueOnce(makeFetchResponse({ status: 'ready' }));

    const client = new GatewayClient(testConfig);
    const result = await checkGatewayHealthHandler(
      { include_ready: true },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Liveness: ok');
    expect(result.content[0].text).toContain('Readiness: ready');
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });

  it('/health 200 + /health/ready 503 → liveness ok + readiness not_ready, isError=false (US-011 CA-2)', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(makeFetchResponse({ status: 'ok' }))
      .mockResolvedValueOnce(makeFetchResponse({ status: 'not_ready' }, 503));

    const client = new GatewayClient(testConfig);
    const result = await checkGatewayHealthHandler(
      { include_ready: true },
      client,
      testConfig
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Liveness: ok');
    expect(result.content[0].text).toContain('not_ready');
  });

  it('/health → error de red → isError=true con mensaje de conectividad', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(
      new TypeError('fetch failed')
    );
    const client = new GatewayClient(testConfig);
    const result = await checkGatewayHealthHandler(
      { include_ready: false },
      client,
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/conectividad|conectar|LOG_GATEWAY_URL/i);
  });

  it('endpoints se llaman sin cabecera Authorization', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse({ status: 'ok' })
    );
    const client = new GatewayClient(testConfig);
    await checkGatewayHealthHandler({ include_ready: false }, client, testConfig);

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    for (const call of calls) {
      const options = call[1] as RequestInit | undefined;
      const headers = options?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBeUndefined();
    }
  });

  it('registerCheckGatewayHealth registra la herramienta en el servidor', () => {
    const mockServer = { registerTool: vi.fn() } as unknown as McpServer;
    const client = new GatewayClient(testConfig);
    registerCheckGatewayHealth(mockServer, client, testConfig);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'check_gateway_health',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    );
  });
});
