import { z } from 'zod';

export interface Config {
  gatewayUrl: string;
  apiKey: string;
  apiPrefix: string;
  logLevel: string;
  publicLogLevel: string;
  defaultEnv: string;
  defaultSince: string;
  defaultLimit: number;
  maxLimit: number;
  maxPages: number;
  requestTimeoutMs: number;
  enableMetricsTool: boolean;
  maxServicesFanout: number;
  responseMaxChars: number;
}

const OO_VARS = ['OO_URL', 'OO_USER', 'OO_PASSWORD', 'OO_ORG', 'OO_STREAM'] as const;

function parseBool(value: string | undefined, defaultVal: boolean): boolean {
  if (value === undefined) return defaultVal;
  return value.toLowerCase() !== 'false';
}

function parseIntEnv(value: string | undefined, defaultVal: number): number {
  if (value === undefined) return defaultVal;
  const n = parseInt(value, 10);
  return isNaN(n) ? defaultVal : n;
}

export function parseConfig(): Config {
  for (const varName of OO_VARS) {
    if (process.env[varName] !== undefined) {
      throw new Error(
        `Variable de entorno no permitida: ${varName}. ` +
          `Este servidor MCP usa el Log Gateway API, no OpenObserve directamente. ` +
          `Elimina ${varName} de la configuración.`
      );
    }
  }

  const gatewayUrlRaw = process.env.LOG_GATEWAY_URL;
  if (!gatewayUrlRaw) {
    throw new Error(
      'Variable de entorno obligatoria no definida: LOG_GATEWAY_URL. ' +
        'Configura LOG_GATEWAY_URL con la URL base del Log Gateway.'
    );
  }

  const apiKey = process.env.LOG_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Variable de entorno obligatoria no definida: LOG_GATEWAY_API_KEY. ' +
        'Configura LOG_GATEWAY_API_KEY con la API key del Log Gateway.'
    );
  }

  const optionalSchema = z.object({
    LOG_GATEWAY_API_PREFIX: z.string().default('/api/v1'),
    LOG_LEVEL: z.string().default(''),
    PUBLIC_LOG_LEVEL: z.string().default('warn'),
    MCP_DEFAULT_ENV: z.string().default(''),
    MCP_DEFAULT_SINCE: z.string().default('1h'),
    MCP_DEFAULT_LIMIT: z.string().default('100'),
    MCP_MAX_LIMIT: z.string().default('1000'),
    MCP_MAX_PAGES: z.string().default('5'),
    MCP_REQUEST_TIMEOUT_MS: z.string().default('15000'),
    MCP_ENABLE_METRICS_TOOL: z.string().default('true'),
    MCP_MAX_SERVICES_FANOUT: z.string().default('20'),
    MCP_RESPONSE_MAX_CHARS: z.string().default('50000'),
  });

  const opts = optionalSchema.parse(process.env);

  return {
    gatewayUrl: gatewayUrlRaw.replace(/\/$/, ''),
    apiKey,
    apiPrefix: opts.LOG_GATEWAY_API_PREFIX,
    logLevel: opts.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
    publicLogLevel: opts.PUBLIC_LOG_LEVEL,
    defaultEnv: opts.MCP_DEFAULT_ENV,
    defaultSince: opts.MCP_DEFAULT_SINCE,
    defaultLimit: parseIntEnv(opts.MCP_DEFAULT_LIMIT, 100),
    maxLimit: parseIntEnv(opts.MCP_MAX_LIMIT, 1000),
    maxPages: parseIntEnv(opts.MCP_MAX_PAGES, 5),
    requestTimeoutMs: parseIntEnv(opts.MCP_REQUEST_TIMEOUT_MS, 15000),
    enableMetricsTool: parseBool(opts.MCP_ENABLE_METRICS_TOOL, true),
    maxServicesFanout: parseIntEnv(opts.MCP_MAX_SERVICES_FANOUT, 20),
    responseMaxChars: parseIntEnv(opts.MCP_RESPONSE_MAX_CHARS, 50000),
  };
}
