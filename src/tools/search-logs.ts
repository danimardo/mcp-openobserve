import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GatewayClient } from '../gateway-client.js';
import type { Config } from '../config.js';
import { ForbiddenError, GatewayError, ValidationError } from '../errors.js';
import { getCachedServices, invalidateServicesCache } from './list-services.js';
import { resolveTimeWindow, expandLevel } from '../time.js';
import { runPaginated } from '../pagination.js';
import {
  formatLogsResponse,
  formatEmptyResponse,
  formatErrorResponse,
  truncateIfNeeded,
} from '../formatters.js';

export const SEARCH_LOGS_DESCRIPTION =
  'Busca logs por texto libre en el gateway centralizado. Requiere allow_q=true en la key. ' +
  'POLÍTICA: usa primero los logs locales del proyecto para búsquedas en fallos recientes con rutas conocidas; ' +
  'usa esta herramienta para búsqueda histórica, remota o cuando el texto aparece en múltiples servicios ' +
  'o asociado a request_id/trace_id específicos.';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const searchLogsSchema = z.object({
  service: z.string().regex(/^[a-z0-9_]{3,64}$/, 'El servicio debe cumplir ^[a-z0-9_]{3,64}$'),
  query: z.string().min(1, 'El texto de búsqueda no puede estar vacío'),
  env: z.string().optional(),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  since: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().optional(),
  sort: z.enum(['asc', 'desc']).default('desc'),
  max_pages: z.number().int().positive().optional(),
});

type SearchLogsArgs = z.input<typeof searchLogsSchema>;

export async function searchLogsHandler(
  args: SearchLogsArgs,
  client: GatewayClient,
  config: Config
): Promise<ToolResult> {
  try {
    const input = searchLogsSchema.parse(args);
    const env = input.env ?? (config.defaultEnv || undefined);
    const cachedInfo = await getCachedServices(client).catch(() => null);
    if (cachedInfo?.limits?.allow_q === false) {
      return {
        content: [
          {
            type: 'text',
            text:
              'Esta API key no permite búsqueda textual libre (allow_q=false).\n' +
              'Usa query_logs con filtros de nivel, entorno y ventana temporal para acotar la búsqueda.',
          },
        ],
        isError: true,
      };
    }

    const timeWindow = resolveTimeWindow({
      since: input.since,
      from: input.from,
      to: input.to,
      defaultSince: config.defaultSince,
    });

    const expandedLevel = input.level ? expandLevel(input.level).join(',') : undefined;

    const paginationResult = await runPaginated(
      (cursor, limit) =>
        client.queryLogs({
          service: input.service,
          from: timeWindow.from,
          to: timeWindow.to,
          level: expandedLevel,
          env,
          limit,
          cursor,
          sort: input.sort,
          q: input.query,
        }),
      {
        requestedCursor: input.cursor,
        requestedMaxPages: input.max_pages,
        requestedLimit: input.limit,
        configMaxPages: config.maxPages,
        configMaxLimit: config.maxLimit,
        configDefaultLimit: config.defaultLimit,
      }
    );

    let text: string;
    if (paginationResult.items.length === 0) {
      text = formatEmptyResponse(input.service, timeWindow, paginationResult.lastRequestId);
    } else {
      text = formatLogsResponse(paginationResult.items, {
        service: input.service,
        env,
        from: timeWindow.from,
        to: timeWindow.to,
        sort: input.sort,
        nextCursor: paginationResult.hasMore ? paginationResult.lastCursor : null,
        rangeTruncated: paginationResult.rangeTruncated,
        limitTruncated: paginationResult.limitTruncated,
        total: paginationResult.total,
        requestId: paginationResult.lastRequestId,
      });
    }

    return { content: [{ type: 'text', text: truncateIfNeeded(text, config.responseMaxChars) }] };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        content: [{ type: 'text', text: err.issues[0]?.message ?? 'Entrada inválida' }],
        isError: true,
      };
    }
    if (err instanceof ValidationError) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
    if (err instanceof GatewayError) {
      if (err instanceof ForbiddenError) {
        invalidateServicesCache();
      }
      return { content: [{ type: 'text', text: formatErrorResponse(err) }], isError: true };
    }
    throw err;
  }
}

export function registerSearchLogs(server: McpServer, client: GatewayClient, config: Config): void {
  server.registerTool(
    'search_logs',
    { description: SEARCH_LOGS_DESCRIPTION, inputSchema: searchLogsSchema },
    (args) => searchLogsHandler(args as SearchLogsArgs, client, config)
  );
}
