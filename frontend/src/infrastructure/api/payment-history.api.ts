import type { PaymentHistoryOptions, PaymentHistoryQuery, PaymentHistoryResult } from '../../domain/entities/payment-history';
import { apiClient } from './api-client';

export const paymentHistoryApi = {
  list: (query: PaymentHistoryQuery) => { const params = new URLSearchParams(Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]));
    return apiClient.request<PaymentHistoryResult>(`/payments/history?${params}`, { cache: 'no-store' }); },
  options: () => apiClient.request<PaymentHistoryOptions>('/payments/history/options', { cache: 'no-store' }),
};
