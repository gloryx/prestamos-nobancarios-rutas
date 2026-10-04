import { describe, expect, it, vi } from 'vitest';
import { profitabilityApi } from './profitability.api';

describe('profitability transport', () => {
  it('uses the backend period, pagination and payment filters without deriving data', async () => {
    const payload = { items: [], total: 0, page: 2, pageSize: 20, totalPages: 0 };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      { ok: true, status: 200, json: async () => payload } as Response);
    try {
      await profitabilityApi.summary('2026-10');
      await profitabilityApi.capitalSeries('2026-10');
      await profitabilityApi.normal('2026-10', 2, 20, 'CANCELLED');
      await profitabilityApi.refinancings('2026-10', 2, 20, 'ACTIVE');
      await profitabilityApi.payments('2026-10', 2, 20,
        { source: 'REFINANCING', rootLoanId: 'root-1' });
      expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        '/cash-movements/profitability', '/cash-movements/capital-rotation',
        '/cash-movements/profitability/normal', '/cash-movements/profitability/refinancings',
        '/cash-movements/profitability/payments',
      ]);
      expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[4][0])).searchParams)).toEqual({
        period: '2026-10', page: '2', pageSize: '20', source: 'REFINANCING', rootLoanId: 'root-1',
      });
      expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[2][0])).searchParams)).toEqual({
        period: '2026-10', page: '2', pageSize: '20', status: 'CANCELLED',
      });
      expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[3][0])).searchParams)).toEqual({
        period: '2026-10', page: '2', pageSize: '20', terminalStatus: 'ACTIVE',
      });
      expect(fetchMock.mock.calls.every(([, options]) =>
        (options as RequestInit).cache === 'no-store' && (options as RequestInit).credentials === 'include')).toBe(true);
    } finally { fetchMock.mockRestore(); }
  });
});
