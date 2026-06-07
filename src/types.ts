export interface LogEvent {
  _timestamp?: string;
  service?: string;
  env?: string;
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message?: string;
  version?: string;
  event_id?: string;
  trace_id?: string;
  span_id?: string;
  request_id?: string;
  hostname?: string;
  source?: 'backend' | 'frontend' | 'unknown';
  context?: Record<string, unknown>;
  context_truncated?: boolean;
}

export interface QueryResult {
  items: LogEvent[];
  next_cursor: string | null;
  range_truncated: boolean;
  limit_truncated: boolean;
  total?: number;
  request_id: string;
}

export interface ServicesInfo {
  services: string[];
  envs: string[];
  scopes: ('read' | 'write')[];
  limits?: {
    max_query_window?: string | null;
    max_limit?: number;
    allow_q?: boolean;
    response_profile?: 'full' | 'frontend_reduced';
  };
  request_id: string;
}
