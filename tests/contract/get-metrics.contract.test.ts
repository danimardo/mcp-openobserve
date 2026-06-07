import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from '../../src/gateway-client.js';
import { getMetricsHandler, registerGetMetrics } from '../../src/tools/get-metrics.js';
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

const disabledConfig: Config = { ...testConfig, enableMetricsTool: false };

const prometheusText = `# HELP gateway_requests_total Total de peticiones
# TYPE gateway_requests_total counter
gateway_requests_total{method="GET",endpoint="/api/v1/logs"} 1234
`;

function makeFetchResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

describe('get_metrics contract', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('MCP_ENABLE_METRICS_TOOL=false → mensaje informativo, cero llamadas HTTP (US-014 CA-2)', async () => {
    const client = new GatewayClient(disabledConfig);
    const result = await getMetricsHandler({}, client, disabledConfig);

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/deshabilitada|MCP_ENABLE_METRICS_TOOL/i);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('habilitado + mock devuelve Prometheus → texto crudo sin parsear, isError=false (SC-011)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(prometheusText));

    const client = new GatewayClient(testConfig);
    const result = await getMetricsHandler({}, client, testConfig);

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('gateway_requests_total');
    expect(result.content[0].text).toContain('1234');
    expect(result.content[0].text).not.toContain(testConfig.apiKey);
  });

  it('no incluye secretos ni API key en el output', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(prometheusText));

    const client = new GatewayClient(testConfig);
    const result = await getMetricsHandler({}, client, testConfig);

    expect(result.content[0].text).not.toContain('test_key');
    expect(result.content[0].text).not.toContain('secret_value');
  });

  it('endpoint llamado sin cabecera Authorization', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(prometheusText));

    const client = new GatewayClient(testConfig);
    await getMetricsHandler({}, client, testConfig);

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls).toHaveLength(1);
    const options = calls[0][1] as RequestInit | undefined;
    const headers = options?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBeUndefined();
  });

  it('texto Prometheus preservado tal cual sin transformaciones', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeFetchResponse(prometheusText));

    const client = new GatewayClient(testConfig);
    const result = await getMetricsHandler({}, client, testConfig);

    expect(result.content[0].text).toContain('# HELP gateway_requests_total');
    expect(result.content[0].text).toContain('# TYPE gateway_requests_total counter');
  });

  it('error HTTP del gateway → isError=true con mensaje de error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      makeFetchResponse({ message: 'Internal Server Error', request_id: 'req_err' }, 500)
    );
    const client = new GatewayClient(testConfig);
    const result = await getMetricsHandler({}, client, testConfig);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/error|500/i);
  });

  it('registerGetMetrics registra la herramienta en el servidor', () => {
    const mockServer = { registerTool: vi.fn() } as unknown as McpServer;
    const client = new GatewayClient(testConfig);
    registerGetMetrics(mockServer, client, testConfig);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'get_metrics',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    );
  });
});
