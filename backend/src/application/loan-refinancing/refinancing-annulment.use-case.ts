import { createHash } from 'crypto';
import { cents } from '../../domain/loan/loan-financial-integrity';
import { ClosedFinancialPeriodError } from '../../domain/financial-close/financial-close.errors';
import type { RetroactivePeriodGuard } from '../financial-close/retroactive-period.guard';
import type {
  CreateRefinancingAnnulment,
  RefinancingAnnulmentEligibility,
  RefinancingAnnulmentListQuery,
  RefinancingAnnulmentReason,
  RefinancingAnnulmentSnapshot,
  RefinancingAnnulmentStore,
  RefinancingAnnulmentType,
} from './refinancing-annulment.port';

export class RefinancingAnnulmentValidationError extends Error {}
export class RefinancingAnnulmentNotFoundError extends Error {}
export class RefinancingAnnulmentConflictError extends Error {
  constructor(message: string, readonly reasonCode = 'REFINANCING_ANNULMENT_CONFLICT') { super(message); }
}

export type AnnulRefinancingRequest = {
  annulmentType: RefinancingAnnulmentType;
  disbursementResolution?: 'NOT_DELIVERED' | 'RETURNED_IN_FULL';
  effectiveDate?: string;
  refundPaymentMethodId?: string;
  reason: string;
  idempotencyKey: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[\x21-\x7e]{1,128}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string) => {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reason = (code: string, message: string): RefinancingAnnulmentReason => ({ code, message });
const dedupe = (reasons: RefinancingAnnulmentReason[]) => [...new Map(reasons.map((item) => [item.code, item])).values()];

function paymentIntegrityReasons(snapshot: RefinancingAnnulmentSnapshot): RefinancingAnnulmentReason[] {
  const reasons: RefinancingAnnulmentReason[] = [];
  for (const payment of snapshot.payments) {
    if (payment.status === 'VALID') {
      reasons.push(reason('VALID_SUCCESSOR_PAYMENT', 'The successor loan has a valid payment.'));
      continue;
    }
    const reconciles = payment.annulmentCount === 1 && payment.annulmentType !== null &&
      payment.applicationCount > 0 && payment.applicationsValid && cents(payment.applicationAmount) === cents(payment.amount) &&
      cents(payment.principalApplied) + cents(payment.interestApplied) === cents(payment.amount) &&
      payment.originalCashCount === 1 && payment.originalCashDirection === 'INFLOW' &&
      payment.originalCashConcept === 'CUSTOMER_PAYMENT' && payment.originalCashMethodId !== null &&
      payment.reversalCount === 1 && payment.reversalDirection === 'OUTFLOW' && payment.reversalConcept === 'REVERSAL' &&
      payment.reversalEffectiveDate !== null && payment.reversalMethodId === payment.originalCashMethodId &&
      cents(payment.originalCashAmount ?? '-1') === cents(payment.amount) &&
      cents(payment.reversalAmount ?? '-1') === cents(payment.amount);
    if (!reconciles) reasons.push(reason('INCONSISTENT_ANNULLED_PAYMENT',
      'Every annulled successor payment must have one complete annulment and cash reversal.'));
  }
  return dedupe(reasons);
}

function disbursementReasons(snapshot: RefinancingAnnulmentSnapshot): RefinancingAnnulmentReason[] {
  if (cents(snapshot.newMoneyDisbursed) === 0n) return snapshot.disbursements.length === 0 ? [] :
    [reason('INCONSISTENT_NEW_MONEY', 'A zero-new-money refinancing must not have a disbursement or cash movement.')];
  if (snapshot.disbursements.length !== 1) return [reason('INCONSISTENT_NEW_MONEY',
    'Positive new money must have one receiving-method disbursement and cash outflow.')];
  const row = snapshot.disbursements[0];
  return cents(row.amount) === cents(snapshot.newMoneyDisbursed) && row.date === snapshot.refinancingDate &&
    row.cashMovementId !== null && cents(row.cashAmount ?? '-1') === cents(snapshot.newMoneyDisbursed) &&
    row.cashDate === snapshot.refinancingDate && row.cashMethodId === row.methodId && row.cashDirection === 'OUTFLOW' &&
    row.cashConcept === 'REFINANCING_NEW_MONEY_DISBURSEMENT' ? [] : [reason('INCONSISTENT_NEW_MONEY',
      'The refinancing new-money disbursement does not reconcile with cash.')];
}

export function evaluateRefinancingAnnulmentEligibility(snapshot: RefinancingAnnulmentSnapshot,
  cashRefundEffectiveDate?: string): RefinancingAnnulmentEligibility {
  const global: RefinancingAnnulmentReason[] = [];
  if (snapshot.status !== 'CONFIRMED') global.push(reason('REFINANCING_NOT_CONFIRMED', 'Only a confirmed refinancing can be annulled.'));
  if (snapshot.originStatus !== 'REFINANCED') global.push(reason('ORIGIN_NOT_REFINANCED', 'The origin loan must still be refinanced.'));
  if (snapshot.successorStatus !== 'ACTIVE') global.push(reason('SUCCESSOR_NOT_ACTIVE', 'The successor loan must be active.'));
  if (snapshot.activeChildRefinancingCount !== 0) global.push(reason('ACTIVE_CHILD_REFINANCING',
    'The successor loan has an active child refinancing.'));
  global.push(...paymentIntegrityReasons(snapshot));
  if (cents(snapshot.originPendingPlanAmount) !== cents(snapshot.outstandingPrincipalTransferred) +
    cents(snapshot.capitalizedOutstandingInterest) || cents(snapshot.successorPendingPlanAmount) !== cents(snapshot.newContractualTotal)) {
    global.push(reason('INCONSISTENT_PAYMENT_PLANS', 'The origin or successor payment plan does not reconcile.'));
  }
  global.push(...disbursementReasons(snapshot));
  const common = dedupe(global);
  const correction = [...common];
  const refund = [...common];
  for (const payment of snapshot.payments.filter((item) => item.status === 'ANNULLED')) {
    if (payment.annulmentType === 'CASH_REFUND') correction.push(reason('CASH_REFUND_PAYMENT_INCOMPATIBLE',
      'A successor cash-refund payment is incompatible with data-correction annulment.'));
    if (payment.reversalEffectiveDate && payment.reversalEffectiveDate > snapshot.refinancingDate) {
      correction.push(reason('PAYMENT_REVERSAL_AFTER_EFFECTIVE_DATE',
        'A successor payment reversal occurs after the refinancing annulment effective date.'));
    }
    if (cashRefundEffectiveDate && payment.reversalEffectiveDate && payment.reversalEffectiveDate > cashRefundEffectiveDate) {
      refund.push(reason('PAYMENT_REVERSAL_AFTER_EFFECTIVE_DATE',
        'A successor payment reversal occurs after the refinancing annulment effective date.'));
    }
  }
  if (cashRefundEffectiveDate && cashRefundEffectiveDate < snapshot.refinancingDate)
    refund.push(reason('EFFECTIVE_DATE_BEFORE_REFINANCING', 'The cash-refund effective date cannot precede the refinancing.'));
  if (cashRefundEffectiveDate && cashRefundEffectiveDate > new Date().toISOString().slice(0, 10))
    refund.push(reason('EFFECTIVE_DATE_IN_FUTURE', 'The cash-refund effective date cannot be in the future.'));
  const correctionReasons = dedupe(correction), refundReasons = dedupe(refund);
  return { eligible: correctionReasons.length === 0 || refundReasons.length === 0, reasons: common,
    types: {
      DATA_CORRECTION: { eligible: correctionReasons.length === 0, requiresEffectiveDate: false, reasons: correctionReasons },
      CASH_REFUND: { eligible: refundReasons.length === 0, requiresEffectiveDate: true, reasons: refundReasons },
    } };
}

const SORTS = ['refinancingDate', 'effectiveDate', 'customer', 'originLoan', 'successorLoan',
  'annulmentType', 'createdBy', 'newMoneyDisbursed'] as const;

function listQuery(raw: { search?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number;
  sortBy?: RefinancingAnnulmentListQuery['sortBy']; sortDir?: RefinancingAnnulmentListQuery['sortDir'] }) {
  const page = raw.page ?? 1, pageSize = raw.pageSize ?? 20;
  if (raw.search !== undefined && (typeof raw.search !== 'string' || raw.search.length > 120) ||
    raw.dateFrom !== undefined && !validDate(raw.dateFrom) || raw.dateTo !== undefined && !validDate(raw.dateTo) ||
    raw.dateFrom && raw.dateTo && raw.dateFrom > raw.dateTo || !Number.isSafeInteger(page) || page < 1 ||
    ![10, 20, 50].includes(pageSize) || raw.sortBy !== undefined && !SORTS.includes(raw.sortBy) ||
    raw.sortDir !== undefined && !['asc', 'desc'].includes(raw.sortDir))
    throw new RefinancingAnnulmentValidationError('The list filters are invalid.');
  const query: RefinancingAnnulmentListQuery = { search: raw.search?.replace(/\s+/g, ' ').trim() || undefined,
    dateFrom: raw.dateFrom, dateTo: raw.dateTo, page, pageSize: pageSize as 10 | 20 | 50,
    sortBy: raw.sortBy, sortDir: raw.sortDir };
  return query;
}

export class LoanRefinancingAnnulmentUseCase {
  constructor(private readonly store: RefinancingAnnulmentStore, private readonly closedPeriods?: RetroactivePeriodGuard) {}

  async annulled(raw: { search?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number;
    sortBy?: RefinancingAnnulmentListQuery['sortBy']; sortDir?: RefinancingAnnulmentListQuery['sortDir'] }) {
    const query = listQuery(raw); const result = await this.store.listAnnulled(query);
    return { ...result, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(result.total / query.pageSize) };
  }

  async annullable(raw: { search?: string; dateFrom?: string; dateTo?: string; effectiveDate?: string;
    page?: number; pageSize?: number; sortBy?: RefinancingAnnulmentListQuery['sortBy'];
    sortDir?: RefinancingAnnulmentListQuery['sortDir'] }) {
    if (raw.effectiveDate !== undefined && !validDate(raw.effectiveDate))
      throw new RefinancingAnnulmentValidationError('The effective date is invalid.');
    const query = listQuery(raw); const result = await this.store.listCandidates(query);
    const closedThrough = await this.closedPeriods?.closedThrough();
    return { items: result.items.map((item) => {
      const eligibility = evaluateRefinancingAnnulmentEligibility(item, raw.effectiveDate);
      if (closedThrough && item.refinancingDate <= closedThrough) {
        eligibility.types.DATA_CORRECTION.reasons = dedupe([...eligibility.types.DATA_CORRECTION.reasons,
          reason('CLOSED_FINANCIAL_PERIOD', 'The original refinancing date belongs to a closed financial period.')]);
        eligibility.types.DATA_CORRECTION.eligible = false;
      }
      if (closedThrough && raw.effectiveDate && raw.effectiveDate <= closedThrough) {
        eligibility.types.CASH_REFUND.reasons = dedupe([...eligibility.types.CASH_REFUND.reasons,
          reason('CLOSED_FINANCIAL_PERIOD', 'The cash-refund effective date belongs to a closed financial period.')]);
        eligibility.types.CASH_REFUND.eligible = false;
      }
      eligibility.eligible = eligibility.types.DATA_CORRECTION.eligible || eligibility.types.CASH_REFUND.eligible;
      return { ...item, eligibility };
    }), total: result.total,
      page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(result.total / query.pageSize) };
  }

  paymentMethods() { return this.store.listActivePaymentMethods(); }

  async detail(annulmentId: string) {
    if (!UUID.test(annulmentId)) throw new RefinancingAnnulmentValidationError('The annulment identifier is invalid.');
    const detail = await this.store.detail(annulmentId.toLowerCase());
    if (!detail) throw new RefinancingAnnulmentNotFoundError('The refinancing annulment does not exist.');
    return detail;
  }

  async annul(refinancingId: string, raw: AnnulRefinancingRequest, actorId: string) {
    if (!UUID.test(refinancingId) || !UUID.test(actorId) || !raw ||
      !['DATA_CORRECTION', 'CASH_REFUND'].includes(raw.annulmentType) || typeof raw.reason !== 'string' ||
      raw.reason.trim().length < 8 || raw.reason.trim().length > 500 || !KEY.test(raw.idempotencyKey ?? '') ||
      raw.effectiveDate !== undefined && !validDate(raw.effectiveDate) ||
      raw.refundPaymentMethodId !== undefined && !UUID.test(raw.refundPaymentMethodId) ||
      raw.disbursementResolution !== undefined &&
        !['NOT_DELIVERED', 'RETURNED_IN_FULL'].includes(raw.disbursementResolution) ||
      raw.annulmentType === 'CASH_REFUND' && !raw.effectiveDate ||
      raw.annulmentType === 'DATA_CORRECTION' && (raw.effectiveDate !== undefined || raw.refundPaymentMethodId !== undefined)) {
      throw new RefinancingAnnulmentValidationError('The refinancing annulment request is invalid.');
    }
    const normalized = { refinancingId: refinancingId.toLowerCase(), actorId: actorId.toLowerCase(),
      annulmentType: raw.annulmentType, effectiveDate: raw.effectiveDate,
      disbursementResolution: raw.disbursementResolution,
      refundPaymentMethodId: raw.refundPaymentMethodId?.toLowerCase(), reason: raw.reason.trim(),
      idempotencyKey: raw.idempotencyKey };
    const requestFingerprint = fingerprint(normalized);
    return this.store.transaction(async (tx) => {
      const existing = await tx.findByKey(normalized.idempotencyKey);
      if (existing) {
        if (existing.refinancingId !== normalized.refinancingId || existing.fingerprint !== requestFingerprint)
          throw new RefinancingAnnulmentConflictError('The idempotency key was used with different data.', 'IDEMPOTENCY_CONFLICT');
        const replay = await tx.detail(existing.annulmentId);
        if (!replay) throw new RefinancingAnnulmentConflictError('The persisted annulment is incomplete.', 'ANNULMENT_INTEGRITY_ERROR');
        return replay;
      }
      const state = await tx.lockSnapshot(normalized.refinancingId);
      if (!state) throw new RefinancingAnnulmentNotFoundError('The refinancing does not exist.');
      if (await tx.hasPendingPrecollection([state.originLoanId, state.successorLoanId])) {
        throw new RefinancingAnnulmentConflictError('A related loan has pending collector precollections.', 'LOAN_HAS_PENDING_PRECOLLECTIONS');
      }
      const hasNewMoney = cents(state.newMoneyDisbursed) > 0n;
      const requiredResolution = hasNewMoney
        ? normalized.annulmentType === 'DATA_CORRECTION' ? 'NOT_DELIVERED' : 'RETURNED_IN_FULL'
        : undefined;
      if (normalized.disbursementResolution !== requiredResolution)
        throw new RefinancingAnnulmentValidationError(hasNewMoney
          ? `disbursementResolution must be ${requiredResolution} for this annulment.`
          : 'disbursementResolution is not allowed without new money.');
      const effectiveDate = normalized.annulmentType === 'DATA_CORRECTION' ? state.refinancingDate : normalized.effectiveDate!;
      if (effectiveDate < state.refinancingDate || effectiveDate > new Date().toISOString().slice(0, 10))
        throw new RefinancingAnnulmentValidationError('The effective date is outside the refinancing period.');
      const eligibility = evaluateRefinancingAnnulmentEligibility(state, effectiveDate);
      const selected = eligibility.types[normalized.annulmentType];
      if (!selected.eligible) throw new RefinancingAnnulmentConflictError(selected.reasons[0].message, selected.reasons[0].code);
      const requiresRefundMethod = normalized.annulmentType === 'CASH_REFUND' && hasNewMoney;
      if (requiresRefundMethod !== Boolean(normalized.refundPaymentMethodId))
        throw new RefinancingAnnulmentValidationError('refundPaymentMethodId is required only for CASH_REFUND with positive new money.');
      if (normalized.refundPaymentMethodId && !await tx.lockActivePaymentMethod(normalized.refundPaymentMethodId))
        throw new RefinancingAnnulmentValidationError('refundPaymentMethodId must reference an active payment method.');
      try { await this.closedPeriods?.assertDateAllowed(effectiveDate, tx.context); }
      catch (error) {
        if (error instanceof ClosedFinancialPeriodError) throw new RefinancingAnnulmentConflictError(error.message, 'CLOSED_FINANCIAL_PERIOD');
        throw error;
      }
      const input: CreateRefinancingAnnulment = { refinancingId: normalized.refinancingId,
        annulmentType: normalized.annulmentType, disbursementResolution: requiredResolution ?? 'NOT_DELIVERED',
        effectiveDate, reason: normalized.reason,
        actorId: normalized.actorId, refundPaymentMethodId: normalized.refundPaymentMethodId ?? null,
        idempotencyKey: normalized.idempotencyKey,
        idempotencyFingerprint: requestFingerprint };
      const created = await tx.create(input);
      if (!created) throw new RefinancingAnnulmentConflictError('The refinancing changed concurrently.', 'CONCURRENT_ANNULMENT');
      if (created.refinancingId !== input.refinancingId || created.annulmentType !== input.annulmentType ||
        created.effectiveDate !== input.effectiveDate || created.originLoan.status !== 'ACTIVE' ||
        created.successorLoan.status !== 'ANNULLED' ||
        hasNewMoney !== (created.cashMovementId !== null)) {
        throw new RefinancingAnnulmentConflictError('The refinancing annulment does not reconcile.', 'ANNULMENT_INTEGRITY_ERROR');
      }
      return created;
    });
  }
}
