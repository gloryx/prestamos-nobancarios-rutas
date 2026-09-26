import { describe, expect, it, vi } from 'vitest';
import { loanApi } from './loan.api';

describe('loan list sorting', () => {
  it('sends server-side sorting with pagination and filters', async () => {
    const response = { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) } as Response;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await loanApi.list({ page: 2, pageSize: 20, search: 'ana', frequencyId: 'frequency-1', fromDate: '2026-01-01', toDate: '2026-12-31', sortBy: 'pending', sortOrder: 'asc' });

    expect(fetchMock.mock.calls[0][0]).toContain('/loans?page=2&pageSize=20&search=ana&frequencyId=frequency-1&fromDate=2026-01-01&toDate=2026-12-31&sortBy=pending&sortOrder=asc');
    fetchMock.mockRestore();
  });
});
