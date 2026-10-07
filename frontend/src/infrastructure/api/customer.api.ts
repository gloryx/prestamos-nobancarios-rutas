import type { CustomerCreated, CustomerDetail, CustomerExportItem, CustomerForm, CustomerListItem, CustomerSummary } from '../../domain/entities/customer';
import type { AssignedCollector, AssignedCustomerQuery, AssignedCustomerResult, CustomerSite, SiteAuthorization, SiteUpdateScope } from '../../domain/entities/customer-site';
import type { CustomerFinancialAnalysis } from '../../domain/entities/customer-financial-analysis';
import type { CustomerRepository, CustomerStatusFilter, CustomerListSort, CustomerSummaryQuery } from '../../application/ports/customer.repository';
import { normalizeCustomerForm } from '../../application/use-cases/customer-normalization';
import { apiClient } from './api-client';

export const buildCustomerFormData = (input: Partial<CustomerForm>): FormData => {
  const normalized = normalizeCustomerForm(input);
  const data = new FormData();
  const values: Record<string, unknown> = {
    identificationType: normalized.identificationType,
    identification: normalized.identificationType === 'NATIONAL' ? (normalized.identification ?? '').replace(/-/g, '') : normalized.identification,
    firstName: normalized.firstName,
    middleName: normalized.middleName,
    firstLastName: normalized.firstLastName,
    secondLastName: normalized.secondLastName,
    gender: normalized.gender,
    birthDate: normalized.birthDate,
    primaryPhone: normalized.primaryPhone,
    secondaryPhone: normalized.secondaryPhone,
    email: normalized.email,
    nationality: normalized.nationality,
    otherNationality: normalized.otherNationality,
    districtCode: normalized.districtCode,
    exactAddress: normalized.exactAddress,
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    observations: normalized.observations,
  };
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && typeof value !== 'object') data.append(key, String(value));
  });
  if (normalized.identificationFront) data.append('identificationFront', normalized.identificationFront);
  if (normalized.propertyPhoto) data.append('propertyPhoto', normalized.propertyPhoto);
  return data;
};

export class CustomerApi implements CustomerRepository {
  private request<T>(path: string, options?: RequestInit): Promise<T> { return apiClient.request<T>(path, options); }
  async create(input: CustomerForm): Promise<CustomerCreated> { return this.request('/customers', { method: 'POST', body: buildCustomerFormData(input) }); }
  async list(query: { search: string; status: CustomerStatusFilter; page: number; pageSize: number } & CustomerListSort) { const params = new URLSearchParams({ search: query.search, status: query.status, page: String(query.page), pageSize: String(query.pageSize) }); if (query.sortBy) params.set('sortBy', query.sortBy); if (query.sortOrder) params.set('sortOrder', query.sortOrder); return this.request<{ items: CustomerListItem[]; total: number; page: number; pageSize: number; totalPages: number }>(`/customers?${params}`); }
  async exportAll(): Promise<CustomerExportItem[]> { return this.request('/customers/export', { cache: 'no-store' }); }
  async assigned(query: AssignedCustomerQuery): Promise<AssignedCustomerResult> { const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) }); if (query.search?.trim()) params.set('search', query.search.trim()); if (query.routeId) params.set('routeId', query.routeId); return this.request(`/customers/assigned?${params}`); }
  async summary(query: CustomerSummaryQuery): Promise<CustomerSummary> { return this.request(`/customers/summary?${new URLSearchParams(query)}`); }
  async detail(id: string): Promise<CustomerDetail> { return this.request(`/customers/${encodeURIComponent(id)}`); }
  async financialAnalysis(id: string, asOf: string): Promise<CustomerFinancialAnalysis> {
    const query = new URLSearchParams({ asOf });
    return this.request(`/customers/${encodeURIComponent(id)}/financial-analysis?${query}`, { cache: 'no-store' });
  }
  async update(id: string, input: Partial<CustomerForm>): Promise<CustomerDetail> { return this.request(`/customers/${encodeURIComponent(id)}`, { method: 'PATCH', body: buildCustomerFormData(input) }); }
  async site(id: string): Promise<CustomerSite> { return this.request(`/customers/${encodeURIComponent(id)}/site`); }
  async sitePhoto(id: string): Promise<Blob> { return apiClient.blob(`/customers/${encodeURIComponent(id)}/site-photo`); }
  async assignedCollectors(id: string): Promise<AssignedCollector[]> { return this.request(`/customers/${encodeURIComponent(id)}/site-assigned-collectors`); }
  async updateSite(id: string, input: { latitude?: number; longitude?: number; propertyPhoto?: File }): Promise<CustomerSite> {
    const data = new FormData();
    if (input.latitude !== undefined) data.append('latitude', String(input.latitude));
    if (input.longitude !== undefined) data.append('longitude', String(input.longitude));
    if (input.propertyPhoto) data.append('propertyPhoto', input.propertyPhoto);
    return this.request(`/customers/${encodeURIComponent(id)}/site`, { method: 'PATCH', body: data });
  }
  async listAuthorizations(id: string): Promise<SiteAuthorization[]> { return this.request(`/customers/${encodeURIComponent(id)}/site-update-authorizations`); }
  async authorizeSiteUpdate(id: string, input: { collectorUserId: string; scope: SiteUpdateScope; reason: string; expiresAt: string }): Promise<SiteAuthorization> { return this.request(`/customers/${encodeURIComponent(id)}/site-update-authorizations`, { method: 'POST', body: JSON.stringify(input) }); }
  async revokeSiteAuthorization(id: string, authorizationId: string): Promise<void> { return this.request(`/customers/${encodeURIComponent(id)}/site-update-authorizations/${encodeURIComponent(authorizationId)}/revoke`, { method: 'PATCH' }); }
  async changeStatus(id: string, isActive: boolean): Promise<CustomerCreated> { return this.request(`/customers/${encodeURIComponent(id)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive }) }); }
  async file(id: string, kind: 'identification' | 'property'): Promise<Blob> { return apiClient.blob(`/customers/${encodeURIComponent(id)}/files/${kind}`); }
}
