import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GatewayClient } from '../gateway-client.js';
import type { Config } from '../config.js';
import { GatewayError } from '../errors.js';
import { formatErrorResponse } from '../formatters.js';

export const GET_METRICS_DESCRIPTION =
  'Obtiene las métricas Prometheus del Log Gateway centralizado. ' +
  'Solo disponible si MCP_ENABLE_METRICS_TOOL=true (configurable). ' +
  'Útil para diagnosticar rate limiting o fallos en el gateway remoto. ' +
  'Devuelve texto Prometheus crudo sin parsear ni resumir. ' +
  'POLÍTICA: las métricas locales del proceso no dependen del gateway; ' +
  'usa esta herramienta para inspeccionar el estado histórico y remoto del gateway.';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export async function getMetricsHandler(
  _args: Record<string, unknown>,
  client: GatewayClient,
  config: Config
): Promise<ToolResult> {
  if (!config.enableMetricsTool) {
    return {
      content: [
        {
          type: 'text',
          text:
            'La herramienta de métricas está deshabilitada (MCP_ENABLE_METRICS_TOOL=false).\n' +
            'Para habilitarla, configura MCP_ENABLE_METRICS_TOOL=true al arrancar el servidor.',
        },
      ],
    };
  }

  try {
    const metricsText = await client.getMetrics();
    return {
      content: [
        {
          type: 'text',
          text: `Métricas del gateway (formato Prometheus):\n\n${metricsText}`,
        },
      ],
    };
  } catch (err) {
    if (err instanceof GatewayError) {
      return { content: [{ type: 'text', text: formatErrorResponse(err) }], isError: true };
    }
    throw err;
  }
}

export function registerGetMetrics(server: McpServer, client: GatewayClient, config: Config): void {
  server.registerTool(
    'get_metrics',
    { description: GET_METRICS_DESCRIPTION, inputSchema: z.object({}) },
    (args) => getMetricsHandler(args as Record<string, unknown>, client, config)
  );
}
