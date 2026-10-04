import { describe, expect, it, vi } from 'vitest';
import { loanEditAttempt, draftFromLoan, reviewLoanEdit } from './loan-edit';
import { reviewPlanDraft } from './payment-plan';
import { editContext } from './loan-edit.fixture';

describe('loan edit draft', () => {
  it('keeps the server baseline immutable and omits no-op changes, including equivalent cents and normalized observations', () => {
    const draft = draftFromLoan(editContext);
    expect(reviewLoanEdit(editContext, { ...draft, interestAmount: '20', observations: ' original ' })).toMatchObject({ valid: true, changes: {}, interestChanged: false });
    const changes = reviewLoanEdit(editContext, { ...draft, paymentFrequencyId: 'frequency-new', preferredPaymentMethodId: 'method-new', observations: '   ' });
    expect(changes).toMatchObject({ valid: true, changes: { paymentFrequencyId: 'frequency-new', preferredPaymentMethodId: 'method-new', observations: null }, interestChanged: false });
    expect(editContext.baseline.plan).toEqual([{ id: 'plan-a', dueDate: '2026-02-02', pendingAmount: '60.00' }]);
    expect(reviewLoanEdit(editContext, { ...draft, paymentFrequencyId: 'frequency-off' }).valid).toBe(false);
    expect(reviewLoanEdit(editContext, { ...draft, preferredPaymentMethodId: 'method-off' }).valid).toBe(false);
  });
  it('previews exact cents without becoming financial authority or distributing obligations', () => {
    const draft = draftFromLoan(editContext);
    expect(reviewLoanEdit(editContext, { ...draft, interestAmount: '20.01' })).toMatchObject({ changes: { interestAmount: '20.01' }, newTotal: '120.01', newBalance: '60.01' });
    expect(reviewPlanDraft('60.01', [{ key: 'plan-a', id: 'plan-a', dueDate: '2026-02-02', pendingAmount: '60.00' }], { allowEmpty: true, minDate: editContext.loan.startDate })).toMatchObject({ differenceCents: 1n, canSave: false });
    expect(reviewLoanEdit(editContext, { ...draft, interestAmount: '0' })).toMatchObject({ newTotal: '100.00', newBalance: '40.00' });
    const paidOff = { ...editContext, baseline: { ...editContext.baseline, financialBalance: '0.00', plan: [] } };
    expect(reviewPlanDraft('0.00', [], { allowEmpty: true }).canSave).toBe(true);
    expect(reviewPlanDraft('0.00', []).canSave).toBe(false);
    expect(reviewPlanDraft('0.00', [{ key: 'x', id: null, dueDate: '2026-02-01', pendingAmount: '1.00' }], { allowEmpty: true }).canSave).toBe(false);
    expect(reviewLoanEdit(paidOff, { ...draft, interestAmount: '19.99' }).valid).toBe(false);
    expect(reviewPlanDraft('60.00', [{ key: 'plan-a', id: 'plan-a', dueDate: '2025-12-31', pendingAmount: '60.00' }], { allowEmpty: true, minDate: '2026-01-01' }).canSave).toBe(false);
    expect(reviewLoanEdit(editContext, { ...draft, interestAmount: '12.' }).valid).toBe(false);
  });
  it('reuses the key for the identical retry and rotates after a changed logical payload', () => {
    const keys = vi.fn().mockReturnValueOnce('key-1').mockReturnValueOnce('key-2');
    const body = { baseline: editContext.baseline, changes: { observations: null } };
    const first = loanEditAttempt(null, 'loan-1', body, keys);
    expect(loanEditAttempt(first, 'loan-1', body, keys)).toBe(first);
    expect(loanEditAttempt(first, 'loan-1', { ...body, changes: { paymentFrequencyId: 'frequency-new' } }, keys).key).toBe('key-2');
    expect(keys).toHaveBeenCalledTimes(2);
  });
});
