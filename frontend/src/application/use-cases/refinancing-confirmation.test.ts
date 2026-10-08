import { describe, expect, it, vi } from 'vitest';
import type { LoanRefinancingOperations } from '../ports/loan-refinancing.repository';
import type { RefinancingPreview, RefinancingResult } from '../../domain/entities/loan-refinancing';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { classifyRefinancingFailure } from '../../infrastructure/api/loan-refinancing.api';
import { buildRefinancingReview, RefinancingConfirmationController } from './refinancing-confirmation-controller';

const preview: RefinancingPreview = {
  loanId: '11111111-1111-4111-8111-111111111111', loanNumber: '123',
  customer: { id: 'customer', name: 'Ana Solís', identification: '10203040' },
  status: 'ACTIVE', startDate: '2026-09-01', principal: '150000.00', interestAmount: '30000.00',
  totalAmount: '180000.00', paidAmount: '30000.00', paidPrincipal: '30000.00', paidInterest: '0.00',
  outstandingPrincipal: '120000.00', outstandingInterest: '30000.00', financialBalance: '150000.00',
  pendingPlanAmount: '150000.00', minimumRequiredPayment: '30000.00', remainingToMinimum: '0.00',
  eligible: true, reasonCode: null, reason: null, reasons: [], baseline: 'a'.repeat(64),
};
const conditions = { refinancingDate: '2026-10-01', newMoney: '20000.00', newInterestAmount: '10000.00',
  disbursementPaymentMethodId: '22222222-2222-4222-8222-222222222222',
  paymentFrequencyId: '33333333-3333-4333-8333-333333333333',
  preferredPaymentMethodId: '44444444-4444-4444-8444-444444444444',
  observations: '  Revisión  ', count: '2', mode: 'automatic' as const, customPlan: [] };
const plan = [{ sequence: 1, dueDate: '2026-10-02', pendingAmount: '90000.00' },
  { sequence: 2, dueDate: '2026-10-03', pendingAmount: '90000.00' }];
const review = (changes: Partial<typeof conditions> = {}) => buildRefinancingReview(preview, { ...conditions, ...changes }, plan,
  '170000.00', '180000.00', 'Diaria', 'Efectivo', 'Transferencia');
const result: RefinancingResult = {
  refinancingId: 'ref-1', refinancingDate: '2026-10-01', createdAt: '2026-10-01T12:00:00Z',
  originLoan: { id: preview.loanId, loanNumber: preview.loanNumber, status: 'REFINANCED', startDate: preview.startDate },
  newLoan: { id: 'new-1', loanNumber: '456', status: 'ACTIVE', startDate: '2026-10-01' },
  customer: { id: 'customer', fullName: 'Ana Solís', identification: '10203040' },
  financialComposition: { outstandingPrincipalTransferred: '120000.00', capitalizedOutstandingInterest: '30000.00',
    newMoneyDisbursed: '20000.00', newContractualPrincipal: '170000.00', newInterestAmount: '10000.00',
    newContractualTotal: '180000.00' },
  newContract: { paymentFrequency: { id: conditions.paymentFrequencyId, name: 'Diaria', intervalUnit: 'DAY', intervalValue: 1 },
    preferredPaymentMethod: { id: conditions.preferredPaymentMethodId, name: 'Efectivo' },
    disbursementPaymentMethod: { id: conditions.disbursementPaymentMethodId, name: 'Transferencia' }, observations: 'REVISIÓN' },
  disbursement: { id: 'disb-1', cashMovementId: 'cash-1' }, createdBy: { id: 'user-1', fullName: 'Admin' },
};
function setup() {
  const operations: LoanRefinancingOperations = { confirm: vi.fn(async () => result), detail: vi.fn(async () => result) };
  const newKey = vi.fn().mockReturnValueOnce('key-1').mockReturnValueOnce('key-2').mockReturnValueOnce('key-3');
  const controller = new RefinancingConfirmationController(operations, newKey, classifyRefinancingFailure);
  return { operations, controller, newKey };
}

describe('refinancing confirmation', () => {
  it('prepares only DTO fields, the final plan and the server-provided baseline without derived authority', () => {
    const { controller, newKey, operations } = setup();
    expect(operations.confirm).not.toHaveBeenCalled();
    expect(controller.prepare(review())).toBe(true);
    expect(controller.getSnapshot().prepared).toMatchObject({ newPrincipal: '170000.00', newTotal: '180000.00',
      planTotal: '180000.00', difference: '0.00' });
    expect(controller.getSnapshot().prepared!.request).toEqual({ originLoanId: preview.loanId,
      refinancingDate: '2026-10-01', newMoney: '20000.00', disbursementPaymentMethodId: conditions.disbursementPaymentMethodId,
      newInterestAmount: '10000.00', paymentFrequencyId: conditions.paymentFrequencyId,
      preferredPaymentMethodId: conditions.preferredPaymentMethodId, observations: 'Revisión', plan,
      baseline: preview.baseline, idempotencyKey: 'key-1' });
    for (const forbidden of ['paymentCount', 'customPlan', 'outstandingPrincipal', 'outstandingInterest',
      'newContractualPrincipal', 'newContractualTotal']) expect(controller.getSnapshot().prepared!.request).not.toHaveProperty(forbidden);
    expect(newKey).toHaveBeenCalledOnce();
    controller.prepare(review());
    expect(controller.getSnapshot().prepared!.request.idempotencyKey).toBe('key-1');
    expect(newKey).toHaveBeenCalledOnce();
    controller.prepare(review({ observations: 'Different' }));
    expect(controller.getSnapshot().prepared!.request.idempotencyKey).toBe('key-2');
  });

  it('omits the disbursement method with zero new money and keeps dates/amounts exact', () => {
    const zero = buildRefinancingReview(preview, { ...conditions, newMoney: '0', disbursementPaymentMethodId: '' },
      [{ sequence: 1, dueDate: '2026-10-02', pendingAmount: '160000.00' }],
      '150000.00', '160000.00', 'Diaria', 'Efectivo', null);
    expect(zero.request).toMatchObject({ newMoney: '0.00', newInterestAmount: '10000.00', baseline: preview.baseline,
      plan: [{ sequence: 1, dueDate: '2026-10-02', pendingAmount: '160000.00' }] });
    expect(zero.request).not.toHaveProperty('disbursementPaymentMethodId');
  });

  it('never posts a prepared review whose plan does not reconcile exactly', async () => {
    const { controller, operations } = setup();
    const incomplete = review();
    incomplete.request.plan[0].pendingAmount = '89999.99';
    controller.prepare({ ...incomplete, planTotal: '179999.99', difference: '0.01' });
    expect(await controller.confirm(true)).toBeNull();
    expect(operations.confirm).not.toHaveBeenCalled();
  });

  it('locks immediately against double clicks, sends once and treats the server receipt as final', async () => {
    const { controller, operations } = setup();
    let finish!: (value: RefinancingResult) => void;
    vi.mocked(operations.confirm).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    controller.prepare(review());
    expect(await controller.confirm(false)).toBeNull();
    expect(operations.confirm).not.toHaveBeenCalled();
    const first = controller.confirm(true);
    expect(controller.getSnapshot().submitting).toBe(true);
    expect(await controller.confirm(true)).toBeNull();
    expect(operations.confirm).toHaveBeenCalledOnce();
    finish({ ...result, financialComposition: { ...result.financialComposition, newContractualTotal: '999.99' } });
    expect(await first).toBe('SUCCESS');
    expect(controller.getSnapshot()).toMatchObject({ result: { financialComposition: { newContractualTotal: '999.99' } },
      prepared: null, submitting: false });
    expect(await controller.confirm(true)).toBeNull();
    expect(operations.confirm).toHaveBeenCalledOnce();
  });

  it('reuses the same key and payload for a manual retry after an uncertain network or server response', async () => {
    const { controller, operations, newKey } = setup();
    controller.prepare(review());
    vi.mocked(operations.confirm).mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new HttpApiError(500, 'private'));
    expect(await controller.confirm(true)).toBe('NETWORK');
    expect(controller.getSnapshot()).toMatchObject({ submitting: false, failure: 'NETWORK', result: null });
    expect(await controller.confirm(true)).toBe('SERVER');
    expect(await controller.confirm(true)).toBe('SUCCESS');
    expect(operations.confirm).toHaveBeenCalledTimes(3);
    expect(vi.mocked(operations.confirm).mock.calls.map(([body]) => body)).toEqual([reviewWithKey('key-1'), reviewWithKey('key-1'), reviewWithKey('key-1')]);
    expect(newKey).toHaveBeenCalledOnce();
  });

  it.each(['STALE_DATA', 'ALREADY_REFINANCED', 'IDEMPOTENCY_CONFLICT', 'CONCURRENT_REFINANCING',
    'HISTORICAL_BALANCE_CONFLICT'] as const)(
    'classifies %s without an automatic retry or a replacement key', async (code) => {
      const { controller, operations, newKey } = setup();
      controller.prepare(review());
      vi.mocked(operations.confirm).mockRejectedValueOnce(new HttpApiError(409, 'private', code));
      expect(await controller.confirm(true)).toBe(code);
      expect(controller.getSnapshot()).toMatchObject({ failure: code, prepared: { request: { idempotencyKey: 'key-1' } } });
      expect(operations.confirm).toHaveBeenCalledOnce();
      expect(newKey).toHaveBeenCalledOnce();
      controller.invalidate();
      expect(controller.getSnapshot()).toMatchObject({ prepared: null, failure: null });
    });

  it.each([400, 403, 404, 409, 503])('sanitizes HTTP %s into a controlled failure and preserves the draft', async (status) => {
    const { controller, operations } = setup(); controller.prepare(review());
    vi.mocked(operations.confirm).mockRejectedValueOnce(new HttpApiError(status, 'SQL trace'));
    expect(await controller.confirm(true)).toBe(({ 400: 'INVALID', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 503: 'SERVER' } as Record<number, string>)[status]);
    expect(controller.getSnapshot().prepared!.request.idempotencyKey).toBe('key-1');
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('SQL trace');
  });

  it('clears the prepared operation and receipt for a new wizard without POST on reset', async () => {
    const { controller, operations, newKey } = setup();
    controller.prepare(review()); await controller.confirm(true); controller.reset();
    expect(controller.getSnapshot()).toEqual({ prepared: null, submitting: false, failure: null, result: null });
    controller.prepare(review());
    expect(controller.getSnapshot().prepared!.request.idempotencyKey).toBe('key-2');
    expect(newKey).toHaveBeenCalledTimes(2);
    expect(operations.confirm).toHaveBeenCalledOnce();
  });
});

function reviewWithKey(idempotencyKey: string) { return { ...review().request, idempotencyKey }; }
