import type { PaymentCollectorReportFilters, PaymentCollectorReportResult } from '../../domain/entities/payment-collector-report';
import { apiClient } from './api-client';

export const paymentCollectorReportApi = {
  load: (filters: PaymentCollectorReportFilters, signal?: AbortSignal) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ''));
    return apiClient.request<PaymentCollectorReportResult>(`/payments/collector-report?${params}`, { cache: 'no-store', signal });
  },
};
