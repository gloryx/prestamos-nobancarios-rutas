import type { Collector, CollectorPage, EligibleCollectorUser } from '../../domain/entities/collector';
import type { CollectorInput, CollectorListQuery, CollectorRepository, CollectorUpdateInput } from '../../application/ports/collector.repository';
import { apiClient } from './api-client';

export function toCollectorFormData(input: CollectorInput | CollectorUpdateInput): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(input)) if (key !== 'photo' && value !== undefined && value !== null) form.append(key, String(value));
  if (input.photo) form.append('photo', input.photo);
  return form;
}

export class CollectorApi implements CollectorRepository {
  list(query: CollectorListQuery): Promise<CollectorPage> { const params = new URLSearchParams({ search: query.search, status: query.status, page: String(query.page), pageSize: String(query.pageSize) }); return apiClient.request(`/collectors?${params}`); }
  detail(id: string): Promise<Collector> { return apiClient.request(`/collectors/${id}`); }
  create(input: CollectorInput): Promise<Collector> { return apiClient.request('/collectors', { method: 'POST', body: toCollectorFormData(input) }); }
  update(id: string, input: CollectorUpdateInput): Promise<Collector> { return apiClient.request(`/collectors/${id}`, { method: 'PATCH', body: toCollectorFormData(input) }); }
  changeStatus(id: string, isActive: boolean): Promise<Collector> { return apiClient.request(`/collectors/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }); }
  linkUser(id: string, userId: string | null): Promise<Collector> { return apiClient.request(`/collectors/${id}/user`, { method: 'PATCH', body: JSON.stringify({ userId }) }); }
  eligibleUsers() { return apiClient.request<EligibleCollectorUser[]>('/collectors/eligible-users'); }
  photo(id: string): Promise<Blob> { return apiClient.blob(`/collectors/${id}/photo`); }
}
