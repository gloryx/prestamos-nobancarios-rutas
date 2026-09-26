import { describe, expect, it } from 'vitest';
import { formatLoanStatus, getLoanPlanCondition } from './loan';

describe('loan presentation helpers', () => {
  it('maps persisted loan statuses without changing their values', () => {
    expect(formatLoanStatus('ACTIVE')).toBe('ACTIVO');
    expect(formatLoanStatus('CANCELLED')).toBe('CANCELADO');
    expect(formatLoanStatus('REFINANCED')).toBe('REFINANCIADO');
    expect(formatLoanStatus('UNCOLLECTIBLE')).toBe('INCOBRABLE');
    expect(formatLoanStatus('ANNULLED')).toBe('ANULADO');
    expect(formatLoanStatus('future-status')).toBe('FUTURE-STATUS');
    expect(formatLoanStatus('')).toBe('—');
  });

  it('applies the payment plan condition precedence', () => {
    expect(getLoanPlanCondition({ dueDate: '2026-09-01', pendingAmount: '0.00' }, '2026-09-25')).toBe('PAGADO');
    expect(getLoanPlanCondition({ dueDate: '2026-09-01', pendingAmount: '10.00' }, '2026-09-25')).toBe('VENCIDO');
    expect(getLoanPlanCondition({ dueDate: '2026-09-25', pendingAmount: '10.00' }, '2026-09-25')).toBe('PENDIENTE');
  });
});
