import { describe, expect, it, vi } from 'vitest';
import { financialCloseApi } from './financial-close.api';

describe('financial close transport', () => {
  it('uses the four contracts and confirms with the period only', async () => {
    const raw = { id: 'close-1', period: '2026-10', confirmedAt: '2026-11-01T00:00:00Z',
      confirmedBy: { fullName: 'Ana' }, integrity: { status: 'COMPLETE', blockingIssues: [], warnings: ['Revisar'] },
      sections: [{ code: 'CASH', concepts: [{ code: 'CLOSING_CASH', label: 'Closing cash', amount: '100.00' }] }] };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => ({ ok: true, status: 200,
      json: async () => String(input).endsWith('/financial-closes') ? { items: [raw] } : raw } as Response));
    try {
      const preview = await financialCloseApi.preview('2026-10');
      await financialCloseApi.confirm('2026-10');
      const history = await financialCloseApi.list();
      await financialCloseApi.detail('close/1');
      expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        '/financial-closes/preview', '/financial-closes', '/financial-closes', '/financial-closes/close%2F1',
      ]);
      expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('period')).toBe('2026-10');
      expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{"period":"2026-10"}' });
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'include' });
      expect(preview.sections.liquidity.values).toEqual({ 'Closing cash': '100.00' });
      expect(preview.warnings).toEqual([{ message: 'Revisar' }]);
      expect(history).toEqual([{ id: 'close-1', period: '2026-10', confirmedAt: '2026-11-01T00:00:00Z', confirmedBy: 'Ana' }]);
    } finally { fetchMock.mockRestore(); }
  });
});
