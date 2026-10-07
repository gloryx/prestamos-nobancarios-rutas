import type { CustomerAgendaFilters, CustomerAgendaResult } from '../../domain/entities/customer-agenda';
import { apiClient } from './api-client';

export const customerAgendaApi = {
  load(filters: CustomerAgendaFilters, signal?: AbortSignal): Promise<CustomerAgendaResult> {
    const values = {
      search: filters.search.trim(), collectorId: filters.collectorId, routeId: filters.routeId,
      provinceCode: filters.provinceCode, cantonCode: filters.cantonCode, districtCode: filters.districtCode,
      assignmentStatus: filters.assignmentStatus, page: String(filters.page), pageSize: String(filters.pageSize),
    };
    const params = new URLSearchParams(Object.entries(values).filter(([, value]) => value !== ''));
    return apiClient.request<CustomerAgendaResult>(`/customers/agenda?${params}`, { cache: 'no-store', signal });
  },
};
