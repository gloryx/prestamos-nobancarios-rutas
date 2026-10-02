import type { ActiveLoanListItem, CancelledLoansResult, LoanDetail, LoanEditBody, LoanEditContext, LoanEditReceipt, LoanManagementQuery, LoanManagementResult, LoanManagementSortDir, LoanOperationalDetail, LoanTransitionBody, LoanTransitionReply, OverdueLoan, OverdueLoanSort, UncollectibleLoan, UncollectibleLoanSort } from '../../domain/entities/loan';
import type { CancelledLoansQuery } from '../../application/use-cases/cancelled-loans';
import { apiClient } from './api-client';
export type LoanSortBy = 'number' | 'customer' | 'startDate' | 'principal' | 'interest' | 'total' | 'frequency' | 'pending' | 'condition';
export type LoanSortOrder = 'asc' | 'desc';
export type LoanListQuery = { page: number; pageSize: number; search?: string; frequencyId?: string; fromDate?: string; toDate?: string; sortBy?: LoanSortBy; sortOrder?: LoanSortOrder };
const managementParams = <Sort extends string>(query: LoanManagementQuery<Sort>, sortBy: Sort, sortDir: LoanManagementSortDir) =>
  new URLSearchParams(Object.entries({ ...query, page: query.page ?? 1, pageSize: query.pageSize ?? 20, sortBy: query.sortBy ?? sortBy, sortDir: query.sortDir ?? sortDir })
    .filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]));
export const loanApi = {
  customerOptions(query: { search: string; page: number; pageSize: number }) { const params = new URLSearchParams({ search: query.search, page: String(query.page), pageSize: String(query.pageSize) }); return apiClient.request<{ items: { id: string; identification: string; fullName: string; primaryPhone: string }[]; total: number }>(`/loans/customer-options?${params}`); },
  list(query: LoanListQuery) { const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])); return apiClient.request<{ items: ActiveLoanListItem[]; total: number }>(`/loans?${params}`); },
  cancelled(query: CancelledLoansQuery) { const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])); return apiClient.request<CancelledLoansResult>(`/loans/cancelled?${params}`); },
  getOverdueLoans(query: LoanManagementQuery<OverdueLoanSort> = {}) { return apiClient.request<LoanManagementResult<OverdueLoan>>(`/loans/overdue?${managementParams(query, 'firstOverdueDueDate', 'asc')}`, { cache: 'no-store' }); },
  getUncollectibleLoans(query: LoanManagementQuery<UncollectibleLoanSort> = {}) { return apiClient.request<LoanManagementResult<UncollectibleLoan>>(`/loans/uncollectible?${managementParams(query, 'uncollectibleDate', 'desc')}`, { cache: 'no-store' }); },
  markLoanUncollectible(id: string, body: LoanTransitionBody) { return apiClient.request<LoanTransitionReply<'UNCOLLECTIBLE'>>(`/loans/${encodeURIComponent(id)}/uncollectible`, { method: 'POST', body: JSON.stringify({ reason: body.reason, idempotencyKey: body.idempotencyKey }) }); },
  reactivateLoan(id: string, body: LoanTransitionBody) { return apiClient.request<LoanTransitionReply<'ACTIVE'>>(`/loans/${encodeURIComponent(id)}/reactivate`, { method: 'POST', body: JSON.stringify({ reason: body.reason, idempotencyKey: body.idempotencyKey }) }); },
  detail(id: string) { return apiClient.request<LoanOperationalDetail>(`/loans/${encodeURIComponent(id)}`); },
  editContext(id: string) { return apiClient.request<LoanEditContext>(`/loans/${encodeURIComponent(id)}/edit-context`, { cache: 'no-store' }); },
  edit(id: string, body: LoanEditBody) { return apiClient.request<LoanEditReceipt>(`/loans/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }); },
  create(input: unknown, idempotencyKey: string) { return apiClient.request<LoanDetail>('/loans', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); },
};
