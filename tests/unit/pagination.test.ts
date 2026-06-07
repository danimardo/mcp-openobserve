import { describe, it, expect, vi } from 'vitest';
import { runPaginated } from '../../src/pagination.js';
import type { QueryResult } from '../../src/types.js';

function makeResult(items: number, nextCursor: string | null): QueryResult {
  return {
    items: Array(items)
      .fill(null)
      .map((_, i) => ({ message: `event-${i}`, _timestamp: new Date().toISOString() })),
    next_cursor: nextCursor,
    range_truncated: false,
    limit_truncated: false,
    request_id: `req_${Math.random()}`,
  };
}

describe('runPaginated', () => {
  it('fetches a single page when next_cursor is null', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(makeResult(3, null));
    const result = await runPaginated(fetchPage, {
      requestedMaxPages: 5,
      requestedLimit: 100,
      configMaxPages: 5,
      configMaxLimit: 1000,
      configDefaultLimit: 100,
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    expect(result.pagesRead).toBe(1);
  });

  it('stops when next_cursor is null even if currentPage < maxPages', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(makeResult(5, 'cursor_1'))
      .mockResolvedValueOnce(makeResult(3, null));
    const result = await runPaginated(fetchPage, {
      requestedMaxPages: 5,
      requestedLimit: 100,
      configMaxPages: 5,
      configMaxLimit: 1000,
      configDefaultLimit: 100,
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(8);
    expect(result.hasMore).toBe(false);
    expect(result.pagesRead).toBe(2);
  });

  it('caps max_pages silently to configMaxPages', async () => {
    const fetchPage = vi.fn().mockResolvedValue(makeResult(5, 'cursor'));
    const result = await runPaginated(fetchPage, {
      requestedMaxPages: 100,
      requestedLimit: 100,
      configMaxPages: 3,
      configMaxLimit: 1000,
      configDefaultLimit: 100,
    });
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.hasMore).toBe(true);
    expect(result.pagesRead).toBe(3);
  });

  it('caps limit silently to configMaxLimit', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(makeResult(5, null));
    await runPaginated(fetchPage, {
      requestedMaxPages: 1,
      requestedLimit: 9999,
      configMaxPages: 5,
      configMaxLimit: 1000,
      configDefaultLimit: 100,
    });
    const [firstCallArgs] = fetchPage.mock.calls;
    expect(firstCallArgs[1]).toBe(1000);
  });

  it('sets hasMore true when reaching maxPages with non-null cursor', async () => {
    const fetchPage = vi.fn().mockResolvedValue(makeResult(10, 'cursor_next'));
    const result = await runPaginated(fetchPage, {
      requestedMaxPages: 2,
      requestedLimit: 50,
      configMaxPages: 5,
      configMaxLimit: 1000,
      configDefaultLimit: 100,
    });
    expect(result.hasMore).toBe(true);
    expect(result.pagesRead).toBe(2);
  });

  it('uses configDefaultLimit when requestedLimit is undefined', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(makeResult(2, null));
    await runPaginated(fetchPage, {
      requestedMaxPages: 1,
      requestedLimit: undefined,
      configMaxPages: 5,
      configMaxLimit: 1000,
      configDefaultLimit: 100,
    });
    const [firstCallArgs] = fetchPage.mock.calls;
    expect(firstCallArgs[1]).toBe(100);
  });

  it('defaults to one page when requestedMaxPages is undefined (FR-019, SC-008)', async () => {
    const fetchPage = vi.fn().mockResolvedValue(makeResult(5, 'cursor_more'));
    const result = await runPaginated(fetchPage, {
      requestedLimit: 50,
      configMaxPages: 5,
      configMaxLimit: 1000,
      configDefaultLimit: 100,
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.hasMore).toBe(true);
    expect(result.lastCursor).toBe('cursor_more');
  });

  it('uses requestedCursor for the first page when explicit pagination is requested (FR-017)', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(makeResult(2, null));
    await runPaginated(fetchPage, {
      requestedCursor: 'cursor_from_previous_call',
      requestedMaxPages: 1,
      requestedLimit: 50,
      configMaxPages: 5,
      configMaxLimit: 1000,
      configDefaultLimit: 100,
    });

    expect(fetchPage.mock.calls[0][0]).toBe('cursor_from_previous_call');
  });

  it('preserves truncation flags and total from gateway pages (FR-040)', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({
      ...makeResult(2, null),
      range_truncated: true,
      limit_truncated: true,
      total: 25,
    });

    const result = await runPaginated(fetchPage, {
      requestedMaxPages: 1,
      requestedLimit: 50,
      configMaxPages: 5,
      configMaxLimit: 1000,
      configDefaultLimit: 100,
    });

    expect(result.rangeTruncated).toBe(true);
    expect(result.limitTruncated).toBe(true);
    expect(result.total).toBe(25);
  });

  it('passes cursor to subsequent pages', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(makeResult(5, 'cursor_abc'))
      .mockResolvedValueOnce(makeResult(3, null));
    await runPaginated(fetchPage, {
      requestedMaxPages: 5,
      requestedLimit: 50,
      configMaxPages: 5,
      configMaxLimit: 1000,
      configDefaultLimit: 100,
    });
    expect(fetchPage.mock.calls[0][0]).toBeNull();
    expect(fetchPage.mock.calls[1][0]).toBe('cursor_abc');
  });
});
