import { apiClient } from './api-client';
import type { PaymentAnnulmentBody, PaymentContext, PaymentLoanPage, PlanBaseline } from '../../domain/entities/payment';
export type { PaymentAnnulmentType, PaymentContext, PaymentLoan, PaymentLoanPage, PendingPaymentEntry, PlanBaseline, ValidPayment } from '../../domain/entities/payment';
export const paymentApi = {
  listLoans: (search = '', page = 1, pageSize = 20) => apiClient.request<PaymentLoanPage>(`/payments/loans?search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}`, { cache: 'no-store' }),
  context: (loanId: string) => apiClient.request<PaymentContext>(`/payments/loans/${loanId}`),
  create: (body: { loanId: string; amount: string; paymentDate: string; methodId: string; collectorId: string; idempotencyKey: string }) => apiClient.request('/payments', { method: 'POST', body: JSON.stringify(body) }),
  annul: (paymentId: string, body: PaymentAnnulmentBody) => apiClient.request(`/payments/${paymentId}/annul`, { method: 'POST', body: JSON.stringify(body) }),
  customizePlan: (loanId: string, base: PlanBaseline, entries: Array<{ id: string | null; dueDate: string; pendingAmount: string }>, idempotencyKey: string) => apiClient.request(`/payments/loans/${loanId}/plan`, { method: 'PUT', body: JSON.stringify({ base, entries, idempotencyKey }) }),
};
