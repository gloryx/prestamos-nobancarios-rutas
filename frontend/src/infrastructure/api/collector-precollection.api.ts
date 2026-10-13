import type { CollectorPrecollectionRepository, CollectorPrecollectionListQuery,
  CreateCollectorPrecollectionInput } from '../../application/ports/collector-precollection.repository';
import type { CollectorPrecollectionDetail, CollectorPrecollectionPage } from '../../domain/entities/collector-precollection';
import { apiClient } from './api-client';

function queryString(query: CollectorPrecollectionListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export class CollectorPrecollectionApi implements CollectorPrecollectionRepository {
  create(input: CreateCollectorPrecollectionInput): Promise<CollectorPrecollectionDetail> {
    return apiClient.request('/collector-precollections', { method: 'POST', body: JSON.stringify(input) });
  }
  mine(query: CollectorPrecollectionListQuery): Promise<CollectorPrecollectionPage> {
    return apiClient.request(`/collector-precollections/mine${queryString(query)}`);
  }
  list(query: CollectorPrecollectionListQuery): Promise<CollectorPrecollectionPage> {
    return apiClient.request(`/collector-precollections${queryString(query)}`);
  }
  detail(id: string): Promise<CollectorPrecollectionDetail> {
    return apiClient.request(`/collector-precollections/${encodeURIComponent(id)}`);
  }
  cancel(id: string, input: { reason: string; idempotencyKey: string }): Promise<CollectorPrecollectionDetail> {
    return apiClient.request(`/collector-precollections/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify(input) });
  }
}
