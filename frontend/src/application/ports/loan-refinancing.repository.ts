import type { ConfirmRefinancingRequest, CustomerRefinancingChains, RefinancingChain, RefinancingListQuery, RefinancingListResult, RefinancingLoanSearchResponse, RefinancingPageSize, RefinancingPreview, RefinancingResult } from '../../domain/entities/loan-refinancing';
import type { CustomerListItem } from '../../domain/entities/customer';
import type { PaymentFrequency } from '../../domain/entities/payment-frequency';
import type { PaymentMethod } from '../../domain/entities/payment-method';

export interface LoanRefinancingLookup {
  search(query: { search: string; page: number; pageSize: RefinancingPageSize }): Promise<RefinancingLoanSearchResponse>;
  preview(loanId: string): Promise<RefinancingPreview>;
}

export interface LoanRefinancingList {
  list(query: RefinancingListQuery): Promise<RefinancingListResult>;
}

export type RefinancingCustomerOption = Pick<CustomerListItem, 'id' | 'fullName' | 'identification'>;

export interface RefinancingCustomerLookup {
  search(query: { search: string; page: number }): Promise<{ items: RefinancingCustomerOption[]; total: number }>;
}

export interface LoanRefinancingOptions {
  load(): Promise<{ frequencies: PaymentFrequency[]; methods: PaymentMethod[] }>;
}

export interface LoanRefinancingOperations {
  confirm(request: ConfirmRefinancingRequest): Promise<RefinancingResult>;
  detail(refinancingId: string): Promise<RefinancingResult>;
}

export interface LoanRefinancingChains {
  byLoan(loanId: string): Promise<RefinancingChain>;
  byCustomer(customerId: string): Promise<CustomerRefinancingChains>;
}
