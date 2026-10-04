import { apiClient } from './api-client';
export type PaymentLoan = { id: string; loanNumber: string; identification: string; customerName: string; financialBalance: string; isOverdue: boolean };
export type PaymentLoanPage = { items: PaymentLoan[]; total: number; page: number; pageSize: number };
export type ValidPayment = { id: string; amount: string; paymentDate: string; status: 'VALID' };
export type PendingPaymentEntry = { id: string; dueDate: string; sequence: number; pendingAmount: string };
export type PlanBaseline = Readonly<{ financialBalance: string; entries: ReadonlyArray<Readonly<Pick<PendingPaymentEntry, 'id' | 'dueDate' | 'pendingAmount'>>> }>;
export type PaymentContext = {
  summary: { loanId: string; loanNumber: string; identification: string; customerName: string; totalAmount: string; interestAmount: string };
  balances: { financialBalance: string; outstandingPrincipal: string; outstandingInterest: string };
  combinedPlan: PendingPaymentEntry[]; validPayments: ValidPayment[]; firstOperationalRow: PendingPaymentEntry | null;
  lastValidPayment: ValidPayment | null; refinanceEligibility: boolean;
  preferredMethod: { id: string | null; activeMethods: Array<{ id: string; name: string }>; collectors: Array<{ id: string; name: string }> };
};
export const paymentApi = {
  listLoans: (search = '', page = 1, pageSize = 20) => apiClient.request<PaymentLoanPage>(`/payments/loans?search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}`, { cache: 'no-store' }),
  context: (loanId: string) => apiClient.request<PaymentContext>(`/payments/loans/${loanId}`),
  create: (body: { loanId: string; amount: string; paymentDate: string; methodId: string; collectorId: string; idempotencyKey: string }) => apiClient.request('/payments', { method: 'POST', body: JSON.stringify(body) }),
  annul: (paymentId: string, body: { reason: string; idempotencyKey: string }) => apiClient.request(`/payments/${paymentId}/annul`, { method: 'POST', body: JSON.stringify(body) }),
  customizePlan: (loanId: string, base: PlanBaseline, entries: Array<{ id: string | null; dueDate: string; pendingAmount: string }>, idempotencyKey: string) => apiClient.request(`/payments/loans/${loanId}/plan`, { method: 'PUT', body: JSON.stringify({ base, entries, idempotencyKey }) }),
};
