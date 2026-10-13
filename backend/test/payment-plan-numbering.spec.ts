import { alignApplicationSequences, numberCurrentPaymentPlan } from
  '../src/domain/payment/payment-plan-numbering';

describe('current payment plan numbering', () => {
  const entries = [
    { id: 'reprogrammed', sequence: 16, dueDate: '2026-10-09', pendingAmount: '0.00' },
    { id: 'later', sequence: 30, dueDate: '2026-11-01', pendingAmount: '75.00' },
    { id: 'paid', sequence: 15, dueDate: '2026-10-08', pendingAmount: '0.00' },
    { id: 'earlier', sequence: 22, dueDate: '2026-10-20', pendingAmount: '25.00' },
  ];

  it('numbers paid and pending obligations chronologically without gaps', () => {
    const applications = [{ planEntryId: 'paid', sequence: 15, amountApplied: '50.00', pendingAfter: '0.00' }];
    const numbered = numberCurrentPaymentPlan(entries, applications);
    expect(numbered.map(({ id, sequence }) => [id, sequence])).toEqual([
      ['paid', 1], ['earlier', 2], ['later', 3],
    ]);
    expect(alignApplicationSequences(applications, numbered)).toEqual([
      { planEntryId: 'paid', sequence: 1, amountApplied: '50.00', pendingAfter: '0.00' },
    ]);
  });

  it('does not treat a zero row as paid when the real application left a balance before reorganization', () => {
    expect(numberCurrentPaymentPlan(entries, [
      { planEntryId: 'reprogrammed', amountApplied: '10.00', pendingAfter: '40.00' },
    ]).map(({ id, sequence }) => [id, sequence])).toEqual([
      ['earlier', 1], ['later', 2],
    ]);
  });
});
