import { describe, expect, it, vi } from 'vitest';
import { apiClient } from './api-client';
import { paymentCollectorReportApi } from './payment-collector-report.api';

describe('payment collector report API', () => {
  it('sends inclusive dates and selected filters while omitting empty values', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({});
    const signal = new AbortController().signal;
    try {
      await paymentCollectorReportApi.load({ fromDate: '2026-10-01', toDate: '2026-10-31', collectorId: '', paymentMethodId: 'method-1' }, signal);
      expect(request).toHaveBeenCalledWith('/payments/collector-report?fromDate=2026-10-01&toDate=2026-10-31&paymentMethodId=method-1',
        { cache: 'no-store', signal });
    } finally { request.mockRestore(); }
  });
});
