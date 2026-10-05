export type LoanStatus = 'ACTIVE' | 'CANCELLED' | 'REFINANCED' | 'UNCOLLECTIBLE' | 'ANNULLED';
export type PaymentLoan = { id: string; loanNumber: string; identification: string; customerName: string; financialBalance: string; isOverdue: boolean };
export type PaymentLoanPage = { items: PaymentLoan[]; total: number; page: number; pageSize: number };
export type ValidPayment = { id: string; amount: string; paymentDate: string; status: 'VALID' };
export type PendingPaymentEntry = { id: string; dueDate: string; sequence: number; pendingAmount: string };
export type PlanBaseline = Readonly<{ financialBalance: string; entries: ReadonlyArray<Readonly<Pick<PendingPaymentEntry, 'id' | 'dueDate' | 'pendingAmount'>>> }>;
export type PaymentContext = {
  summary: { loanId: string; loanNumber: string; status: LoanStatus; identification: string; customerName: string; totalAmount: string; principal: string; interestAmount: string };
  balances: { financialBalance: string; outstandingPrincipal: string; outstandingInterest: string };
  combinedPlan: PendingPaymentEntry[];
  validPayments: ValidPayment[];
  firstOperationalRow: PendingPaymentEntry | null;
  lastValidPayment: ValidPayment | null;
  refinanceEligibility: boolean;
  preferredMethod: { id: string | null; activeMethods: Array<{ id: string; name: string }>; collectors: Array<{ id: string; name: string }> };
};
