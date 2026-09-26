import {
  assertPaymentDate,
  calculatePaymentBalances,
  isLastValidPayment,
  paymentFingerprint,
} from '../src/domain/payment/payment-rules';

describe('payment workflow rules', () => {
  it('rejects dates outside the opening, loan, and current-day window', () => {
    expect(() => assertPaymentDate('2026-09-10', '2026-09-11', '2026-09-09', '2026-09-26')).toThrow('payment-date-before-opening');
    expect(() => assertPaymentDate('2026-09-12', '2026-09-13', '2026-09-12', '2026-09-26')).toThrow('payment-date-before-loan');
    expect(() => assertPaymentDate('2026-09-12', '2026-09-12', '2026-09-27', '2026-09-26')).toThrow('payment-date-in-future');
    expect(() => assertPaymentDate('2026-09-12', '2026-09-12', '2026-09-26', '2026-09-26')).not.toThrow();
  });

  it('calculates reconciled balances from valid payment facts only', () => {
    expect(calculatePaymentBalances('100.00', '70.00', '40.00', '5.00', '12.50', '30.00')).toEqual({
      financialBalance: '30.00',
      outstandingPrincipal: '35.00',
      realizedInterest: '12.50',
      equationHolds: true,
    });
    expect(calculatePaymentBalances('100.00', '70.00', '40.00', '5.00', '12.50', '6.00').equationHolds).toBe(false);
  });

  it('orders the last valid payment by date, creation time, and id', () => {
    const payments: Array<{ id: string; status: 'VALID' | 'ANNULLED'; paymentDate: string; createdAt: string }> = [
      { id: 'a', status: 'VALID', paymentDate: '2026-09-20', createdAt: '2026-09-20T08:00:00.000Z' },
      { id: 'b', status: 'ANNULLED', paymentDate: '2026-09-26', createdAt: '2026-09-26T08:00:00.000Z' },
      { id: 'c', status: 'VALID', paymentDate: '2026-09-26', createdAt: '2026-09-26T09:00:00.000Z' },
    ];
    expect(isLastValidPayment('c', payments)).toBe(true);
    expect(isLastValidPayment('a', payments)).toBe(false);
  });

  it('creates stable fingerprints independent of object key order', () => {
    expect(paymentFingerprint({ amount: '10.00', loanId: 'loan', paymentDate: '2026-09-26', methodId: 'method' }))
      .toBe(paymentFingerprint({ methodId: 'method', paymentDate: '2026-09-26', loanId: 'loan', amount: '10.00' }));
  });
});
