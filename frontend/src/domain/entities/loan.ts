import type { CustomerCreated } from './customer';

export type LoanPlanEntry = { sequence: number; dueDate: string; pendingAmount: string };
export type LoanListItem = { id: string; loanNumber: string; startDate: string; principal: string; interestAmount: string; totalAmount: string; customerName: string; identification: string; frequencyName: string; pendingTotal: string };
export type ActiveLoanListItem = LoanListItem & { isOverdue: boolean; primaryPhone?: string; nextDueDate?: string | null; nextDueAmount?: string | null };
export type AssignedLoanStatus = 'ACTIVE' | 'CANCELLED' | 'REFINANCED' | 'UNCOLLECTIBLE' | 'ANNULLED';
export type AssignedLoanListItem = ActiveLoanListItem & { status: AssignedLoanStatus; primaryPhone: string; nextDueDate: string | null; nextDueAmount: string | null };
export type ActiveLoanExportItem = {
  loanNumber: string; identification: string; customerName: string; phone: string; startDate: string;
  principal: string; interestAmount: string; totalAmount: string; outstandingPrincipal: string;
  outstandingInterest: string; financialBalance: string; frequencyName: string; dueDate: string; status: 'ACTIVE';
};
export type ActiveLoanSummary = { totalActiveLoans: number; capitalPlaced: string; outstandingPrincipal: string;
  outstandingInterest: string; financialBalance: string };
export type ActiveLoanExport = { items: ActiveLoanExportItem[]; summary: ActiveLoanSummary };
export type LoanDetail = LoanListItem & { status: string; customerId: string; intervalUnit: 'DAY' | 'WEEK' | 'DAY/15' | 'MONTH'; intervalValue: number; preferredPaymentMethod: string; disbursementPaymentMethod: string; createdByName: string; observations?: string | null; updatedAt: string; plan: LoanPlanEntry[] };
export type LoanOperationalDetail = Omit<LoanDetail, 'plan'> & { plan: Array<LoanPlanEntry & { id: string }>; financialBalance: string; validPayments: Array<{ id: string; paymentDate: string; amount: string; status: 'VALID' }> };
export type LoanEditBaseline = { interestAmount: string; paymentFrequencyId: string; preferredPaymentMethodId: string; observations: string | null; financialBalance: string; plan: Array<{ id: string; dueDate: string; pendingAmount: string }> };
export type LoanEditContext = {
  loan: { id: string; loanNumber: string; customer: { id: string; identification: string; fullName: string }; status: string; principal: string; interestAmount: string; totalAmount: string; startDate: string; paymentFrequencyId: string; paymentFrequencyName: string; preferredPaymentMethodId: string; preferredPaymentMethodName: string; observations: string | null };
  baseline: LoanEditBaseline;
  paymentFrequencyOptions: Array<{ id: string; name: string; active: boolean; intervalUnit: 'DAY' | 'WEEK' | 'DAY/15' | 'MONTH'; intervalValue: number }>;
  preferredPaymentMethodOptions: Array<{ id: string; name: string; active: boolean }>;
  protectedPlanEntryIds: string[];
};
export type LoanEditChanges = { interestAmount?: string; paymentFrequencyId?: string; preferredPaymentMethodId?: string; observations?: string | null };
export type LoanEditBody = { idempotencyKey: string; baseline: LoanEditBaseline; changes: LoanEditChanges; plan?: Array<{ id: string | null; dueDate: string; pendingAmount: string }> };
export type LoanEditReceipt = { operationId: string; loanId: string; createdAt: string };
export type CancelledLoan = { id: string; loanNumber: string; customerName: string; identification: string; startDate: string; cancelledDate: string | null; principal: string; recoveredInterest: string; totalRecovered: string };
export type CancelledLoansResult = { items: CancelledLoan[]; total: number; page: number; pageSize: number; summary: { cancelledLoansCount: number; recoveredAmount: string; realizedProfit: string } };

export type LoanManagementTab = 'OVERDUE' | 'UNCOLLECTIBLE';
export type LoanManagementPageSize = 10 | 20 | 50;
export type LoanManagementSortDir = 'asc' | 'desc';
export type OverdueLoanSort = 'loanNumber' | 'customer' | 'startDate' | 'firstOverdueDueDate' | 'principal' | 'recoveredAmount' | 'financialBalance';
export type UncollectibleLoanSort = 'loanNumber' | 'customer' | 'startDate' | 'uncollectibleDate' | 'principal' | 'recoveredAmount' | 'financialBalance';
export type LoanManagementQuery<Sort extends string> = { search?: string; startDate?: string; endDate?: string; page?: number; pageSize?: LoanManagementPageSize; sortBy?: Sort; sortDir?: LoanManagementSortDir };
export type LoanManagementCustomer = Pick<CustomerCreated, 'id' | 'identification' | 'fullName'>;
export type LoanMoneyAmount = LoanListItem['principal'];
export type LoanManagementRow = Pick<LoanListItem, 'loanNumber' | 'startDate' | 'principal' | 'interestAmount' | 'totalAmount'> & {
  loanId: string; customer: LoanManagementCustomer; recoveredAmount: LoanMoneyAmount; financialBalance: LoanMoneyAmount;
};
export type OverdueLoan = LoanManagementRow & { firstOverdueDueDate: string; firstOverdueAmount: LoanMoneyAmount; status: 'ACTIVE'; canMarkUncollectible: true };
export type UncollectibleLoan = LoanManagementRow & { uncollectibleAt: string; uncollectibleBusinessDate: string; uncollectibleReason: string | null; changedByUserId: string | null; status: 'UNCOLLECTIBLE' };
export type LoanManagementSummary = { total: number; lentAmount: LoanMoneyAmount; recoveredAmount: LoanMoneyAmount; pendingAmount: LoanMoneyAmount };
export type LoanManagementResult<Row extends LoanManagementRow> = { items: Row[]; total: number; page: number; pageSize: LoanManagementPageSize; summary: LoanManagementSummary };
export type LoanTransitionBody = { reason: string; idempotencyKey: string };
export type LoanTransitionReply<Status extends 'ACTIVE' | 'UNCOLLECTIBLE'> = { loanId: string; status: Status; event: { id: string; sequence: number; changedAt: string } };

export type AnnulmentSummary = { total: number; capital: string; interest: string; contractualTotal: string };
export type AnnulmentCustomer = { id: string; identification: string; fullName: string };
export type AnnullableLoanItem = {
  loanId: string; loanNumber: string; customer: AnnulmentCustomer; startDate: string;
  principal: string; interestAmount: string; totalAmount: string; status: 'ACTIVE';
  disbursement: { id: string; amount: string; date: string };
};
export type AnnulledLoanItem = Omit<AnnullableLoanItem, 'status'> & {
  status: 'ANNULLED'; annulledAt: string; annulledBusinessDate: string; reason: string;
  actorId: string; disbursementResolution: 'NOT_DELIVERED' | 'RETURNED_IN_FULL';
};
export type AnnulmentSort = 'loanNumber' | 'customer' | 'startDate' | 'principal' | 'interest' | 'contractualTotal' | 'annulledDate';
export type AnnulmentQuery<Sort extends AnnulmentSort> = LoanManagementQuery<Sort>;
export type AnnulmentResult<Row extends AnnullableLoanItem | AnnulledLoanItem> = {
  items: Row[]; total: number; page: number; pageSize: LoanManagementPageSize; summary: AnnulmentSummary;
};
export type LoanAnnulmentBody = { reason: string; disbursementResolution: AnnulledLoanItem['disbursementResolution']; idempotencyKey: string };
export type LoanAnnulmentReceipt = { loanId: string; status: 'ANNULLED'; annulledAt: string; annulledBusinessDate: string;
  reason: string; disbursementResolution: AnnulledLoanItem['disbursementResolution'] };
