import { paymentApi, type PaymentContext } from '../../infrastructure/api/payment.api';
import { loanIdFromSearch } from './loan-id-query';

export function paymentLoanIdFromSearch(search: string): { id: string | null; error: string | null } {
  return loanIdFromSearch(search);
}

export function selectPaymentLoanFromDialog(
  id: string, currentId: string | null, failedId: string | null,
  retry: (id: string) => void, navigate: (id: string) => void,
): void {
  if (id === currentId) { if (failedId === id) retry(id); }
  else navigate(id);
}

export function paymentSearchWithLoan(search: string, id: string | null): URLSearchParams {
  const params = new URLSearchParams(search);
  params.delete('loanId');
  if (id) params.set('loanId', id);
  return params;
}

export async function loadActivePaymentContext(
  id: string, isCurrent: () => boolean, api: Pick<typeof paymentApi, 'context'> = paymentApi,
): Promise<PaymentContext | null> {
  const context = await api.context(id);
  if (!isCurrent()) return null;
  if (context.summary.loanId !== id || (context.summary as typeof context.summary & { status?: string }).status !== 'ACTIVE') {
    throw new Error('El préstamo ya no está activo. Selecciona otro préstamo.');
  }
  return context;
}
