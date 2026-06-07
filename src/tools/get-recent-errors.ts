import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GatewayClient } from '../gateway-client.js';
import type { Config } from '../config.js';
import { ForbiddenError, GatewayError, ValidationError } from '../errors.js';
import { resolveTimeWindow } from '../time.js';
import { runPaginated } from '../pagination.js';
import { formatLogsResponse, formatErrorResponse, truncateIfNeeded } from '../formatters.js';
import { invalidateServicesCache } from './list-services.js';

export const GET_RECENT_ERRORS_DESCRIPTION =
  'Obtiene errores recientes (nivel error y fatal) de un servicio desde el gateway centralizado. ' +
  'POLÍTICA: para diagnóstico de fallos recientes en desarrollo, revisa primero los logs locales en .logs/; ' +
  'usa esta herramienta para histórico de errores en producción, entornos remotos o cuando ' +
  'necesitas los request_id/trace_id completos de los errores.';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const getRecentErrorsSchema = z.object({
  service: z.string().regex(/^[a-z0-9_]{3,64}$/),
  env: z.string().optional(),
  since: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().optional(),
  sort: z.enum(['asc', 'desc']).default('desc'),
  max_pages: z.number().int().positive().optional(),
});

type GetRecentErrorsArgs = z.input<typeof getRecentErrorsSchema>;

export async function getRecentErrorsHandler(
  args: GetRecentErrorsArgs,
  client: GatewayClient,
  config: Config
): Promise<ToolResult> {
  try {
    const input = getRecentErrorsSchema.parse(args);
    const env = input.env ?? (config.defaultEnv || undefined);
    const timeWindow = resolveTimeWindow({
      since: input.since,
      from: input.from,
      to: input.to,
      defaultSince: config.defaultSince,
    });

    const paginationResult = await runPaginated(
      (cursor, limit) =>
        client.queryLogs({
          service: input.service,
          from: timeWindow.from,
          to: timeWindow.to,
          level: 'error,fatal',
          env,
          limit,
          cursor,
          sort: input.sort,
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
      text = `No se encontraron errores para ${input.service} en la ventana ${timeWindow.from} → ${timeWindow.to}.\nRequest-ID gateway: ${paginationResult.lastRequestId}`;
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

export function registerGetRecentErrors(
  server: McpServer,
  client: GatewayClient,
  config: Config
): void {
  server.registerTool(
    'get_recent_errors',
    { description: GET_RECENT_ERRORS_DESCRIPTION, inputSchema: getRecentErrorsSchema },
    (args) => getRecentErrorsHandler(args as GetRecentErrorsArgs, client, config)
  );
}
