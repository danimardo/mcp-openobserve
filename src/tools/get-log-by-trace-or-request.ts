import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GatewayClient } from '../gateway-client.js';
import type { Config } from '../config.js';
import { ForbiddenError, GatewayError, ValidationError } from '../errors.js';
import { resolveTimeWindow } from '../time.js';
import { runPaginated } from '../pagination.js';
import { getCachedServices, invalidateServicesCache } from './list-services.js';
import { formatLogsResponse, formatErrorResponse, truncateIfNeeded } from '../formatters.js';
import type { LogEvent } from '../types.js';

export const GET_LOG_BY_TRACE_OR_REQUEST_DESCRIPTION =
  'Busca todos los logs asociados a un request_id o trace_id concreto en el gateway centralizado. ' +
  'Ideal para reconstruir el flujo completo de una petición a través de múltiples servicios remotos. ' +
  'POLÍTICA: para fallos recientes locales, revisa primero los logs locales en .logs/; ' +
  'usa esta herramienta para correlación histórica o remota por request_id/trace_id en el gateway.';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const getLogByTraceSchema = z
  .object({
    request_id: z.string().optional(),
    trace_id: z.string().optional(),
    service: z
      .string()
      .regex(/^[a-z0-9_]{3,64}$/)
      .optional(),
    env: z.string().optional(),
    since: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().int().positive().optional(),
    cursor: z.string().optional(),
    sort: z.enum(['asc', 'desc']).default('asc'),
    max_pages: z.number().int().positive().optional(),
  })
  .refine((d) => d.request_id !== undefined || d.trace_id !== undefined, {
    message: 'Se requiere request_id o trace_id (o ambos)',
  });

type GetLogByTraceArgs = z.input<typeof getLogByTraceSchema>;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function getLogByTraceOrRequestHandler(
  args: GetLogByTraceArgs,
  client: GatewayClient,
  config: Config
): Promise<ToolResult> {
  try {
    const input = getLogByTraceSchema.parse(args);
    const env = input.env ?? (config.defaultEnv || undefined);
    const timeWindow = resolveTimeWindow({
      since: input.since,
      from: input.from,
      to: input.to,
      defaultSince: config.defaultSince,
    });

    const queryForService = async (
      svc: string
    ): Promise<{
      items: LogEvent[];
      requestId: string;
      hasMore: boolean;
      nextCursor: string | null;
      rangeTruncated: boolean;
      limitTruncated: boolean;
      total?: number;
    }> => {
      const result = await runPaginated(
        (cursor, limit) =>
          client.queryLogs({
            service: svc,
            from: timeWindow.from,
            to: timeWindow.to,
            request_id: input.request_id,
            trace_id: input.trace_id,
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
      return {
        items: result.items,
        requestId: result.lastRequestId,
        hasMore: result.hasMore,
        nextCursor: result.lastCursor,
        rangeTruncated: result.rangeTruncated,
        limitTruncated: result.limitTruncated,
        total: result.total,
      };
    };

    if (input.service) {
      const result = await queryForService(input.service);
      const { items, requestId } = result;
      if (items.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text:
                `No se encontraron logs para el identificador dado en ${input.service}.` +
                (requestId ? `\nRequest-ID gateway: ${requestId}` : ''),
            },
          ],
        };
      }
      const text = formatLogsResponse(items, {
        service: input.service,
        env,
        from: timeWindow.from,
        to: timeWindow.to,
        sort: input.sort,
        nextCursor: result.hasMore ? result.nextCursor : null,
        rangeTruncated: result.rangeTruncated,
        limitTruncated: result.limitTruncated,
        total: result.total,
        requestId,
      });
      return { content: [{ type: 'text', text: truncateIfNeeded(text, config.responseMaxChars) }] };
    }

    const servicesInfo = await getCachedServices(client);
    const limited = servicesInfo.services.slice(0, config.maxServicesFanout);
    const batchSize = Math.min(5, config.maxServicesFanout);
    const chunks = chunkArray(limited, batchSize);

    const allItems: LogEvent[] = [];
    const failedServices: string[] = [];
    const requestIds: string[] = [];

    for (const chunk of chunks) {
      const settled = await Promise.allSettled(chunk.map((svc) => queryForService(svc)));
      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status === 'fulfilled') {
          allItems.push(...r.value.items);
          if (r.value.requestId) requestIds.push(r.value.requestId);
        } else {
          failedServices.push(chunk[i]);
        }
      }
    }

    const lines: string[] = [];
    const idLabel = input.request_id
      ? `request_id=${input.request_id}`
      : `trace_id=${input.trace_id}`;
    lines.push(`Logs para ${idLabel} — ${limited.length} servicios consultados`);
    lines.push('');

    if (allItems.length > 0) {
      lines.push(
        formatLogsResponse(allItems, {
          service: limited.join(', '),
          from: timeWindow.from,
          to: timeWindow.to,
          sort: input.sort,
        })
      );
    } else {
      lines.push('No se encontraron resultados en ningún servicio.');
    }

    if (failedServices.length > 0) {
      lines.push(`\n━━━ Servicios con error de consulta: ${failedServices.join(', ')} ━━━`);
    }
    if (requestIds.length > 0) {
      lines.push(`\nRequest-IDs gateway: ${requestIds.join(', ')}`);
    }

    return {
      content: [
        { type: 'text', text: truncateIfNeeded(lines.join('\n'), config.responseMaxChars) },
      ],
    };
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

export function registerGetLogByTraceOrRequest(
  server: McpServer,
  client: GatewayClient,
  config: Config
): void {
  server.registerTool(
    'get_log_by_trace_or_request',
    { description: GET_LOG_BY_TRACE_OR_REQUEST_DESCRIPTION, inputSchema: getLogByTraceSchema },
    (args) => getLogByTraceOrRequestHandler(args as GetLogByTraceArgs, client, config)
  );
}
