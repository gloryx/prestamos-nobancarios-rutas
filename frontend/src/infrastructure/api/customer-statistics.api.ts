import type { CustomerStatistics } from '../../domain/entities/customer-statistics';
import { apiClient } from './api-client';

export const customerStatisticsApi = {
  load: (year: number, limit: number) => apiClient.request<CustomerStatistics>(
    `/customers/statistics?${new URLSearchParams({ year: String(year), limit: String(limit) })}`, { cache: 'no-store' },
  ),
};
