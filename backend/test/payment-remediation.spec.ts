import {
  buildPaymentContext,
  filterPositivePendingEntries,
  reactivatedStatusAfterAnnulment,
  validatePlanCustomization,
} from '../src/domain/payment/payment-invariants';
import { directionForManualConcept } from '../src/application/cash-movement/cash-movement.use-cases';

describe('payment remediation invariants', () => {
  it('emits the exact context contract and excludes zero-pending rows', () => {
    const result = buildPaymentContext({
      summary: { loanId: 'loan-1' },
      balances: { financialBalance: '50.00' },
      combinedPlan: [
        { id: 'paid', dueDate: '2026-09-01', sequence: 1, pendingAmount: '0.00' },
        { id: 'pending', dueDate: '2026-10-01', sequence: 2, pendingAmount: '50.00' },
      ],
      lastValidPayment: null,
      refinanceEligibility: false,
      preferredMethod: { id: 'method-1', activeMethods: ['method-1'], collectors: ['collector-1'] },
    });

    expect(Object.keys(result).sort()).toEqual([
      'balances', 'combinedPlan', 'firstOperationalRow', 'lastValidPayment',
      'preferredMethod', 'refinanceEligibility', 'summary',
    ].sort());
    expect(result.combinedPlan).toEqual([
      { id: 'pending', dueDate: '2026-10-01', sequence: 2, pendingAmount: '50.00' },
    ]);
    expect(result.preferredMethod).toEqual({ id: 'method-1', activeMethods: ['method-1'], collectors: ['collector-1'] });
  });

  it('retains paid entries separately while projecting only positive pending entries', () => {
    const entries = [
      { id: 'paid', dueDate: '2026-09-01', sequence: 1, pendingAmount: '0.00' },
      { id: 'open', dueDate: '2026-10-01', sequence: 2, pendingAmount: '10.00' },
    ];
    expect(filterPositivePendingEntries(entries)).toEqual([entries[1]]);
  });

  it('accepts valid pending-only customization and rejects stale or non-reconciling plans', () => {
    expect(validatePlanCustomization([
      { dueDate: '2026-09-01', pendingAmount: '30.00' },
      { dueDate: '2026-10-01', pendingAmount: '20.00' },
    ], '2026-09-01', '50.00')).toBe(true);
    expect(() => validatePlanCustomization([
      { dueDate: '2026-08-31', pendingAmount: '50.00' },
    ], '2026-09-01', '50.00')).toThrow('plan-date-before-loan');
    expect(() => validatePlanCustomization([
      { dueDate: '2026-09-01', pendingAmount: '49.99' },
    ], '2026-09-01', '50.00')).toThrow('plan-total-mismatch');
  });

  it('keeps customer payment creation inside the payment workflow', () => {
    expect(() => directionForManualConcept('CUSTOMER_PAYMENT' as never)).toThrow('manuales');
  });

  it('reactivates a cancelled loan only when annulment restores a positive balance', () => {
    expect(reactivatedStatusAfterAnnulment('CANCELLED', '10.00')).toBe('ACTIVE');
    expect(reactivatedStatusAfterAnnulment('CANCELLED', '0.00')).toBe('CANCELLED');
    expect(reactivatedStatusAfterAnnulment('ACTIVE', '10.00')).toBe('ACTIVE');
  });
});
