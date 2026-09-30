import { allocatePayment } from '../src/domain/payment/payment-allocation';

describe('allocatePayment', () => {
  it('completes earlier obligations before later ones while recording loan principal first', () => {
    const result = allocatePayment('75.00', [
      { id: 'first', dueDate: '2026-09-01', sequence: 1, principalPending: '50.00', interestPending: '10.00' },
      { id: 'second', dueDate: '2026-10-01', sequence: 2, principalPending: '40.00', interestPending: '5.00' },
    ]);

    expect(result.principalApplied).toBe('75.00');
    expect(result.interestApplied).toBe('0.00');
    expect(result.applications).toEqual([
      expect.objectContaining({ planEntryId: 'first', amountApplied: '60.00', pendingBefore: '60.00', pendingAfter: '0.00', carriedForwardAmount: '0.00', carriedToPlanEntryId: null }),
      expect.objectContaining({ planEntryId: 'second', amountApplied: '15.00', pendingBefore: '45.00', pendingAfter: '30.00', carriedForwardAmount: '0.00', carriedToPlanEntryId: null }),
    ]);
  });

  it('keeps an underpayment on the same obligation and rejects over-limit values', () => {
    const result = allocatePayment('12.50', [
      { id: 'first', dueDate: '2026-09-01', sequence: 1, principalPending: '50.00', interestPending: '10.00' },
    ]);

    expect(result.applications[0]).toEqual(expect.objectContaining({ amountApplied: '12.50', pendingAfter: '47.50', carriedForwardAmount: '0.00' }));
    expect(() => allocatePayment('60.01', [{ id: 'first', dueDate: '2026-09-01', sequence: 1, principalPending: '50.00', interestPending: '10.00' }])).toThrow('over-limit');
  });

  it('carries a mixed-component underpayment without treating the carry as cash', () => {
    const result = allocatePayment('20.00', [
      { id: 'first', dueDate: '2026-09-01', sequence: 1, principalPending: '10.00', interestPending: '50.00' },
      { id: 'second', dueDate: '2026-10-01', sequence: 2, principalPending: '50.00', interestPending: '0.00' },
    ]);
    expect(result).toMatchObject({ principalApplied: '20.00', interestApplied: '0.00' });
    expect(result.applications).toEqual([
      { planEntryId: 'first', amountApplied: '20.00', pendingBefore: '60.00', pendingAfter: '0.00', carriedForwardAmount: '40.00', carriedToPlanEntryId: 'second' },
      { planEntryId: 'second', amountApplied: '0.00', pendingBefore: '50.00', pendingAfter: '90.00', carriedForwardAmount: '0.00', carriedToPlanEntryId: null },
    ]);
    expect(result.applications.reduce((sum, item) => sum + BigInt(item.amountApplied.replace('.', '')), 0n)).toBe(2000n);
  });

  it('applies cash to principal first and then interest even when the first obligation is carried', () => {
    const result = allocatePayment('20.00', [
      { id: 'first', dueDate: '2026-09-01', sequence: 1, principalPending: '10.00', interestPending: '50.00' },
      { id: 'second', dueDate: '2026-10-01', sequence: 2, principalPending: '5.00', interestPending: '55.00' },
    ]);
    expect(result).toMatchObject({ principalApplied: '15.00', interestApplied: '5.00' });
    expect(result.applications.map((item) => item.pendingAfter)).toEqual(['0.00', '100.00']);
    expect(result.applications.map((item) => item.amountApplied)).toEqual(['20.00', '0.00']);
  });

  it.each([
    ['1.00', '59999.00', '119999.00'],
    ['59999.00', '1.00', '60001.00'],
  ])('closes the first 60k row for %s and carries %s only into the next positive row', (amount, carry, next) => {
    const result = allocatePayment(amount, [
      { id: 'second', dueDate: '2026-10-01', sequence: 2, principalPending: '60000.00', interestPending: '0.00' },
      { id: 'first', dueDate: '2026-09-01', sequence: 1, principalPending: '60000.00', interestPending: '0.00' },
    ]);
    expect(result.applications.map((item) => item.planEntryId)).toEqual(['first', 'second']);
    expect(result.applications[0]).toMatchObject({ amountApplied: amount, pendingAfter: '0.00', carriedToPlanEntryId: 'second' });
    expect(result.applications[1]).toMatchObject({ amountApplied: '0.00', pendingAfter: next });
    expect(result.applications[0].carriedForwardAmount).toBe(carry);
  });

  it('uses date, sequence and ID to find the second positive row across historical zero rows', () => {
    const result = allocatePayment('1.00', [
      { id: 'later', dueDate: '2026-12-01', sequence: 1, principalPending: '1.00', interestPending: '0.00' },
      { id: 'b', dueDate: '2026-01-01', sequence: 1, principalPending: '60.00', interestPending: '0.00' },
      { id: 'zero', dueDate: '2026-01-01', sequence: 1, principalPending: '0.00', interestPending: '0.00' },
      { id: 'a', dueDate: '2026-01-01', sequence: 1, principalPending: '60.00', interestPending: '0.00' },
    ]);
    expect(result.applications).toEqual([
      expect.objectContaining({ planEntryId: 'a', pendingAfter: '0.00', carriedForwardAmount: '59.00', carriedToPlanEntryId: 'b' }),
      expect.objectContaining({ planEntryId: 'b', amountApplied: '0.00', pendingAfter: '119.00' }),
    ]);
  });

  it('sorts mixed driver dates with stable sequence and id ties before capital-first allocation', () => {
    const entries = [
      { id: 'later', dueDate: new Date(2026, 9, 1), sequence: 1, principalPending: '1.00', interestPending: '0.00' },
      { id: 'b', dueDate: new Date(2026, 8, 30), sequence: 1, principalPending: '1.00', interestPending: '0.00' },
      { id: 'a', dueDate: '2026-09-30', sequence: 1, principalPending: '1.00', interestPending: '0.00' },
    ];
    expect(allocatePayment('2.00', entries).applications.map((item) => item.planEntryId)).toEqual(['a', 'b']);
    expect(entries.map((entry) => entry.id)).toEqual(['later', 'b', 'a']);
  });
});
