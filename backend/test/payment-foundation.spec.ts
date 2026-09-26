import { COLLECTION_MANAGER_DEFAULTS, PERMISSIONS } from '../src/shared/constants/security';
import { allocatePayment } from '../src/domain/payment/payment-allocation';

describe('payment foundation contracts', () => {
  it('registers exactly the four payment permissions and grants them to collection managers', () => {
    const names = PERMISSIONS.map(([name]) => name);
    expect(names.filter((name) => name.startsWith('payments.'))).toEqual([
      'payments.view', 'payments.create', 'payments.annul', 'payments.plan.customize',
    ]);
    expect(COLLECTION_MANAGER_DEFAULTS).toEqual(expect.arrayContaining(['payments.view', 'payments.create', 'payments.annul', 'payments.plan.customize']));
  });

  it('keeps money as two-decimal strings at the allocation boundary', () => {
    const result = allocatePayment('10.5', [{ id: 'entry', dueDate: '2026-09-01', sequence: 1, principalPending: '10.00', interestPending: '5.00' }]);
    expect(result.principalApplied).toBe('10.00');
    expect(result.interestApplied).toBe('0.50');
    expect(result.applications[0].pendingAfter).toBe('4.50');
  });
});
