import type { LoanPlanEntry } from '../../domain/entities/loan';

const LOAN_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'ACTIVO',
  CANCELLED: 'CANCELADO',
  REFINANCED: 'REFINANCIADO',
  UNCOLLECTIBLE: 'INCOBRABLE',
  ANNULLED: 'ANULADO',
};

export type LoanPlanCondition = 'PAGADO' | 'VENCIDO' | 'PENDIENTE';

export function formatLoanStatus(status: string): string {
  const normalized = status.trim().toUpperCase();
  return LOAN_STATUS_LABELS[normalized] ?? (normalized || '—');
}

export function getLoanPlanCondition(
  entry: Pick<LoanPlanEntry, 'dueDate' | 'pendingAmount'>,
  today = new Date().toISOString().slice(0, 10),
): LoanPlanCondition {
  if (Number(entry.pendingAmount) <= 0) return 'PAGADO';
  return entry.dueDate < today ? 'VENCIDO' : 'PENDIENTE';
}
