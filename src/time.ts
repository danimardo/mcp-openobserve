import { ValidationError } from './errors.js';

const SEVERITY_ORDER = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const SINCE_PATTERN = /^(\d+)(s|m|h|d)$/;

function parseSinceMs(since: string): number {
  const match = SINCE_PATTERN.exec(since);
  if (!match) {
    throw new ValidationError(
      `Formato de since inválido: "${since}". Use formato como 30s, 15m, 1h, 7d.`
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * multipliers[unit];
}

export interface TimeWindowParams {
  since?: string;
  from?: string;
  to?: string;
  defaultSince?: string;
}

export interface TimeWindow {
  from: string;
  to: string;
}

export function resolveTimeWindow(params: TimeWindowParams): TimeWindow {
  const { since, from, to } = params;

  if (since !== undefined && (from !== undefined || to !== undefined)) {
    throw new ValidationError(
      'since y from/to son mutuamente excluyentes. Usa since O from/to, no ambos.'
    );
  }

  if (to !== undefined && from === undefined) {
    throw new ValidationError('Si se especifica to, también debe especificarse from.');
  }

  if (from !== undefined && to !== undefined) {
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    if (isNaN(fromMs) || isNaN(toMs)) {
      throw new ValidationError('from y to deben ser fechas ISO-8601 válidas.');
    }
    if (fromMs > toMs) {
      throw new ValidationError('from debe ser anterior a to.');
    }
    return { from, to };
  }

  if (from !== undefined) {
    return { from, to: new Date().toISOString() };
  }

  const defaultSince = params.defaultSince ?? process.env.MCP_DEFAULT_SINCE ?? '1h';
  const sinceToUse = since ?? defaultSince;
  const ms = parseSinceMs(sinceToUse);
  const now = new Date();
  return {
    from: new Date(now.getTime() - ms).toISOString(),
    to: now.toISOString(),
  };
}

export function expandLevel(level: string): string[] {
  const idx = (SEVERITY_ORDER as readonly string[]).indexOf(level);
  if (idx < 0) {
    throw new ValidationError(
      `Nivel de log inválido: "${level}". Valores válidos: ${SEVERITY_ORDER.join(', ')}`
    );
  }
  return Array.from(SEVERITY_ORDER.slice(idx));
}
