export type LoanStatus = 'ACTIVE' | 'CANCELLED' | 'REFINANCED' | 'UNCOLLECTIBLE' | 'ANNULLED';
export type IntervalUnit = 'DAY' | 'WEEK' | 'DAY/15' | 'MONTH';
export type LoanSortBy = 'number' | 'customer' | 'startDate' | 'principal' | 'interest' | 'total' | 'frequency' | 'pending';
export type LoanSortOrder = 'asc' | 'desc';
export type ActiveLoanListQuery = { page: number; pageSize: number; search?: string; frequencyId?: string; fromDate?: string; toDate?: string; sortBy?: LoanSortBy; sortOrder?: LoanSortOrder };
export type LoanPlanEntryInput = { sequence: number; dueDate: string; pendingAmount: string };
export type CreateLoanInput = {
  customerId: string;
  paymentFrequencyId: string;
  preferredPaymentMethodId: string;
  disbursementPaymentMethodId: string;
  startDate: string;
  principal: string;
  interestAmount: string;
  observations?: string;
  plan: LoanPlanEntryInput[];
  idempotencyKey?: string;
};
