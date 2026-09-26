import { apiClient } from './api-client';
export type PaymentLoan = { id: string; loanNumber: string; customerName: string; financialBalance: string };
export type PaymentContext = { summary: { loanId: string; loanNumber: string; totalAmount: string }; balances: { financialBalance: string; outstandingPrincipal: string }; combinedPlan: Array<{ id: string; dueDate: string; pendingAmount: string }>; payments: Array<{ id: string; amount: string; paymentDate: string; status: string }> };
export const paymentApi = {
  listLoans: (search = '', page = 1, pageSize = 20) => apiClient.request<{ items: PaymentLoan[] }>(`/payments/loans?search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}`),
  context: (loanId: string) => apiClient.request<PaymentContext>(`/payments/loans/${loanId}`),
  create: (body: { loanId: string; amount: string; paymentDate: string; methodId: string; collectorId?: string; idempotencyKey: string }) => apiClient.request('/payments', { method: 'POST', body: JSON.stringify(body) }),
  annul: (paymentId: string, body: { reason: string; idempotencyKey: string }) => apiClient.request(`/payments/${paymentId}/annul`, { method: 'POST', body: JSON.stringify(body) }),
  customizePlan: (loanId: string, entries: Array<{ dueDate: string; pendingAmount: string }>, idempotencyKey: string) => apiClient.request(`/payments/loans/${loanId}/plan`, { method: 'PUT', body: JSON.stringify({ entries, idempotencyKey }) }),
};
