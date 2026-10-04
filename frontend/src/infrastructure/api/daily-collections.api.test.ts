import { describe, expect, it, vi } from 'vitest';
import { dailyCollectionsApi } from './daily-collections.api';

describe('daily collections transport', () => {
  it('requests summary, due and received for the selected date with authenticated server filters', async () => {
    const payload = { items: [], total: 0, page: 2, pageSize: 20 };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => payload } as Response);
    try {
      await dailyCollectionsApi.summary('2026-10-01');
      await dailyCollectionsApi.due({ date: '2026-10-01', search: 'Ana', page: 2, pageSize: 20 });
      await dailyCollectionsApi.received({ date: '2026-10-01', search: 'Ana', page: 2, pageSize: 20 });
      expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        '/payments/daily-collections/summary', '/payments/daily-collections/due', '/payments/daily-collections/received',
      ]);
      expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[0][0])).searchParams)).toEqual({ date: '2026-10-01' });
      for (const [url, options] of fetchMock.mock.calls.slice(1)) {
        expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual({ date: '2026-10-01', search: 'Ana', page: '2', pageSize: '20' });
        expect(options).toMatchObject({ cache: 'no-store', credentials: 'include' });
      }
    } finally { fetchMock.mockRestore(); }
  });
});
