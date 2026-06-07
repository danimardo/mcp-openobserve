import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GatewayClient } from '../gateway-client.js';
import type { Config } from '../config.js';
import { NetworkError, TimeoutError } from '../errors.js';

export const CHECK_GATEWAY_HEALTH_DESCRIPTION =
  'Comprueba si el Log Gateway centralizado está vivo y, opcionalmente, listo para aceptar consultas. ' +
  'Úsala para diagnosticar problemas de conectividad con el gateway remoto antes de concluir que no hay logs. ' +
  'POLÍTICA: los logs locales en .logs/ siguen disponibles aunque el gateway esté caído; ' +
  'usa esta herramienta para verificar el estado del gateway antes de escalar a consultas históricas o remotas.';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const checkGatewayHealthSchema = z.object({
  include_ready: z.boolean().default(false),
});

type CheckGatewayHealthArgs = z.infer<typeof checkGatewayHealthSchema>;

export async function checkGatewayHealthHandler(
  args: CheckGatewayHealthArgs,
  client: GatewayClient,
  _config: Config
): Promise<ToolResult> {
  try {
    await client.checkHealth();
    const lines: string[] = ['Estado del gateway:', '  • Liveness: ok ✓'];

    if (args.include_ready) {
      const readiness = await client.checkReadiness();
      if (readiness === 'ready') {
        lines.push('  • Readiness: ready ✓');
      } else {
        lines.push(
          '  • Readiness: not_ready — el gateway está vivo pero no puede servir consultas aún'
        );
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  } catch (err) {
    if (err instanceof NetworkError || err instanceof TimeoutError) {
      return {
        content: [
          {
            type: 'text',
            text:
              `Error de conectividad: ${err.message}\n` +
              'Comprueba que LOG_GATEWAY_URL es correcto y el gateway está corriendo.',
          },
        ],
        isError: true,
      };
    }
    throw err;
  }
}

export function registerCheckGatewayHealth(
  server: McpServer,
  client: GatewayClient,
  config: Config
): void {
  server.registerTool(
    'check_gateway_health',
    { description: CHECK_GATEWAY_HEALTH_DESCRIPTION, inputSchema: checkGatewayHealthSchema },
    (args) => checkGatewayHealthHandler(args as CheckGatewayHealthArgs, client, config)
  );
}
