import type { LoanPlanEntry } from '../../domain/entities/loan';

const LOAN_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'ACTIVO',
  CANCELLED: 'CANCELADO',
  REFINANCED: 'REFINANCIADO',
  UNCOLLECTIBLE: 'INCOBRABLE',
  ANNULLED: 'ANULADO',
};

export type LoanPlanCondition = 'PAGADA' | 'VENCIDA' | 'PENDIENTE' | 'REPROGRAMADA';

export function formatLoanStatus(status: string): string {
  const normalized = status.trim().toUpperCase();
  return LOAN_STATUS_LABELS[normalized] ?? (normalized || '—');
}

export function getLoanPlanCondition(
  entry: Pick<LoanPlanEntry, 'dueDate' | 'pendingAmount'>,
  hasVerifiedPaymentOrToday: boolean | string = false,
  today = new Date().toISOString().slice(0, 10),
): LoanPlanCondition {
  const hasVerifiedPayment = typeof hasVerifiedPaymentOrToday === 'boolean' ? hasVerifiedPaymentOrToday : false;
  if (typeof hasVerifiedPaymentOrToday === 'string') today = hasVerifiedPaymentOrToday;
  if (Number(entry.pendingAmount) <= 0) return hasVerifiedPayment ? 'PAGADA' : 'REPROGRAMADA';
  return entry.dueDate < today ? 'VENCIDA' : 'PENDIENTE';
}
