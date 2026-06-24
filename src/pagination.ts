import type { QueryResult } from './types.js';
import type { LogEvent } from './types.js';

export interface PaginationOptions {
  requestedCursor?: string | null;
  requestedMaxPages?: number;
  requestedLimit?: number;
  configMaxPages: number;
  configMaxLimit: number;
  configDefaultLimit: number;
}

export interface PaginationResult {
  items: LogEvent[];
  lastRequestId: string;
  lastCursor: string | null;
  hasMore: boolean;
  pagesRead: number;
  rangeTruncated: boolean;
  limitTruncated: boolean;
  total?: number;
}

export interface PaginationState {
  currentPage: number;
  maxPages: number;
  cursor: string | null;
  accumulated: LogEvent[];
  hasMore: boolean;
}

export async function runPaginated(
  fetchPage: (cursor: string | null, limit: number) => Promise<QueryResult>,
  options: PaginationOptions
): Promise<PaginationResult> {
  const effectiveMaxPages = Math.max(
    1,
    Math.min(options.requestedMaxPages ?? 1, options.configMaxPages)
  );
  const effectiveLimit = Math.max(
    1,
    Math.min(options.requestedLimit ?? options.configDefaultLimit, options.configMaxLimit)
  );

  const state: PaginationState = {
    currentPage: 0,
    maxPages: effectiveMaxPages,
    cursor: options.requestedCursor ?? null,
    accumulated: [],
    hasMore: false,
  };

  let lastRequestId = '';
  let rangeTruncated = false;
  let limitTruncated = false;
  let total: number | undefined;

  while (state.currentPage < state.maxPages) {
    const page = await fetchPage(state.cursor, effectiveLimit);
    state.accumulated.push(...page.items);
    state.currentPage++;
    lastRequestId = page.request_id;
    rangeTruncated = rangeTruncated || page.range_truncated;
    limitTruncated = limitTruncated || page.limit_truncated;
    if (page.total !== undefined) {
      total = page.total;
    }

    if (page.next_cursor === null) {
      state.hasMore = false;
      break;
    }

    state.cursor = page.next_cursor;

    if (state.currentPage >= state.maxPages) {
      state.hasMore = true;
      break;
    }
  }

  return {
    items: state.accumulated,
    lastRequestId,
    lastCursor: state.cursor,
    hasMore: state.hasMore,
    pagesRead: state.currentPage,
    rangeTruncated,
    limitTruncated,
    total,
  };
}
