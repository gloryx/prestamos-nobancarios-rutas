import { describe, expect, it } from 'vitest';
import { hasPaidPlanEvidence, numberCurrentPaymentPlan } from './payment-plan-numbering';

describe('current payment plan numbering', () => {
  const plan = [
    { id: 'moved', sequence: 8, dueDate: '2026-05-10', pendingAmount: '0.00' },
    { id: 'pending-b', sequence: 12, dueDate: '2026-06-20', pendingAmount: '125.00' },
    { id: 'paid', sequence: 7, dueDate: '2026-04-01', pendingAmount: '0.00' },
    { id: 'pending-a', sequence: 10, dueDate: '2026-06-01', pendingAmount: '275.00' },
  ];

  it('uses full financial coverage, not a zero balance alone, and returns one current sequence', () => {
    const applications = [
      { planEntryId: 'paid', sequence: 7, amountApplied: '50.00', pendingAfter: '0.00' },
      { planEntryId: 'moved', sequence: 8, amountApplied: '10.00', pendingAfter: '40.00' },
    ];
    expect(hasPaidPlanEvidence('paid', applications)).toBe(true);
    expect(hasPaidPlanEvidence('moved', applications)).toBe(false);
    expect(numberCurrentPaymentPlan(plan, applications).map(({ id, sequence }) => [id, sequence])).toEqual([
      ['paid', 1], ['pending-a', 2], ['pending-b', 3],
    ]);
  });
});
