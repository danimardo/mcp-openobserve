import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GatewayClient } from '../gateway-client.js';
import type { Config } from '../config.js';
import type { ServicesInfo } from '../types.js';
import { GatewayError } from '../errors.js';
import { formatErrorResponse } from '../formatters.js';

interface ServicesCache {
  data: ServicesInfo;
  expiresAt: number;
}

let _cache: ServicesCache | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function getCachedServices(client: GatewayClient): Promise<ServicesInfo> {
  if (_cache && Date.now() < _cache.expiresAt) return _cache.data;
  const data = await client.listServices();
  _cache = { data, expiresAt: Date.now() + TTL_MS };
  return data;
}

export function invalidateServicesCache(): void {
  _cache = null;
}

export const LIST_SERVICES_DESCRIPTION =
  'Lista los servicios, entornos, scopes y límites autorizados para la API key del Log Gateway centralizado. ' +
  'Úsala antes de consultar logs remotos o históricos para verificar qué servicios y entornos están disponibles ' +
  'y si la key permite búsqueda textual (allow_q). ' +
  'Nota: los logs locales del proyecto están disponibles en .logs/ para diagnóstico inmediato sin usar este gateway.';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function formatServicesInfo(info: ServicesInfo): string {
  const lines: string[] = [`Servicios autorizados (${info.services.length}):`];
  for (const svc of info.services) {
    lines.push(`  • ${svc}`);
  }
  lines.push('');
  lines.push(`Entornos: ${info.envs.join(', ')}`);
  lines.push(`Scopes: ${info.scopes.join(', ')}`);
  if (info.limits) {
    const limitParts: string[] = [];
    if (info.limits.max_limit !== undefined) limitParts.push(`max_limit=${info.limits.max_limit}`);
    if (info.limits.allow_q !== undefined) limitParts.push(`allow_q=${info.limits.allow_q}`);
    if (info.limits.max_query_window !== undefined) {
      limitParts.push(`ventana máxima: ${info.limits.max_query_window ?? 'sin límite'}`);
    }
    if (limitParts.length > 0) {
      lines.push(`Límites: ${limitParts.join(' | ')}`);
    }
  }
  lines.push(`Request-ID gateway: ${info.request_id}`);
  return lines.join('\n');
}

export async function listServicesHandler(
  _args: Record<string, unknown>,
  client: GatewayClient,
  _config: Config
): Promise<ToolResult> {
  try {
    const info = await getCachedServices(client);
    return { content: [{ type: 'text', text: formatServicesInfo(info) }] };
  } catch (err) {
    if (err instanceof GatewayError) {
      return { content: [{ type: 'text', text: formatErrorResponse(err) }], isError: true };
    }
    throw err;
  }
}

export function registerListServices(
  server: McpServer,
  client: GatewayClient,
  config: Config
): void {
  server.registerTool(
    'list_services',
    { description: LIST_SERVICES_DESCRIPTION, inputSchema: z.object({}) },
    (args) => listServicesHandler(args as Record<string, unknown>, client, config)
  );
}
