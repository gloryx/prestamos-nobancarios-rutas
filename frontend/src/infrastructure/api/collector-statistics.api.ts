import type { CollectorStatistics } from '../../domain/entities/collector-statistics';
import { apiClient } from './api-client';

export const collectorStatisticsApi = {
  load: (year: number, month: number | null, signal?: AbortSignal) => {
    const query = new URLSearchParams({ year: String(year) });
    if (month !== null) query.set('month', String(month));
    return apiClient.request<CollectorStatistics>(`/collectors/statistics?${query}`, { cache: 'no-store', signal });
  },
};
