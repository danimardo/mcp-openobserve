import type { LogEvent } from './types.js';
import type { GatewayError } from './errors.js';

const SEPARATOR = '━'.repeat(40);

const dateFormatter = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return 'sin timestamp';
  try {
    return dateFormatter.format(new Date(iso)).replace(',', '');
  } catch {
    return iso;
  }
}

function formatEvent(event: LogEvent): string {
  const parts: string[] = [];
  const header = [
    formatTimestamp(event._timestamp),
    event.level?.toUpperCase() ?? 'UNKNOWN',
    event.service ?? 'unknown',
  ].join('  ');
  parts.push(header);

  if (event.message) {
    parts.push(event.message);
  }

  const correlationParts: string[] = [];
  if (event.request_id) correlationParts.push(`request_id: ${event.request_id}`);
  if (event.trace_id) correlationParts.push(`trace_id: ${event.trace_id}`);
  if (event.span_id) correlationParts.push(`span_id: ${event.span_id}`);
  if (correlationParts.length > 0) {
    parts.push(`↳ ${correlationParts.join(' | ')}`);
  }

  return parts.join('\n');
}

export interface ResponseMeta {
  service: string;
  env?: string;
  from: string;
  to: string;
  sort: 'asc' | 'desc';
  nextCursor?: string | null;
  rangeTruncated?: boolean;
  limitTruncated?: boolean;
  total?: number;
  requestId?: string;
  pageInfo?: string;
}

export function formatLogsResponse(items: LogEvent[], meta: ResponseMeta): string {
  const envPart = meta.env ? ` (${meta.env})` : '';
  const lines: string[] = [
    `Logs de ${meta.service}${envPart} — ${items.length} eventos`,
    `Ventana: ${meta.from} → ${meta.to} | Orden: ${meta.sort}`,
    '',
  ];

  for (const event of items) {
    lines.push(SEPARATOR);
    lines.push(formatEvent(event));
  }

  if (items.length > 0) {
    lines.push(SEPARATOR);
    lines.push('');
  }

  const paginationParts: string[] = [];
  if (meta.nextCursor) {
    paginationParts.push(`next_cursor=${meta.nextCursor}`);
  } else {
    paginationParts.push('Sin más páginas');
  }
  if (meta.rangeTruncated !== undefined) {
    paginationParts.push(`range_truncated=${meta.rangeTruncated}`);
  }
  if (meta.limitTruncated !== undefined) {
    paginationParts.push(`limit_truncated=${meta.limitTruncated}`);
  }
  if (meta.total !== undefined) {
    paginationParts.push(`total=${meta.total}`);
  }
  lines.push(`Paginación: ${paginationParts.join(' | ')}`);

  if (meta.requestId) {
    lines.push(`Request-ID gateway: ${meta.requestId}`);
  }

  return lines.join('\n');
}

export function formatEmptyResponse(
  service: string,
  window: { from: string; to: string },
  requestId?: string
): string {
  const lines = [
    `No se encontraron logs para ${service} en la ventana ${window.from} → ${window.to}.`,
  ];
  if (requestId) {
    lines.push(`Request-ID gateway: ${requestId}`);
  }
  return lines.join('\n');
}

export function formatErrorResponse(error: GatewayError): string {
  const lines = [`Error ${error.name}: ${error.message}`];
  if (error.requestId) {
    lines.push(`Request-ID gateway: ${error.requestId}`);
  }
  return lines.join('\n');
}

export function truncateIfNeeded(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const remaining = text.length - maxChars;
  return (
    text.slice(0, maxChars) +
    `\n... [respuesta truncada — ${remaining} caracteres adicionales omitidos]`
  );
}
