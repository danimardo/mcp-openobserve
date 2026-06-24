import type { Config } from './config.js';
import type { QueryResult, ServicesInfo } from './types.js';
import {
  AuthError,
  BackendError,
  ForbiddenError,
  GatewayValidationError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  UnavailableError,
} from './errors.js';

export interface QueryLogsParams {
  service: string;
  from: string;
  to: string;
  level?: string;
  env?: string;
  limit?: number;
  cursor?: string | null;
  sort?: 'asc' | 'desc';
  q?: string;
  request_id?: string;
  trace_id?: string;
}

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly authHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly gatewayUrl: string;

  constructor(config: Config) {
    this.gatewayUrl = config.gatewayUrl;
    this.baseUrl = `${config.gatewayUrl}${config.apiPrefix}`;
    this.authHeaders = {
      Authorization: `Bearer ${config.apiKey}`,
    };
    this.timeoutMs = config.requestTimeoutMs;
  }

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const attempt = async (): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      return await attempt();
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (isAbort) {
        const pause = 1000 + Math.random() * 1000;
        await new Promise((r) => setTimeout(r, pause));
        try {
          return await attempt();
        } catch (retryErr) {
          const isRetryAbort = retryErr instanceof DOMException && retryErr.name === 'AbortError';
          if (isRetryAbort) {
            throw new TimeoutError(this.timeoutMs);
          }
          throw this.wrapNetworkError(retryErr);
        }
      }
      throw this.wrapNetworkError(err);
    }
  }

  private wrapNetworkError(err: unknown): Error {
    const reason = err instanceof Error ? err.message : String(err);
    return new NetworkError(this.gatewayUrl, reason);
  }

  private async throwFromResponse(response: Response): Promise<never> {
    let requestId: string | undefined;
    let detail = '';
    try {
      const body = (await response.json()) as {
        request_id?: string;
        message?: string;
        detail?: string;
        error?: { code?: string; message?: string; details?: unknown };
      };
      requestId = body.request_id;
      detail = body.error?.message ?? body.message ?? body.detail ?? '';
    } catch {
      // ignore parse errors
    }
    switch (response.status) {
      case 400:
        throw new GatewayValidationError(detail, requestId);
      case 401:
        throw new AuthError(requestId);
      case 403:
        throw new ForbiddenError(detail || 'Acceso denegado', requestId);
      case 429:
        throw new RateLimitError(requestId);
      case 502:
        throw new BackendError(requestId);
      case 503:
        throw new UnavailableError(requestId);
      default:
        throw new UnavailableError(requestId);
    }
  }

  private buildQueryString(
    params: Record<string, string | number | boolean | undefined | null>
  ): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
    }
    return parts.length > 0 ? '?' + parts.join('&') : '';
  }

  async listServices(): Promise<ServicesInfo> {
    const url = `${this.baseUrl}/services`;
    const response = await this.fetchWithTimeout(url, { headers: this.authHeaders });
    if (!response.ok) {
      await this.throwFromResponse(response);
    }
    return response.json() as Promise<ServicesInfo>;
  }

  async queryLogs(params: QueryLogsParams): Promise<QueryResult> {
    const qs = this.buildQueryString({
      service: params.service,
      from: params.from,
      to: params.to,
      level: params.level,
      env: params.env,
      limit: params.limit,
      cursor: params.cursor ?? undefined,
      sort: params.sort,
      q: params.q,
      request_id: params.request_id,
      trace_id: params.trace_id,
    });
    const url = `${this.baseUrl}/logs${qs}`;
    const response = await this.fetchWithTimeout(url, { headers: this.authHeaders });
    if (!response.ok) {
      await this.throwFromResponse(response);
    }
    return response.json() as Promise<QueryResult>;
  }

  async checkHealth(): Promise<{ status: string }> {
    const url = `${this.baseUrl}/health`;
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) {
      await this.throwFromResponse(response);
    }
    return response.json() as Promise<{ status: string }>;
  }

  async checkReadiness(): Promise<'ready' | 'not_ready'> {
    const url = `${this.baseUrl}/health/ready`;
    const response = await this.fetchWithTimeout(url);
    if (response.ok) return 'ready';
    if (response.status === 503) return 'not_ready';
    await this.throwFromResponse(response);
    return 'not_ready';
  }

  async getMetrics(): Promise<string> {
    const url = `${this.baseUrl}/metrics`;
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) {
      await this.throwFromResponse(response);
    }
    return response.text();
  }
}
