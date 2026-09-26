import { buildPaymentProjection } from '../src/domain/payment/payment-projection';

describe('payment projection', () => {
  it('orders current obligations and valid payment effects once', () => {
    const result = buildPaymentProjection([
      { id: 'late', dueDate: '2026-10-01', sequence: 2, pendingAmount: '20.00' },
      { id: 'early', dueDate: '2026-09-01', sequence: 1, pendingAmount: '0.00' },
    ], [
      { id: 'payment', paymentDate: '2026-09-15', amount: '10.00', status: 'VALID' },
      { id: 'cancelled', paymentDate: '2026-09-20', amount: '50.00', status: 'ANNULLED' },
    ]);

    expect(result.combinedPlan.map((row) => row.id)).toEqual(['early', 'late']);
    expect(result.validPayments).toHaveLength(1);
    expect(result.lastValidPayment?.id).toBe('payment');
  });

  it('marks refinancing eligible only when valid payments cover interest and balance is reconciled', () => {
    const pending = [{ id: 'entry', dueDate: '2026-10-01', sequence: 1, pendingAmount: '60.00' }];
    expect(buildPaymentProjection(pending, [{ id: 'p', paymentDate: '2026-09-20', amount: '40.00', status: 'VALID' }], '100.00', '30.00').refinanceEligibility).toBe(true);
    expect(buildPaymentProjection(pending, [{ id: 'p', paymentDate: '2026-09-20', amount: '20.00', status: 'ANNULLED' }], '100.00', '30.00').refinanceEligibility).toBe(false);
  });
});
