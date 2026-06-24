import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GatewayClient } from '../gateway-client.js';
import type { Config } from '../config.js';
import { ForbiddenError, GatewayError, ValidationError } from '../errors.js';
import { resolveTimeWindow } from '../time.js';
import { runPaginated } from '../pagination.js';
import { formatErrorResponse, truncateIfNeeded } from '../formatters.js';
import type { LogEvent } from '../types.js';
import { invalidateServicesCache } from './list-services.js';

export const SUMMARIZE_ERRORS_DESCRIPTION =
  'Agrupa y cuenta los errores más frecuentes de un servicio en el gateway centralizado. ' +
  'Útil para priorizar qué investigar. ' +
  'POLÍTICA: usa primero los logs locales para una visión rápida de errores recientes; ' +
  'usa esta herramienta para análisis histórico de errores, errores en entornos remotos ' +
  'o cuando necesitas identificar patrones a través de múltiples request_id/trace_id.';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const summarizeErrorsSchema = z.object({
  service: z.string().regex(/^[a-z0-9_]{3,64}$/),
  env: z.string().optional(),
  since: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().optional(),
  max_pages: z.number().int().positive().optional(),
  top: z.number().int().min(1).max(50).default(10),
  sort: z.enum(['asc', 'desc']).default('desc'),
});

type SummarizeErrorsArgs = z.input<typeof summarizeErrorsSchema>;

interface ErrorGroup {
  message: string;
  count: number;
  lastTimestamp: string;
}

function normalizeMessage(msg: string | undefined): string {
  return (msg ?? '').trim().replace(/\s+/g, ' ');
}

function groupErrors(items: LogEvent[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const item of items) {
    const normalized = normalizeMessage(item.message);
    const existing = groups.get(normalized);
    if (existing) {
      existing.count++;
      if (item._timestamp && item._timestamp > existing.lastTimestamp) {
        existing.lastTimestamp = item._timestamp;
      }
    } else {
      groups.set(normalized, {
        message: normalized,
        count: 1,
        lastTimestamp: item._timestamp ?? '',
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

export async function summarizeErrorsHandler(
  args: SummarizeErrorsArgs,
  client: GatewayClient,
  config: Config
): Promise<ToolResult> {
  try {
    const input = summarizeErrorsSchema.parse(args);
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
        requestedMaxPages: input.max_pages,
        requestedLimit: input.limit,
        configMaxPages: config.maxPages,
        configMaxLimit: config.maxLimit,
        configDefaultLimit: config.defaultLimit,
      }
    );

    const allItems = paginationResult.items;

    if (allItems.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No se encontraron errores para ${input.service} en la ventana ${timeWindow.from} → ${timeWindow.to}.`,
          },
        ],
      };
    }

    const groups = groupErrors(allItems);
    const topGroups = groups.slice(0, input.top);

    const lines: string[] = [
      `Resumen de errores — ${input.service}`,
      `Top ${topGroups.length} de ${groups.length} mensajes únicos | Basado en ${allItems.length} eventos`,
      '',
    ];

    for (let i = 0; i < topGroups.length; i++) {
      const g = topGroups[i];
      lines.push(`  ${i + 1}. [${g.count}x] ${g.message}`);
      if (g.lastTimestamp) {
        lines.push(`     Último: ${g.lastTimestamp}`);
      }
      lines.push('');
    }

    if (
      paginationResult.hasMore ||
      paginationResult.rangeTruncated ||
      paginationResult.limitTruncated
    ) {
      lines.push(
        `⚠ Resumen parcial: basado en ${paginationResult.pagesRead} páginas de resultados. ` +
          'Puede haber más errores no representados.'
      );
    }

    if (paginationResult.lastRequestId) {
      lines.push(`Request-ID gateway (última página): ${paginationResult.lastRequestId}`);
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

export function registerSummarizeErrors(
  server: McpServer,
  client: GatewayClient,
  config: Config
): void {
  server.registerTool(
    'summarize_errors',
    { description: SUMMARIZE_ERRORS_DESCRIPTION, inputSchema: summarizeErrorsSchema },
    (args) => summarizeErrorsHandler(args as SummarizeErrorsArgs, client, config)
  );
}
