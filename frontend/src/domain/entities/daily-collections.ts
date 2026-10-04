export type DailyCollectionsSummary = { date: string; dueCount: number; paidLoansCount: number; dueAmount: string; receivedAmount: string };
export type DailyCollectionLoan = { id: string; loanNumber: string };
export type DailyCollectionCustomer = { id: string; identification: string; fullName: string };
export type DailyDueItem = { planEntryId: string; sequence: number; dueDate: string; pendingAmount: string;
  loan: DailyCollectionLoan; customer: DailyCollectionCustomer & { primaryPhone: string } };
export type DailyReceivedItem = { paymentId: string; paymentDate: string; amount: string; loan: DailyCollectionLoan;
  customer: DailyCollectionCustomer; paymentMethod: { id: string; name: string }; collector: { id: string; name: string } | null };
export type DailyCollectionsPage<Item> = { items: Item[]; total: number; page: number; pageSize: number };
export type DailyCollectionsQuery = { date: string; search?: string; page: number; pageSize: number; sortBy?: string; sortDir?: 'asc' | 'desc' };
