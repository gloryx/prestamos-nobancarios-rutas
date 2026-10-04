export type RefinancingLoanSearchItem = {
  loanId: string;
  loanNumber: string;
  customer: { id: string; fullName: string; identification: string };
  status: 'ACTIVE';
  startDate: string;
  principal: string;
  interestAmount: string;
  totalAmount: string;
  paidAmount: string;
  financialBalance: string;
};

export type RefinancingPageSize = 10 | 20 | 50;

export type RefinancingLoanSearchResponse = {
  items: RefinancingLoanSearchItem[];
  total: number;
  page: number;
  pageSize: RefinancingPageSize;
};

export type RefinancingListItem = {
  refinancingId: string;
  refinancingDate: string;
  customer: { id: string; fullName: string; identification: string };
  originLoan: { id: string; loanNumber: string };
  newLoan: { id: string; loanNumber: string };
  outstandingPrincipalTransferred: string;
  capitalizedOutstandingInterest: string;
  newMoneyDisbursed: string;
  newContractualPrincipal: string;
  newInterestAmount: string;
  newContractualTotal: string;
};

export type RefinancingListQuery = {
  page: number;
  pageSize: RefinancingPageSize;
  search: string;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type RefinancingListResult = {
  items: RefinancingListItem[];
  page: number;
  pageSize: RefinancingPageSize;
  total: number;
  totalPages: number;
};

export type RefinancingReasonCode =
  | 'LOAN_NOT_ACTIVE'
  | 'FINANCIAL_INTEGRITY_ERROR'
  | 'NO_OUTSTANDING_BALANCE'
  | 'MINIMUM_PAYMENT_NOT_MET';

export type RefinancingEligibility = {
  eligible: boolean;
  minimumRequiredPayment: string;
  remainingToMinimum: string;
  reasonCode: RefinancingReasonCode | null;
  reason: string | null;
  reasons: RefinancingReasonCode[];
};

export type RefinancingPreview = RefinancingEligibility & {
  loanId: string;
  loanNumber: string;
  customer: { id: string; name: string; identification: string };
  status: 'ACTIVE' | 'CANCELLED' | 'REFINANCED' | 'UNCOLLECTIBLE' | 'ANNULLED';
  startDate: string;
  principal: string;
  interestAmount: string;
  totalAmount: string;
  paidAmount: string;
  paidPrincipal: string;
  paidInterest: string;
  outstandingPrincipal: string;
  outstandingInterest: string;
  financialBalance: string;
  pendingPlanAmount: string;
  baseline: string;
};

export type ConfirmRefinancingRequest = {
  originLoanId: string;
  refinancingDate: string;
  newMoney: string;
  disbursementPaymentMethodId?: string;
  newInterestAmount: string;
  paymentFrequencyId: string;
  preferredPaymentMethodId: string;
  observations?: string;
  plan: Array<{ sequence: number; dueDate: string; pendingAmount: string }>;
  baseline: string;
  idempotencyKey: string;
};

export type RefinancingResult = {
  refinancingId: string;
  refinancingDate: string;
  createdAt: string;
  originLoan: { id: string; loanNumber: string; status: 'REFINANCED'; startDate: string };
  newLoan: { id: string; loanNumber: string; status: 'ACTIVE'; startDate: string };
  customer: { id: string; fullName: string; identification: string };
  financialComposition: {
    outstandingPrincipalTransferred: string;
    capitalizedOutstandingInterest: string;
    newMoneyDisbursed: string;
    newContractualPrincipal: string;
    newInterestAmount: string;
    newContractualTotal: string;
  };
  newContract: {
    paymentFrequency: { id: string; name: string; intervalUnit: string; intervalValue: number };
    preferredPaymentMethod: { id: string; name: string };
    disbursementPaymentMethod: { id: string; name: string } | null;
    observations: string | null;
  };
  disbursement: { id: string; cashMovementId: string } | null;
  createdBy: { id: string; fullName: string };
};

export type RefinancingChainCustomer = {
  id: string;
  fullName: string;
  identification: string;
};

export type RefinancingChainLoan = {
  loanId: string;
  loanNumber: string;
  status: string;
  startDate: string;
  principal: string;
  interestAmount: string;
  totalAmount: string;
  paidAmount: string;
  paidPrincipal: string;
  paidInterest: string;
  outstandingPrincipal: string;
  outstandingInterest: string;
  financialBalance: string;
  isRoot: boolean;
  isTerminal: boolean;
};

export type RefinancingChainTransition = {
  refinancingId: string;
  refinancingDate: string;
  originLoanId: string;
  newLoanId: string;
  outstandingPrincipalTransferred: string;
  capitalizedOutstandingInterest: string;
  newMoneyDisbursed: string;
  newContractualPrincipal: string;
  newInterestAmount: string;
  newContractualTotal: string;
};

export type RefinancingChainSummary = {
  loanCount: number;
  refinancingCount: number;
  totalOutstandingPrincipalTransferred: string;
  totalCapitalizedOutstandingInterest: string;
  totalNewMoneyDisbursed: string;
  totalNewInterestContracted: string;
  totalPaymentsReceived: string;
  totalPrincipalApplied: string;
  totalInterestApplied: string;
  rootDisbursedAmount: string | null;
  totalCashActuallyDisbursed: string | null;
};

export type RefinancingChain = {
  rootLoanId: string;
  terminalLoanId: string;
  customer: RefinancingChainCustomer;
  startedAt: string;
  lastRefinancingDate: string | null;
  loans: RefinancingChainLoan[];
  transitions: RefinancingChainTransition[];
  summary: RefinancingChainSummary;
};

export type CustomerRefinancingChains = {
  customer: RefinancingChainCustomer;
  chains: RefinancingChain[];
};
