import { consolidatePlanAfterPayment, type ConsolidationPlanEntry } from '../src/domain/payment/payment-plan-consolidation';

const entry = (id: string, dueDate: string, sequence: number, pendingAmount = '50000.00'): ConsolidationPlanEntry =>
  ({ id, dueDate, sequence, pendingAmount });
const cents = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};
const consolidate = (input: Omit<Parameters<typeof consolidatePlanAfterPayment>[0], 'trigger'>) =>
  consolidatePlanAfterPayment({ trigger: 'PAYMENT', ...input });

describe('post-payment chronological plan consolidation', () => {
  it('models loan #4764 by moving installments 7-9 into installment 10 without changing the balance', () => {
    const plan = [
      entry('installment-6', '2026-10-08', 6, '0.00'),
      entry('installment-7', '2026-10-09', 7),
      entry('installment-8', '2026-10-10', 8),
      entry('installment-9', '2026-10-12', 9),
      entry('installment-10', '2026-10-13', 10),
      entry('future-balance', '2026-10-14', 11, '1150000.00'),
    ];

    const result = consolidate({ paymentDate: '2026-10-12', financialBalance: '1350000.00', entries: plan });

    expect(result.entries.map(({ id, pendingAmount }) => [id, pendingAmount])).toEqual([
      ['installment-6', '0.00'],
      ['installment-7', '0.00'],
      ['installment-8', '0.00'],
      ['installment-9', '0.00'],
      ['installment-10', '200000.00'],
      ['future-balance', '1150000.00'],
    ]);
    expect(result).toMatchObject({ targetPlanEntryId: 'installment-10', consolidatedAmount: '150000.00' });
    expect(result.traces).toEqual([
      { sourcePlanEntryId: 'installment-7', targetPlanEntryId: 'installment-10', amount: '50000.00' },
      { sourcePlanEntryId: 'installment-8', targetPlanEntryId: 'installment-10', amount: '50000.00' },
      { sourcePlanEntryId: 'installment-9', targetPlanEntryId: 'installment-10', amount: '50000.00' },
    ]);
    expect(result.entries.reduce((sum, item) => sum + cents(item.pendingAmount), 0n)).toBe(135000000n);
    expect(plan.map((item) => item.pendingAmount)).toEqual(['0.00', '50000.00', '50000.00', '50000.00', '50000.00', '1150000.00']);
  });

  it('is deterministic for unordered input and orders same-date sources by sequence and id', () => {
    const plan = [entry('target', '2026-10-13', 4), entry('source-b', '2026-10-12', 3), entry('source-a', '2026-10-12', 2)];
    const first = consolidate({ paymentDate: '2026-10-12', financialBalance: '150000.00', entries: plan });
    const second = consolidate({ paymentDate: '2026-10-12', financialBalance: '150000.00', entries: [...plan].reverse() });

    expect(first).toEqual(second);
    expect(first.traces.map((trace) => trace.sourcePlanEntryId)).toEqual(['source-a', 'source-b']);
  });

  it('leaves the reconciled plan unchanged when there is no later payable obligation', () => {
    const plan = [entry('closed', '2026-10-11', 1, '0.00'), entry('pending', '2026-10-12', 2)];
    const result = consolidate({ paymentDate: '2026-10-12', financialBalance: '50000.00', entries: plan });

    expect(result).toEqual({
      entries: plan,
      targetPlanEntryId: null,
      consolidatedAmount: '0.00',
      mutations: [],
      traces: [],
      reversalMutations: [],
    });
  });

  it('uses the effective historical payment date rather than the current date', () => {
    const result = consolidate({
      paymentDate: '2026-03-10',
      financialBalance: '150000.00',
      entries: [entry('past', '2026-03-09', 1), entry('target', '2026-03-11', 2), entry('later', '2026-10-01', 3)],
    });

    expect(result.traces).toEqual([{ sourcePlanEntryId: 'past', targetPlanEntryId: 'target', amount: '50000.00' }]);
    expect(result.entries.map((item) => item.pendingAmount)).toEqual(['0.00', '100000.00', '50000.00']);
  });

  it('returns exact inverse mutations for annulment', () => {
    const result = consolidate({
      paymentDate: '2026-10-12',
      financialBalance: '150000.00',
      entries: [entry('source-a', '2026-10-10', 1), entry('source-b', '2026-10-12', 2), entry('target', '2026-10-13', 3)],
    });

    expect(result.reversalMutations).toEqual([
      { planEntryId: 'target', pendingBefore: '150000.00', pendingAfter: '50000.00' },
      { planEntryId: 'source-a', pendingBefore: '0.00', pendingAfter: '50000.00' },
      { planEntryId: 'source-b', pendingBefore: '0.00', pendingAfter: '50000.00' },
    ]);
  });

  it('supports a fully settled post-payment plan without inventing a target', () => {
    const result = consolidate({
      paymentDate: '2026-10-12',
      financialBalance: '0.00',
      entries: [entry('settled', '2026-10-12', 1, '0.00')],
    });

    expect(result.targetPlanEntryId).toBeNull();
    expect(result.mutations).toEqual([]);
  });

  it.each([
    ['an inconsistent financial balance', { paymentDate: '2026-10-12', financialBalance: '49999.99', entries: [entry('one', '2026-10-13', 1)] }, 'plan-total-mismatch'],
    ['an invalid payment date', { paymentDate: '2026-02-30', financialBalance: '50000.00', entries: [entry('one', '2026-10-13', 1)] }, 'invalid-date'],
    ['duplicate plan identities', { paymentDate: '2026-10-12', financialBalance: '100000.00', entries: [entry('one', '2026-10-11', 1), entry('one', '2026-10-13', 2)] }, 'invalid-plan-entry-id'],
  ])('rejects %s', (_, input, error) => {
    expect(() => consolidate(input)).toThrow(error);
  });

  it.each(['FINANCIAL_CLOSE', 'REFINANCING'])('rejects the %s lifecycle trigger', (trigger) => {
    expect(() => consolidatePlanAfterPayment({
      trigger,
      paymentDate: '2026-10-12',
      financialBalance: '50000.00',
      entries: [entry('one', '2026-10-13', 1)],
    } as never)).toThrow('unsupported-consolidation-trigger');
  });
});
