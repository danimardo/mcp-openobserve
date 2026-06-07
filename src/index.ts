import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseConfig } from './config.js';
import { GatewayClient } from './gateway-client.js';
import { logger } from './logger.js';
import { registerListServices } from './tools/list-services.js';
import { registerQueryLogs } from './tools/query-logs.js';
import { registerSearchLogs } from './tools/search-logs.js';
import { registerGetRecentErrors } from './tools/get-recent-errors.js';
import { registerSummarizeErrors } from './tools/summarize-errors.js';
import { registerGetLogByTraceOrRequest } from './tools/get-log-by-trace-or-request.js';
import { registerCheckGatewayHealth } from './tools/check-gateway-health.js';
import { registerGetMetrics } from './tools/get-metrics.js';

async function main(): Promise<void> {
  let config;
  try {
    config = parseConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mcp-openobserve] Error de configuración: ${msg}\n`);
    process.exit(1);
  }

  const server = new McpServer({ name: 'mcp-openobserve', version: '1.0.0' });
  const client = new GatewayClient(config);

  registerListServices(server, client, config);
  registerQueryLogs(server, client, config);
  registerSearchLogs(server, client, config);
  registerGetRecentErrors(server, client, config);
  registerSummarizeErrors(server, client, config);
  registerGetLogByTraceOrRequest(server, client, config);
  registerCheckGatewayHealth(server, client, config);
  registerGetMetrics(server, client, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(
    {
      gatewayUrl: config.gatewayUrl,
      defaultEnv: config.defaultEnv,
      enableMetricsTool: config.enableMetricsTool,
    },
    'mcp-openobserve arrancado'
  );
}

main();
