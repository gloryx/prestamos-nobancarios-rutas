import { paymentApi, type PaymentContext } from '../../infrastructure/api/payment.api';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function paymentLoanIdFromSearch(search: string): { id: string | null; error: string | null } {
  const values = new URLSearchParams(search).getAll('loanId');
  if (!values.length) return { id: null, error: null };
  if (values.length !== 1 || !uuid.test(values[0])) return { id: null, error: 'El identificador del préstamo no es válido.' };
  return { id: values[0].toLowerCase(), error: null };
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
