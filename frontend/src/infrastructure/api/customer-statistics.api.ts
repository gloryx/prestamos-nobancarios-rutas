import type { CustomerStatistics } from '../../domain/entities/customer-statistics';
import { apiClient } from './api-client';

export const customerStatisticsApi = {
  load: (year: number) => apiClient.request<CustomerStatistics>(
    `/customers/statistics?${new URLSearchParams({ year: String(year) })}`, { cache: 'no-store' },
  ),
};
