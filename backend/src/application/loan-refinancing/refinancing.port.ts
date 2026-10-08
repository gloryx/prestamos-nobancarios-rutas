import type { RefinancingSnapshot } from '../../domain/loan-refinancing/refinancing-finance';
import type { LoanFinancialAmounts, ValidPaymentTotals } from '../../domain/loan/loan-financial-integrity';

export type RefinancingAmounts = {
  outstandingPrincipalTransferred: string; capitalizedOutstandingInterest: string; newMoneyDisbursed: string;
  newInterestAmount: string; newContractualPrincipal: string; newContractualTotal: string;
};

export type RefinancingSearchQuery = { search?: string; page: number; pageSize: 10 | 20 | 50 };
export type RefinancingListQuery = RefinancingSearchQuery & {
  customerId?: string; dateFrom?: string; dateTo?: string;
};
export type RefinancingListItem = RefinancingAmounts & {
  refinancingId: string; refinancingDate: string;
  customer: { id: string; fullName: string; identification: string };
  originLoan: { id: string; loanNumber: string };
  newLoan: { id: string; loanNumber: string };
};
export type RefinancingCandidate = {
  loanId: string; loanNumber: string; customer: { id: string; fullName: string; identification: string };
  status: 'ACTIVE'; startDate: string; principal: string; interestAmount: string; totalAmount: string;
  paidAmount: string; financialBalance: string;
};

export type RefinancingChainCustomer = { id: string; fullName: string; identification: string };
export type RefinancingChainLoanRow = LoanFinancialAmounts & ValidPaymentTotals & {
  loanId: string; loanNumber: string; customerId: string; status: string; startDate: string;
  pendingPlanAmount: string; rootDisbursedAmount: string | null;
};
export type RefinancingChainTransitionRow = RefinancingAmounts & {
  refinancingId: string; refinancingDate: string; originLoanId: string; newLoanId: string;
  originCustomerId: string; newCustomerId: string;
};
export type RefinancingChainGraph = {
  customer: RefinancingChainCustomer;
  loans: RefinancingChainLoanRow[];
  transitions: RefinancingChainTransitionRow[];
};
export type RefinancingChainLoan = LoanFinancialAmounts & {
  loanId: string; loanNumber: string; status: string; startDate: string;
  paidAmount: string; paidPrincipal: string; paidInterest: string;
  outstandingPrincipal: string; outstandingInterest: string; financialBalance: string;
  isRoot: boolean; isTerminal: boolean;
};
export type RefinancingChainTransition = RefinancingAmounts & {
  refinancingId: string; refinancingDate: string; originLoanId: string; newLoanId: string;
};
export type RefinancingChain = {
  rootLoanId: string; terminalLoanId: string; customer: RefinancingChainCustomer;
  startedAt: string; lastRefinancingDate: string | null;
  loans: RefinancingChainLoan[]; transitions: RefinancingChainTransition[];
  summary: { loanCount: number; refinancingCount: number;
    totalOutstandingPrincipalTransferred: string; totalCapitalizedOutstandingInterest: string;
    totalNewMoneyDisbursed: string; totalNewInterestContracted: string;
    totalPaymentsReceived: string; totalPrincipalApplied: string; totalInterestApplied: string;
    rootDisbursedAmount: string | null; totalCashActuallyDisbursed: string | null };
};

export type RefinancingOperation = RefinancingAmounts & {
  id: string; originLoanId: string; originLoanNumber: string; newLoanId: string; newLoanNumber: string;
  refinancingDate: string; createdByUserId: string; createdAt: Date;
  originStatus: string; newStatus: string; disbursementId: string | null; cashMovementId: string | null;
  disbursementAmount: string | null; disbursementDate: string | null; disbursementMethodId: string | null;
  cashAmount: string | null; cashDate: string | null; cashMethodId: string | null;
  cashDirection: string | null; cashConcept: string | null;
  originStartDate: string; newStartDate: string;
  customerId: string; customerName: string; customerIdentification: string;
  createdByName: string; observations: string | null;
  paymentFrequencyId: string; paymentFrequencyName: string; intervalUnit: string; intervalValue: number;
  preferredPaymentMethodId: string; preferredPaymentMethodName: string;
  disbursementPaymentMethodName: string | null;
};

export type NewRefinancing = RefinancingAmounts & {
  originLoanId: string; newLoanId: string; refinancingDate: string; createdByUserId: string;
  idempotencyKey: string; idempotencyFingerprint: string;
};

export type HistoricalRefinancingPayments = {
  totals: ValidPaymentTotals; lastValidPaymentDate: string | null; laterPaymentCount: number;
};
export type HistoricalRefinancingPreview = {
  current: RefinancingSnapshot; historicalPayments: HistoricalRefinancingPayments;
};

export interface RefinancingTransaction {
  readonly context?: unknown;
  findByKey(key: string): Promise<{ id: string; fingerprint: string } | undefined>;
  lockOrigin(id: string): Promise<RefinancingSnapshot | undefined>;
  readSnapshot(id: string): Promise<RefinancingSnapshot | undefined>;
  readHistoricalPayments(id: string, throughDate: string): Promise<HistoricalRefinancingPayments>;
  openingDate(): Promise<string | undefined>;
  activeReferences(frequencyId: string, methodIds: string[]): Promise<boolean>;
  insertLoan(input: { customerId: string; refinancingDate: string; paymentFrequencyId: string; preferredPaymentMethodId: string;
    observations: string | null; principal: string; interestAmount: string; totalAmount: string; actorId: string }): Promise<{ id: string; loanNumber: string; createdAt: Date }>;
  insertPlan(loanId: string, plan: Array<{ sequence: number; dueDate: string; pendingAmount: string }>): Promise<void>;
  insertRefinancing(input: NewRefinancing): Promise<string | undefined>;
  transitionOrigin(id: string): Promise<boolean>;
  createStatusHistory(originId: string, newLoan: { id: string; createdAt: Date }, actorId: string, refinancingId: string): Promise<void>;
  disburseNewMoney(input: { refinancingId: string; newLoanId: string; amount: string; date: string; methodId: string; actorId: string }): Promise<void>;
  readOperation(id: string): Promise<RefinancingOperation | undefined>;
}

export interface RefinancingStore {
  list(query: RefinancingListQuery): Promise<{ items: RefinancingListItem[]; total: number }>;
  search(query: RefinancingSearchQuery): Promise<{ items: RefinancingCandidate[]; total: number }>;
  preview(id: string): Promise<RefinancingSnapshot | undefined>;
  previewAt(id: string, throughDate: string): Promise<HistoricalRefinancingPreview | undefined>;
  transaction<T>(work: (tx: RefinancingTransaction) => Promise<T>): Promise<T>;
  detail(id: string): Promise<RefinancingOperation | undefined>;
  chainGraphForLoan(loanId: string): Promise<RefinancingChainGraph | undefined>;
  chainsForCustomer(customerId: string): Promise<RefinancingChainGraph | undefined>;
}
