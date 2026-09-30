import { describe, expect, it } from 'vitest';
import { formatCashMovementTableConcept } from './cash-movement-concept';

describe('cash movement table concept', () => {
  it('shows the actual loan number on disbursement and customer payment rows', () => {
    expect(formatCashMovementTableConcept({ concept: 'LOAN_DISBURSEMENT', loanNumber: '125' })).toBe('Desembolso de préstamo #125');
    expect(formatCashMovementTableConcept({ concept: 'CUSTOMER_PAYMENT', loanNumber: '125' })).toBe('Pago de préstamo #125');
  });

  it('distinguishes payment and disbursement reversals by the direct original', () => {
    expect(formatCashMovementTableConcept({ concept: 'REVERSAL', reversedConcept: 'CUSTOMER_PAYMENT', loanNumber: '125' })).toBe('Reversión de pago de préstamo #125');
    expect(formatCashMovementTableConcept({ concept: 'REVERSAL', reversedConcept: 'LOAN_DISBURSEMENT', loanNumber: '125' })).toBe('Reversión de desembolso de préstamo #125');
  });

  it('keeps exact existing labels for missing or invalid numbers and non-loan originals', () => {
    for (const loanNumber of [undefined, null, '', 'NaN', 'undefined', 'null']) {
      expect(formatCashMovementTableConcept({ concept: 'CUSTOMER_PAYMENT', loanNumber })).toBe('Pago de cliente');
      expect(formatCashMovementTableConcept({ concept: 'LOAN_DISBURSEMENT', loanNumber })).toBe('Desembolso de préstamo');
      expect(formatCashMovementTableConcept({ concept: 'REVERSAL', reversedConcept: 'CUSTOMER_PAYMENT', loanNumber })).toBe('Reversión');
    }
    expect(formatCashMovementTableConcept({ concept: 'REVERSAL', reversedConcept: 'OPERATING_EXPENSE', loanNumber: '125' })).toBe('Reversión');
    expect(formatCashMovementTableConcept({ concept: 'REVERSAL', loanNumber: '125' })).toBe('Reversión');
    expect(formatCashMovementTableConcept({ concept: 'OPERATING_EXPENSE', loanNumber: '125' })).toBe('Gasto operativo');
  });
});
