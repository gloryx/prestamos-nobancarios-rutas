import { describe, expect, it, vi } from 'vitest';
import { apiClient } from './api-client';
import { paymentHistoryApi } from './payment-history.api';

describe('payment history GET adapter', () => {
  it('sends filters and paging, omits empty values, and reads only historical options', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({});
    try {
      await paymentHistoryApi.list({ startDate: '2026-10-01', endDate: '2026-10-02', search: 'Ana',
        loanNumber: '4548', status: '', paymentMethodId: '', collectorId: '', sortBy: 'paymentDate',
        sortDir: 'desc', page: 2, pageSize: 20 });
      expect(request).toHaveBeenCalledWith(expect.stringContaining('/payments/history?startDate=2026-10-01&endDate=2026-10-02&search=Ana&loanNumber=4548'),
        { cache: 'no-store' });
      expect(request.mock.calls[0][0]).not.toContain('collectorId');
      await paymentHistoryApi.options();
      expect(request).toHaveBeenLastCalledWith('/payments/history/options', { cache: 'no-store' });
    } finally { request.mockRestore(); }
  });
});
