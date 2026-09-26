import { allocatePayment } from '../src/domain/payment/payment-allocation';

describe('allocatePayment', () => {
  it('allocates capital-first chronologically and records pending transitions', () => {
    const result = allocatePayment('75.00', [
      { id: 'first', dueDate: '2026-09-01', sequence: 1, principalPending: '50.00', interestPending: '10.00' },
      { id: 'second', dueDate: '2026-10-01', sequence: 2, principalPending: '40.00', interestPending: '5.00' },
    ]);

    expect(result.principalApplied).toBe('75.00');
    expect(result.interestApplied).toBe('0.00');
    expect(result.applications).toEqual([
      expect.objectContaining({ planEntryId: 'first', amountApplied: '50.00', pendingBefore: '60.00', pendingAfter: '10.00', carriedForwardAmount: '0.00', carriedToPlanEntryId: null }),
      expect.objectContaining({ planEntryId: 'second', amountApplied: '25.00', pendingBefore: '45.00', pendingAfter: '20.00', carriedForwardAmount: '0.00', carriedToPlanEntryId: null }),
    ]);
  });

  it('keeps an underpayment on the same obligation and rejects over-limit values', () => {
    const result = allocatePayment('12.50', [
      { id: 'first', dueDate: '2026-09-01', sequence: 1, principalPending: '50.00', interestPending: '10.00' },
    ]);

    expect(result.applications[0]).toEqual(expect.objectContaining({ amountApplied: '12.50', pendingAfter: '47.50', carriedForwardAmount: '0.00' }));
    expect(() => allocatePayment('60.01', [{ id: 'first', dueDate: '2026-09-01', sequence: 1, principalPending: '50.00', interestPending: '10.00' }])).toThrow('over-limit');
  });
});
