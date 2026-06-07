import { describe, it, expect } from 'vitest';
import { LIST_SERVICES_DESCRIPTION } from '../../src/tools/list-services.js';
import { QUERY_LOGS_DESCRIPTION } from '../../src/tools/query-logs.js';
import { SEARCH_LOGS_DESCRIPTION } from '../../src/tools/search-logs.js';
import { GET_RECENT_ERRORS_DESCRIPTION } from '../../src/tools/get-recent-errors.js';
import { SUMMARIZE_ERRORS_DESCRIPTION } from '../../src/tools/summarize-errors.js';
import { GET_LOG_BY_TRACE_OR_REQUEST_DESCRIPTION } from '../../src/tools/get-log-by-trace-or-request.js';
import { CHECK_GATEWAY_HEALTH_DESCRIPTION } from '../../src/tools/check-gateway-health.js';
import { GET_METRICS_DESCRIPTION } from '../../src/tools/get-metrics.js';

const ALL_DESCRIPTIONS: Record<string, string> = {
  list_services: LIST_SERVICES_DESCRIPTION,
  query_logs: QUERY_LOGS_DESCRIPTION,
  search_logs: SEARCH_LOGS_DESCRIPTION,
  get_recent_errors: GET_RECENT_ERRORS_DESCRIPTION,
  summarize_errors: SUMMARIZE_ERRORS_DESCRIPTION,
  get_log_by_trace_or_request: GET_LOG_BY_TRACE_OR_REQUEST_DESCRIPTION,
  check_gateway_health: CHECK_GATEWAY_HEALTH_DESCRIPTION,
  get_metrics: GET_METRICS_DESCRIPTION,
};

describe('políticas de herramientas — local-primero (US-002, constitución IV, SC-005)', () => {
  for (const [toolName, description] of Object.entries(ALL_DESCRIPTIONS)) {
    it(`${toolName}: contiene referencia a logs locales`, () => {
      expect(description.toLowerCase()).toMatch(/local/);
    });

    it(`${toolName}: contiene referencia a uso del MCP para contexto histórico, remoto o por IDs`, () => {
      expect(description.toLowerCase()).toMatch(
        /histórico|remoto|request_id|trace_id|centralizado|gateway/
      );
    });

    it(`${toolName}: descripción no está vacía`, () => {
      expect(description.length).toBeGreaterThan(20);
    });
  }
});
