import { ClosedFinancialPeriodError } from '../src/domain/financial-close/financial-close.errors';
import {
  LoanRefinancingAnnulmentUseCase,
  RefinancingAnnulmentConflictError,
  RefinancingAnnulmentValidationError,
  evaluateRefinancingAnnulmentEligibility,
} from '../src/application/loan-refinancing/refinancing-annulment.use-case';
import type {
  RefinancingAnnulmentSnapshot,
  RefinancingAnnulmentStore,
  RefinancingAnnulmentTransaction,
} from '../src/application/loan-refinancing/refinancing-annulment.port';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const refinancingId = uuid(1), actorId = uuid(2), methodId = uuid(3), annulmentId = uuid(4);

const snapshot = (overrides: Partial<RefinancingAnnulmentSnapshot> = {}): RefinancingAnnulmentSnapshot => ({
  refinancingId, status: 'CONFIRMED', refinancingDate: '2026-09-10', originLoanId: uuid(10),
  originLoanNumber: '100', originStatus: 'REFINANCED', successorLoanId: uuid(11), successorLoanNumber: '101',
  successorStatus: 'ACTIVE', customer: { id: uuid(12), fullName: 'Customer One', identification: 'ID-1' },
  outstandingPrincipalTransferred: '80.00', capitalizedOutstandingInterest: '20.00',
  newMoneyDisbursed: '0.00', newContractualTotal: '100.00', originPendingPlanAmount: '100.00',
  successorPendingPlanAmount: '100.00', activeChildRefinancingCount: 0, disbursements: [], payments: [],
  ...overrides,
});

const reconciledAnnulledPayment = (type: 'DATA_CORRECTION' | 'CASH_REFUND' = 'DATA_CORRECTION') => ({
  id: uuid(20), status: 'ANNULLED' as const, amount: '10.00', principalApplied: '10.00', interestApplied: '0.00',
  paymentDate: '2026-09-11', applicationCount: 1, applicationAmount: '10.00', applicationsValid: true,
  annulmentCount: 1, annulmentType: type, originalCashCount: 1, originalCashAmount: '10.00',
  originalCashMethodId: methodId, originalCashDirection: 'INFLOW', originalCashConcept: 'CUSTOMER_PAYMENT',
  reversalCount: 1, reversalAmount: '10.00', reversalMethodId: methodId, reversalDirection: 'OUTFLOW',
  reversalConcept: 'REVERSAL', reversalEffectiveDate: '2026-09-12',
});

function harness(value = snapshot()) {
  const created = { annulmentId, refinancingId, annulmentType: 'DATA_CORRECTION' as const,
    effectiveDate: '2026-09-10', reason: 'Incorrect refinancing', annulledAt: new Date('2026-10-08T10:00:00Z'),
    createdByUserId: actorId, refundPaymentMethodId: null,
    cashMovementId: value.newMoneyDisbursed === '0.00' ? null : uuid(31),
    originLoan: { id: value.originLoanId, loanNumber: value.originLoanNumber, status: 'ACTIVE' as const },
    successorLoan: { id: value.successorLoanId, loanNumber: value.successorLoanNumber, status: 'ANNULLED' as const } };
  const tx = {
    context: {}, lockSnapshot: jest.fn(async (_id: string) => value),
    hasPendingPrecollection: jest.fn(async (_ids: string[]) => false),
    lockActivePaymentMethod: jest.fn(async (_id: string) => true),
    findByKey: jest.fn(async (_key: string) => undefined),
    detail: jest.fn(async (_id: string) => created), create: jest.fn(async (_input: unknown) => created),
  } as unknown as jest.Mocked<RefinancingAnnulmentTransaction>;
  const store = {
    transaction: async <T>(work: (current: RefinancingAnnulmentTransaction) => Promise<T>) => work(tx),
    listAnnulled: jest.fn(), listCandidates: jest.fn(), listActivePaymentMethods: jest.fn(async () => []),
    detail: jest.fn(async (_id: string) => created),
  } as unknown as jest.Mocked<RefinancingAnnulmentStore>;
  return { tx, store, created, useCase: new LoanRefinancingAnnulmentUseCase(store) };
}

describe('refinancing annulment command and eligibility', () => {
  it('reports global and per-type eligibility with stable understandable blockers', () => {
    expect(evaluateRefinancingAnnulmentEligibility(snapshot(), '2026-10-08')).toMatchObject({
      eligible: true, reasons: [], types: { DATA_CORRECTION: { eligible: true }, CASH_REFUND: { eligible: true } },
    });
    const blocked = evaluateRefinancingAnnulmentEligibility(snapshot({ successorStatus: 'CANCELLED',
      activeChildRefinancingCount: 1 }), '2026-10-08');
    expect(blocked.eligible).toBe(false);
    expect(blocked.reasons).toEqual(expect.arrayContaining([
      { code: 'SUCCESSOR_NOT_ACTIVE', message: 'The successor loan must be active.' },
      { code: 'ACTIVE_CHILD_REFINANCING', message: 'The successor loan has an active child refinancing.' },
    ]));
    expect(blocked.types.DATA_CORRECTION.eligible).toBe(false);
    expect(blocked.types.CASH_REFUND.eligible).toBe(false);
  });

  it('accepts fully reconciled ANNULLED payments but rejects VALID or incomplete payment facts', () => {
    const accepted = snapshot({ payments: [reconciledAnnulledPayment()] });
    expect(evaluateRefinancingAnnulmentEligibility(accepted, '2026-10-08').eligible).toBe(true);
    const valid = snapshot({ payments: [{ ...reconciledAnnulledPayment(), status: 'VALID' }] });
    expect(evaluateRefinancingAnnulmentEligibility(valid, '2026-10-08').reasons[0].code).toBe('VALID_SUCCESSOR_PAYMENT');
    const incomplete = snapshot({ payments: [{ ...reconciledAnnulledPayment(), reversalAmount: '9.99' }] });
    expect(evaluateRefinancingAnnulmentEligibility(incomplete, '2026-10-08').reasons[0].code)
      .toBe('INCONSISTENT_ANNULLED_PAYMENT');
  });

  it('rejects a DATA_CORRECTION edge containing a successor CASH_REFUND payment or a late reversal', () => {
    const cashRefund = snapshot({ payments: [reconciledAnnulledPayment('CASH_REFUND')] });
    const result = evaluateRefinancingAnnulmentEligibility(cashRefund, '2026-10-08');
    expect(result.types.DATA_CORRECTION.reasons[0].code).toBe('CASH_REFUND_PAYMENT_INCOMPATIBLE');
    expect(result.types.CASH_REFUND.eligible).toBe(true);
    const late = snapshot({ payments: [{ ...reconciledAnnulledPayment(), reversalEffectiveDate: '2026-10-09' }] });
    expect(evaluateRefinancingAnnulmentEligibility(late, '2026-10-08').types.CASH_REFUND.reasons[0].code)
      .toBe('PAYMENT_REVERSAL_AFTER_EFFECTIVE_DATE');
  });

  it('reports proposed CASH_REFUND dates outside the refinancing lifecycle', () => {
    expect(evaluateRefinancingAnnulmentEligibility(snapshot(), '2026-09-09').types.CASH_REFUND.reasons)
      .toContainEqual(expect.objectContaining({ code: 'EFFECTIVE_DATE_BEFORE_REFINANCING' }));
    expect(evaluateRefinancingAnnulmentEligibility(snapshot(), '2999-01-01').types.CASH_REFUND.reasons)
      .toContainEqual(expect.objectContaining({ code: 'EFFECTIVE_DATE_IN_FUTURE' }));
  });

  it('rejects impossible calendar dates as validation errors', async () => {
    const { useCase } = harness();
    await expect(useCase.annullable({ effectiveDate: '2026-99-99', page: 1, pageSize: 20 }))
      .rejects.toBeInstanceOf(RefinancingAnnulmentValidationError);
  });

  it('includes closed-period blockers in candidate eligibility by modality', async () => {
    const { store } = harness();
    store.listCandidates.mockResolvedValueOnce({ items: [snapshot()], total: 1 });
    const guard = { closedThrough: jest.fn(async () => '2026-09-30') };
    const useCase = new LoanRefinancingAnnulmentUseCase(store, guard as never);
    const result = await useCase.annullable({ effectiveDate: '2026-10-08', page: 1, pageSize: 20 });
    expect(result.items[0].eligibility.types.DATA_CORRECTION).toMatchObject({ eligible: false,
      reasons: expect.arrayContaining([expect.objectContaining({ code: 'CLOSED_FINANCIAL_PERIOD' })]) });
    expect(result.items[0].eligibility.types.CASH_REFUND.eligible).toBe(true);
  });

  it('annuls atomically at the original date and replays an identical idempotency key', async () => {
    const { useCase, tx, created } = harness();
    const input = { annulmentType: 'DATA_CORRECTION' as const, reason: '  Incorrect refinancing  ',
      idempotencyKey: 'annul-refi-1' };
    await expect(useCase.annul(refinancingId, input, actorId)).resolves.toEqual(created);
    expect(tx.create).toHaveBeenCalledWith(expect.objectContaining({ refinancingId, effectiveDate: '2026-09-10',
      reason: 'Incorrect refinancing', refundPaymentMethodId: null }));
    const createFingerprint = tx.create.mock.calls[0][0].idempotencyFingerprint;
    tx.findByKey.mockResolvedValueOnce({ annulmentId, refinancingId, fingerprint: createFingerprint });
    await expect(useCase.annul(refinancingId, input, actorId)).resolves.toEqual(created);
    expect(tx.create).toHaveBeenCalledTimes(1);
    await expect(useCase.annul(refinancingId, { ...input, disbursementResolution: 'NOT_DELIVERED',
      idempotencyKey: 'zero-money-resolution' }, actorId)).rejects.toMatchObject({
      message: 'disbursementResolution is not allowed without new money.',
    });
  });

  it('requires an open explicit CASH_REFUND date and receiving method for positive new money', async () => {
    const value = snapshot({ newMoneyDisbursed: '50.00', disbursements: [{ id: uuid(30), amount: '50.00',
      date: '2026-09-10', methodId, cashMovementId: uuid(31), cashAmount: '50.00', cashDate: '2026-09-10',
      cashMethodId: methodId, cashDirection: 'OUTFLOW', cashConcept: 'REFINANCING_NEW_MONEY_DISBURSEMENT' }] });
    const guard = { assertDateAllowed: jest.fn(async (date: string) => {
      if (date === '2026-10-01') throw new ClosedFinancialPeriodError('The financial period is closed.');
    }) };
    const { store } = harness(value);
    const useCase = new LoanRefinancingAnnulmentUseCase(store, guard as never);
    await expect(useCase.annul(refinancingId, { annulmentType: 'CASH_REFUND', reason: 'Customer refund',
      idempotencyKey: 'refund-1' }, actorId)).rejects.toBeInstanceOf(RefinancingAnnulmentValidationError);
    await expect(useCase.annul(refinancingId, { annulmentType: 'CASH_REFUND', effectiveDate: '2026-10-01',
      disbursementResolution: 'RETURNED_IN_FULL', reason: 'Customer refund', idempotencyKey: 'refund-1' }, actorId)).rejects.toMatchObject({
      message: 'refundPaymentMethodId is required only for CASH_REFUND with positive new money.',
    });
    await expect(useCase.annul(refinancingId, { annulmentType: 'CASH_REFUND', effectiveDate: '2026-10-01',
      disbursementResolution: 'RETURNED_IN_FULL', refundPaymentMethodId: uuid(40), reason: 'Customer refund',
      idempotencyKey: 'refund-1' }, actorId))
      .rejects.toMatchObject({ reasonCode: 'CLOSED_FINANCIAL_PERIOD' });
    expect(guard.assertDateAllowed).toHaveBeenCalledWith('2026-10-01', expect.anything());

    const inactive = harness(value);
    inactive.tx.lockActivePaymentMethod.mockResolvedValueOnce(false);
    await expect(inactive.useCase.annul(refinancingId, { annulmentType: 'CASH_REFUND', effectiveDate: '2026-10-08',
      disbursementResolution: 'RETURNED_IN_FULL', refundPaymentMethodId: uuid(40), reason: 'Customer refund',
      idempotencyKey: 'inactive-method' }, actorId)).rejects.toMatchObject({
      message: 'refundPaymentMethodId must reference an active payment method.',
    });
    expect(inactive.tx.create).not.toHaveBeenCalled();
  });

  it('requires a no-delivery attestation before compensating positive new money in DATA_CORRECTION', async () => {
    const value = snapshot({ newMoneyDisbursed: '50.00', disbursements: [{ id: uuid(30), amount: '50.00',
      date: '2026-09-10', methodId, cashMovementId: uuid(31), cashAmount: '50.00', cashDate: '2026-09-10',
      cashMethodId: methodId, cashDirection: 'OUTFLOW', cashConcept: 'REFINANCING_NEW_MONEY_DISBURSEMENT' }] });
    const { useCase, tx, created } = harness(value);
    await expect(useCase.annul(refinancingId, { annulmentType: 'DATA_CORRECTION', reason: 'Incorrect refinancing',
      idempotencyKey: 'correction-positive-money' }, actorId)).rejects.toMatchObject({
      message: 'disbursementResolution must be NOT_DELIVERED for this annulment.',
    });
    await expect(useCase.annul(refinancingId, { annulmentType: 'DATA_CORRECTION', reason: 'Incorrect refinancing',
      disbursementResolution: 'NOT_DELIVERED', idempotencyKey: 'correction-positive-money' }, actorId)).resolves.toEqual(created);
    expect(tx.create).toHaveBeenCalledWith(expect.objectContaining({ annulmentType: 'DATA_CORRECTION',
      disbursementResolution: 'NOT_DELIVERED', refundPaymentMethodId: null }));
  });

  it('revalidates blockers after locking and writes nothing on conflict', async () => {
    const { useCase, tx } = harness(snapshot({ payments: [{ ...reconciledAnnulledPayment(), status: 'VALID' }] }));
    await expect(useCase.annul(refinancingId, { annulmentType: 'DATA_CORRECTION', reason: 'Incorrect refinancing',
      idempotencyKey: 'blocked-1' }, actorId)).rejects.toBeInstanceOf(RefinancingAnnulmentConflictError);
    expect(tx.create).not.toHaveBeenCalled();
  });
});
