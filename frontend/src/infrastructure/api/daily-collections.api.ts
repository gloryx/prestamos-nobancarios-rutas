import type { DailyCollectionsPage, DailyCollectionsQuery, DailyCollectionsSummary, DailyDueItem, DailyReceivedItem } from '../../domain/entities/daily-collections';
import { apiClient } from './api-client';

const params = (query: DailyCollectionsQuery) => new URLSearchParams(Object.entries(query)
  .filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]));
export const dailyCollectionsApi = {
  summary: (date: string) => apiClient.request<DailyCollectionsSummary>(`/payments/daily-collections/summary?${new URLSearchParams({ date })}`, { cache: 'no-store' }),
  due: (query: DailyCollectionsQuery) => apiClient.request<DailyCollectionsPage<DailyDueItem>>(`/payments/daily-collections/due?${params(query)}`, { cache: 'no-store' }),
  received: (query: DailyCollectionsQuery) => apiClient.request<DailyCollectionsPage<DailyReceivedItem>>(`/payments/daily-collections/received?${params(query)}`, { cache: 'no-store' }),
};
