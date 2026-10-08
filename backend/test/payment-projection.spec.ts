import { execFileSync } from 'node:child_process';
import { buildCollectionProjection, buildPaymentProjection } from '../src/domain/payment/payment-projection';
import { paymentDateOnlyKey } from '../src/domain/payment/payment-date-only';

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

  it('sorts driver dates with strings by calendar day, sequence, and id without changing source rows', () => {
    const entries = [
      { id: 'later', dueDate: new Date(2026, 9, 1), sequence: 1, pendingAmount: '1.00' },
      { id: 'same-z', dueDate: '2026-09-30', sequence: 2, pendingAmount: '1.00' },
      { id: 'same-b', dueDate: new Date(2026, 8, 30), sequence: 1, pendingAmount: '1.00' },
      { id: 'same-a', dueDate: new Date(2026, 8, 30), sequence: 1, pendingAmount: '1.00' },
    ];
    const payments = [
      { id: 'a', paymentDate: new Date(2026, 8, 30), amount: '1.00', status: 'VALID' as const },
      { id: 'b', paymentDate: '2026-09-30', amount: '1.00', status: 'VALID' as const },
    ];
    const result = buildPaymentProjection(entries, payments);

    expect(result.combinedPlan.map((entry) => entry.id)).toEqual(['same-a', 'same-b', 'same-z', 'later']);
    expect(result.lastValidPayment).toBe(payments[1]);
    expect(result.combinedPlan[0]).toBe(entries[3]);
    expect(entries.map((entry) => entry.id)).toEqual(['later', 'same-z', 'same-b', 'same-a']);
    expect(entries[2].dueDate).toBeInstanceOf(Date);
    expect(payments[0].paymentDate).toBeInstanceOf(Date);
    expect(paymentDateOnlyKey(entries[2].dueDate)).toBe('2026-09-30');
    expect(paymentDateOnlyKey(payments[1].paymentDate)).toBe('2026-09-30');
  });

  it('keeps the local date at midnight in a positive-offset timezone', () => {
    const script = `
      const { paymentDateOnlyKey } = require('./src/domain/payment/payment-date-only');
      const { buildPaymentProjection } = require('./src/domain/payment/payment-projection');
      const date = require('pg').types.getTypeParser(1082, 'text')('2026-09-30');
      const rows = buildPaymentProjection([
        { id: 'later', dueDate: '2026-10-01', sequence: 1, pendingAmount: '1.00' },
        { id: 'local', dueDate: date, sequence: 1, pendingAmount: '1.00' },
      ], []).combinedPlan.map((entry) => entry.id);
      console.log(JSON.stringify({ utcDay: date.getUTCDate(), key: paymentDateOnlyKey(date), rows }));
    `;
    const output = execFileSync(process.execPath, ['-r', 'ts-node/register', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, TZ: 'Pacific/Auckland' }, encoding: 'utf8',
    });
    expect(JSON.parse(output)).toEqual({ utcDay: 29, key: '2026-09-30', rows: ['local', 'later'] });
  });

  it('consolidates overdue obligations with only the next scheduled obligation', () => {
    expect(buildCollectionProjection([
      { id: 'old-a', dueDate: '2026-09-01', sequence: 1, pendingAmount: '20.00' },
      { id: 'old-b', dueDate: '2026-09-02', sequence: 2, pendingAmount: '20.00' },
      { id: 'next', dueDate: '2026-10-10', sequence: 3, pendingAmount: '20.00' },
      { id: 'later', dueDate: '2026-11-10', sequence: 4, pendingAmount: '20.00' },
    ], '2026-10-07')).toEqual({ overdueAmount: '40.00', scheduledAmount: '20.00', totalSuggestedAmount: '60.00', operationalDate: '2026-10-10', operationalDateKind: 'SCHEDULED' });
  });

  it('uses today without inventing a due date when only overdue debt remains', () => {
    expect(buildCollectionProjection([{ id: 'old', dueDate: '2026-09-01', sequence: 1, pendingAmount: '40.00' }], '2026-10-07'))
      .toEqual({ overdueAmount: '40.00', scheduledAmount: '0.00', totalSuggestedAmount: '40.00', operationalDate: '2026-10-07', operationalDateKind: 'TODAY' });
  });

  it('presents a historical carry as overdue without duplicating the receiver balance', () => {
    const result = buildCollectionProjection([{ id: 'future', dueDate: '2026-10-10', sequence: 2, pendingAmount: '100.00' }], '2026-10-07', [{
      planEntryId: 'old', amountApplied: '20.00', carriedForwardAmount: '40.00', carriedToPlanEntryId: 'future', sourceDueDate: '2026-09-01', createdAt: '2026-09-05T01:00:00Z',
    }]);
    expect(result).toEqual({ overdueAmount: '40.00', scheduledAmount: '60.00', totalSuggestedAmount: '100.00', operationalDate: '2026-10-10', operationalDateKind: 'SCHEDULED' });
  });

  it('reduces historical carried arrears first after a later application', () => {
    const applications = [
      { planEntryId: 'old', amountApplied: '20.00', carriedForwardAmount: '40.00', carriedToPlanEntryId: 'future', sourceDueDate: '2026-09-01', createdAt: '2026-09-05T01:00:00Z' },
      { planEntryId: 'future', amountApplied: '15.00', carriedForwardAmount: '0.00', carriedToPlanEntryId: null, sourceDueDate: '2026-10-10', createdAt: '2026-09-06T01:00:00Z' },
    ];
    expect(buildCollectionProjection([{ id: 'future', dueDate: '2026-10-10', sequence: 2, pendingAmount: '85.00' }], '2026-10-07', applications))
      .toMatchObject({ overdueAmount: '25.00', scheduledAmount: '60.00', totalSuggestedAmount: '85.00' });
  });
});
