import type { LoanRefinancingChains, LoanRefinancingList, LoanRefinancingLookup, LoanRefinancingOperations, LoanRefinancingOptions, RefinancingCustomerLookup } from '../../application/ports/loan-refinancing.repository';
import type { CustomerRefinancingChains, RefinancingChain, RefinancingListResult, RefinancingLoanSearchResponse, RefinancingPreview } from '../../domain/entities/loan-refinancing';
import type { RefinancingFailure } from '../../application/use-cases/refinancing-confirmation-controller';
import { apiClient, HttpApiError } from './api-client';
import { PaymentFrequencyApi } from './payment-frequency.api';
import { PaymentMethodApi } from './payment-method.api';
import { CustomerApi } from './customer.api';

export const loanRefinancingApi: LoanRefinancingLookup = {
  search(query): Promise<RefinancingLoanSearchResponse> {
    const params = new URLSearchParams({ search: query.search, page: String(query.page), pageSize: String(query.pageSize) });
    return apiClient.request(`/loan-refinancings/loans?${params}`, { cache: 'no-store' });
  },
  preview(loanId, refinancingDate): Promise<RefinancingPreview> {
    const query = refinancingDate ? `?${new URLSearchParams({ refinancingDate })}` : '';
    return apiClient.request(`/loan-refinancings/loans/${encodeURIComponent(loanId)}/preview${query}`, { cache: 'no-store' });
  },
};

export const loanRefinancingListApi: LoanRefinancingList = {
  list(query): Promise<RefinancingListResult> {
    const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), search: query.search });
    if (query.customerId) params.set('customerId', query.customerId);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
    return apiClient.request(`/loan-refinancings?${params}`, { cache: 'no-store' });
  },
};

export const loanRefinancingChainsApi: LoanRefinancingChains = {
  byLoan(loanId): Promise<RefinancingChain> {
    return apiClient.request(`/loan-refinancings/loans/${encodeURIComponent(loanId)}/chain`, { cache: 'no-store' });
  },
  byCustomer(customerId): Promise<CustomerRefinancingChains> {
    return apiClient.request(`/loan-refinancings/customers/${encodeURIComponent(customerId)}/chains`, { cache: 'no-store' });
  },
};

export const refinancingCustomerLookup: RefinancingCustomerLookup = {
  async search(query) {
    const { items, total } = await new CustomerApi().list({ search: query.search, status: 'ALL',
      page: query.page, pageSize: 10 });
    return { items: items.map(({ id, fullName, identification }) => ({ id, fullName, identification })), total };
  },
};

export const loanRefinancingOptions: LoanRefinancingOptions = {
  async load() {
    const [frequencies, methods] = await Promise.all([new PaymentFrequencyApi().list(), new PaymentMethodApi().list()]);
    return { frequencies: frequencies.filter((item) => item.isActive), methods: methods.filter((item) => item.isActive) };
  },
};

export const loanRefinancingOperations: LoanRefinancingOperations = {
  confirm(request) {
    return apiClient.request('/loan-refinancings', { method: 'POST', body: JSON.stringify(request) });
  },
  detail(refinancingId) {
    return apiClient.request(`/loan-refinancings/${encodeURIComponent(refinancingId)}`, { cache: 'no-store' });
  },
};

export function classifyRefinancingFailure(error: unknown): RefinancingFailure {
  if (error instanceof HttpApiError) {
    if (error.status === 409) {
      if (error.reasonCode === 'STALE_DATA' || error.reasonCode === 'ALREADY_REFINANCED' ||
        error.reasonCode === 'IDEMPOTENCY_CONFLICT' || error.reasonCode === 'CONCURRENT_REFINANCING' ||
        error.reasonCode === 'HISTORICAL_BALANCE_CONFLICT') return error.reasonCode;
      return 'CONFLICT';
    }
    if (error.status === 400) return 'INVALID';
    if (error.status === 403) return 'FORBIDDEN';
    if (error.status === 404) return 'NOT_FOUND';
    return 'SERVER';
  }
  return error instanceof TypeError ? 'NETWORK' : 'SERVER';
}
