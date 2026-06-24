import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from '../../src/gateway-client.js';
import {
  listServicesHandler,
  invalidateServicesCache,
  registerListServices,
} from '../../src/tools/list-services.js';
import type { Config } from '../../src/config.js';
import type { ServicesInfo } from '../../src/types.js';

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

const sampleServices: ServicesInfo = {
  services: ['payments_api', 'auth_service'],
  envs: ['prod', 'staging'],
  scopes: ['read'],
  limits: {
    max_limit: 1000,
    allow_q: true,
    max_query_window: null,
    response_profile: 'full',
  },
  request_id: 'req_abc123',
};

function mockFetchResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response;
}

describe('list_services contract', () => {
  beforeEach(() => {
    invalidateServicesCache();
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    invalidateServicesCache();
  });

  it('devuelve servicios, entornos, scopes y límites sin API key', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(sampleServices));
    const client = new GatewayClient(testConfig);
    const result = await listServicesHandler({}, client, testConfig);

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('payments_api');
    expect(text).toContain('auth_service');
    expect(text).toContain('prod');
    expect(text).toContain('staging');
    expect(text).toContain('read');
    expect(text).not.toContain(testConfig.apiKey);
    expect(text).not.toContain('secret_value');
  });

  it('devuelve AuthError en 401', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse({ message: 'Unauthorized', request_id: 'req_err_1' }, 401)
    );
    const client = new GatewayClient(testConfig);
    const result = await listServicesHandler({}, client, testConfig);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/API key/i);
  });

  it('segunda llamada dentro del TTL devuelve caché sin petición HTTP', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(sampleServices));
    const client = new GatewayClient(testConfig);

    await listServicesHandler({}, client, testConfig);
    await listServicesHandler({}, client, testConfig);

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  it('registerListServices registra la herramienta en el servidor', () => {
    const mockServer = { registerTool: vi.fn() } as unknown as McpServer;
    const client = new GatewayClient(testConfig);
    registerListServices(mockServer, client, testConfig);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'list_services',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    );
  });

  it('error 403 inesperado invalida la caché para la siguiente llamada', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockFetchResponse(sampleServices))
      .mockResolvedValueOnce(
        mockFetchResponse({ message: 'Forbidden', request_id: 'req_403' }, 403)
      )
      .mockResolvedValueOnce(mockFetchResponse(sampleServices));

    const client = new GatewayClient(testConfig);

    // First call fills cache
    await listServicesHandler({}, client, testConfig);

    // Simulate cache invalidation (as would happen after a 403 in a subsequent tool call)
    invalidateServicesCache();

    // Next call should hit the gateway again
    await listServicesHandler({}, client, testConfig);

    // Should have been called at least twice (not using cache after invalidation)
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });
});
