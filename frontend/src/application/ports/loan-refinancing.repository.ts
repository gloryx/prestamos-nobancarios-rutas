import type { AnnulRefinancingRequest, ConfirmRefinancingRequest, CustomerRefinancingChains, RefinancingAnnulledSort, RefinancingAnnulmentCandidate, RefinancingAnnulmentCandidateSort, RefinancingAnnulmentDetail, RefinancingAnnulmentPaymentMethod, RefinancingAnnulmentQuery, RefinancingAnnulmentResult, RefinancingChain, RefinancingListQuery, RefinancingListResult, RefinancingLoanSearchResponse, RefinancingPageSize, RefinancingPreview, RefinancingResult } from '../../domain/entities/loan-refinancing';
import type { CustomerListItem } from '../../domain/entities/customer';
import type { PaymentFrequency } from '../../domain/entities/payment-frequency';
import type { PaymentMethod } from '../../domain/entities/payment-method';

export interface LoanRefinancingPreviewLookup {
  preview(loanId: string, refinancingDate?: string): Promise<RefinancingPreview>;
}

export interface LoanRefinancingLookup extends LoanRefinancingPreviewLookup {
  search(query: { search: string; page: number; pageSize: RefinancingPageSize }): Promise<RefinancingLoanSearchResponse>;
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

export interface LoanRefinancingAnnulments {
  listCandidates(query: RefinancingAnnulmentQuery<RefinancingAnnulmentCandidateSort>): Promise<RefinancingAnnulmentResult<RefinancingAnnulmentCandidate>>;
  listAnnulled(query: RefinancingAnnulmentQuery<RefinancingAnnulledSort>): Promise<RefinancingAnnulmentResult<RefinancingAnnulmentDetail>>;
  detail(annulmentId: string): Promise<RefinancingAnnulmentDetail>;
  paymentMethods(): Promise<RefinancingAnnulmentPaymentMethod[]>;
  annul(refinancingId: string, request: AnnulRefinancingRequest): Promise<RefinancingAnnulmentDetail>;
}
