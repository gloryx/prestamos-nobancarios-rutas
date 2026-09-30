import type { CustomerCreated } from './customer';

export type LoanPlanEntry = { sequence: number; dueDate: string; pendingAmount: string };
export type LoanListItem = { id: string; loanNumber: string; startDate: string; principal: string; interestAmount: string; totalAmount: string; customerName: string; identification: string; frequencyName: string; pendingTotal: string };
export type ActiveLoanListItem = LoanListItem & { isOverdue: boolean };
export type LoanDetail = LoanListItem & { status: string; customerId: string; intervalUnit: 'DAY' | 'WEEK' | 'DAY/15' | 'MONTH'; intervalValue: number; preferredPaymentMethod: string; disbursementPaymentMethod: string; createdByName: string; observations?: string | null; updatedAt: string; plan: LoanPlanEntry[] };
export type LoanOperationalDetail = Omit<LoanDetail, 'plan'> & { plan: Array<LoanPlanEntry & { id: string }>; financialBalance: string; validPayments: Array<{ id: string; paymentDate: string; amount: string; status: 'VALID' }> };
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
