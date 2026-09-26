import type { LoanDetail, LoanListItem } from '../../domain/entities/loan';
import { apiClient } from './api-client';
export type LoanSortBy = 'number' | 'customer' | 'startDate' | 'principal' | 'interest' | 'total' | 'frequency' | 'pending';
export type LoanSortOrder = 'asc' | 'desc';
export type LoanListQuery = { page: number; pageSize: number; search?: string; frequencyId?: string; fromDate?: string; toDate?: string; sortBy?: LoanSortBy; sortOrder?: LoanSortOrder };
export const loanApi = {
  customerOptions(query: { search: string; page: number; pageSize: number }) { const params = new URLSearchParams({ search: query.search, page: String(query.page), pageSize: String(query.pageSize) }); return apiClient.request<{ items: { id: string; identification: string; fullName: string; primaryPhone: string }[]; total: number }>(`/loans/customer-options?${params}`); },
  list(query: LoanListQuery) { const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])); return apiClient.request<{ items: LoanListItem[]; total: number }>(`/loans?${params}`); },
  detail(id: string) { return apiClient.request<LoanDetail>(`/loans/${encodeURIComponent(id)}`); },
  create(input: unknown, idempotencyKey: string) { return apiClient.request<LoanDetail>('/loans', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); },
};
