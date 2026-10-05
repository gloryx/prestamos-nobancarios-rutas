import type { CollectionAgendaFilters, CollectionAgendaResult } from '../../domain/entities/collection-agenda';
import { apiClient } from './api-client';

export const collectionAgendaApi = {
  load: (filters: CollectionAgendaFilters, signal?: AbortSignal) => {
    const values = {
      referenceDate: filters.referenceDate,
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      collectorId: filters.collectorId,
      routeId: filters.routeId,
      collectionStatus: filters.collectionStatus,
      search: filters.search.trim(),
      page: String(filters.page),
      pageSize: String(filters.pageSize),
    };
    const params = new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '' && value !== 'ALL'));
    return apiClient.request<CollectionAgendaResult>(`/payments/collection-agenda?${params}`, { cache: 'no-store', signal });
  },
};
