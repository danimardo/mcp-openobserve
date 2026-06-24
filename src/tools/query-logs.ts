import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GatewayClient } from '../gateway-client.js';
import type { Config } from '../config.js';
import { ForbiddenError, GatewayError, ValidationError } from '../errors.js';
import { resolveTimeWindow, expandLevel } from '../time.js';
import { runPaginated } from '../pagination.js';
import {
  formatLogsResponse,
  formatEmptyResponse,
  formatErrorResponse,
  truncateIfNeeded,
} from '../formatters.js';
import { invalidateServicesCache } from './list-services.js';

export const QUERY_LOGS_DESCRIPTION =
  'Consulta logs de un servicio con filtros de entorno, nivel, ventana temporal y paginación desde el gateway centralizado. ' +
  'POLÍTICA: usa primero los logs locales del proyecto (.logs/app.log) si el fallo es reciente y las rutas locales son conocidas; ' +
  'usa esta herramienta para histórico, entornos remotos o cuando los logs locales no bastan.';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const queryLogsSchema = z.object({
  service: z.string().regex(/^[a-z0-9_]{3,64}$/, 'El servicio debe cumplir ^[a-z0-9_]{3,64}$'),
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

export type QueryLogsArgs = z.input<typeof queryLogsSchema>;

export async function queryLogsHandler(
  args: QueryLogsArgs,
  client: GatewayClient,
  config: Config
): Promise<ToolResult> {
  try {
    const input = queryLogsSchema.parse(args);
    const env = input.env ?? (config.defaultEnv || undefined);
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
      if (paginationResult.hasMore) {
        text += '\n⚠ Puede haber más resultados. Usa max_pages para obtener más páginas.';
      }
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

export function registerQueryLogs(server: McpServer, client: GatewayClient, config: Config): void {
  server.registerTool(
    'query_logs',
    { description: QUERY_LOGS_DESCRIPTION, inputSchema: queryLogsSchema },
    (args) => queryLogsHandler(args as QueryLogsArgs, client, config)
  );
}
