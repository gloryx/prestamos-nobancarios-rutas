import { createHash } from 'crypto';
import { cents } from '../../domain/loan/loan-financial-integrity';
import { evaluateRefinancing, money, refinancingAmounts, type RefinancingSnapshot } from '../../domain/loan-refinancing/refinancing-finance';
import type { RefinancingAmounts, RefinancingOperation, RefinancingStore, RefinancingSearchQuery, RefinancingListQuery, RefinancingChainGraph } from './refinancing.port';
import { buildRefinancingChains, RefinancingChainIntegrityError } from './refinancing-chain';
import { paymentPlanDateIssue } from '../../domain/payment/payment-plan-dates';
import type { RetroactivePeriodGuard } from '../financial-close/retroactive-period.guard';
import { ClosedFinancialPeriodError } from '../../domain/financial-close/financial-close.errors';

export class RefinancingValidationError extends Error {}
export class RefinancingConflictError extends Error {
  constructor(message: string, readonly reasonCode = 'REFINANCING_CONFLICT') { super(message); }
}
export class RefinancingNotFoundError extends Error {}

export type RefinancingRequest = {
  originLoanId: string; refinancingDate: string; newMoney: string; disbursementPaymentMethodId?: string;
  newInterestAmount: string; paymentFrequencyId: string; preferredPaymentMethodId: string;
  observations?: string; plan: Array<{ sequence: number; dueDate: string; pendingAmount: string }>;
  baseline: string; idempotencyKey: string;
};

const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const KEY = /^[\x21-\x7e]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CENTS = 999999999999999999n;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reasonMessages: Record<string, string> = {
  LOAN_NOT_ACTIVE: 'Only active loans can be refinanced.',
  FINANCIAL_INTEGRITY_ERROR: 'The loan financial amounts do not reconcile.',
  NO_OUTSTANDING_BALANCE: 'The loan has no outstanding debt.',
  MINIMUM_PAYMENT_NOT_MET: 'Valid payments have not reached the minimum required for refinancing.',
};

export function refinancingBaseline(snapshot: RefinancingSnapshot): string {
  return hash({ loanId: snapshot.id, status: snapshot.status, principal: money(cents(snapshot.principal)), interestAmount: money(cents(snapshot.interestAmount)),
    totalAmount: money(cents(snapshot.totalAmount)), startDate: snapshot.startDate,
    lastValidPaymentDate: snapshot.lastValidPaymentDate,
    paidAmount: money(cents(snapshot.totals.paidAmount)), paidPrincipal: money(cents(snapshot.totals.paidPrincipal)),
    paidInterest: money(cents(snapshot.totals.paidInterest)), invalidCount: snapshot.totals.invalidCount,
    plan: snapshot.plan.map((row) => [row.id, row.sequence, row.dueDate, money(cents(row.pendingAmount))]),
  });
}

function checkedSnapshot(snapshot: RefinancingSnapshot) {
  if (![snapshot.principal, snapshot.interestAmount, snapshot.totalAmount, snapshot.totals.paidAmount,
    snapshot.totals.paidPrincipal, snapshot.totals.paidInterest].every((value) => typeof value === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(value))
    || !Number.isSafeInteger(snapshot.totals.invalidCount) || !Array.isArray(snapshot.plan)
    || snapshot.plan.some((row) => !row.id || !validDate(row.dueDate) || !Number.isSafeInteger(row.sequence) ||
      typeof row.pendingAmount !== 'string' || !MONEY.test(row.pendingAmount))) {
    throw new RefinancingConflictError('Loan financial data is unavailable.', 'FINANCIAL_INTEGRITY_ERROR');
  }
  return evaluateRefinancing(snapshot);
}

function previewResponse(snapshot: RefinancingSnapshot) {
  const result = checkedSnapshot(snapshot);
  const remaining = result.minimumRequiredPayment - result.integrity.validPaidAmount;
  const reasonCode = result.reasons[0] ?? null;
  return { loanId: snapshot.id, loanNumber: snapshot.loanNumber, customer: { id: snapshot.customerId,
    name: snapshot.customerName, identification: snapshot.identification }, status: snapshot.status, startDate: snapshot.startDate,
    principal: snapshot.principal, interestAmount: snapshot.interestAmount, totalAmount: snapshot.totalAmount,
    paidAmount: money(result.integrity.validPaidAmount), paidPrincipal: money(result.integrity.validPrincipalApplied),
    paidInterest: money(result.integrity.validInterestApplied), outstandingPrincipal: money(result.integrity.outstandingPrincipal),
    outstandingInterest: money(result.integrity.outstandingInterest), financialBalance: money(result.integrity.financialBalance),
    pendingPlanAmount: money(result.integrity.pendingPlanAmount), minimumRequiredPayment: money(result.minimumRequiredPayment),
    remainingToMinimum: money(remaining > 0n ? remaining : 0n),
    eligible: result.eligible, reasonCode, reason: reasonCode ? reasonMessages[reasonCode] : null,
    reasons: result.reasons, baseline: refinancingBaseline(snapshot) };
}

function normalize(input: RefinancingRequest): RefinancingRequest {
  if (!input || !UUID.test(input.originLoanId ?? '') || !validDate(input.refinancingDate ?? '') ||
    !MONEY.test(input.newMoney ?? '') || !MONEY.test(input.newInterestAmount ?? '') ||
    !UUID.test(input.paymentFrequencyId ?? '') || !UUID.test(input.preferredPaymentMethodId ?? '') ||
    !/^[a-f\d]{64}$/i.test(input.baseline ?? '') || !KEY.test(input.idempotencyKey ?? '') ||
    (input.disbursementPaymentMethodId !== undefined && !UUID.test(input.disbursementPaymentMethodId))) {
    throw new RefinancingValidationError('The refinancing request is invalid.');
  }
  if (cents(input.newMoney) > 0n && !input.disbursementPaymentMethodId ||
    cents(input.newMoney) === 0n && input.disbursementPaymentMethodId !== undefined) {
    throw new RefinancingValidationError('Disbursement method is required only for new money.');
  }
  if (!Array.isArray(input.plan) || input.plan.length === 0 || input.plan.some((row, index) =>
    !row || row.sequence !== index + 1 || !MONEY.test(row.pendingAmount) || cents(row.pendingAmount) <= 0n)) {
    throw new RefinancingValidationError('The new payment plan is invalid.');
  }
  const planDateIssue = paymentPlanDateIssue(input.refinancingDate, input.plan.map((row) => row.dueDate));
  if (planDateIssue === 'sunday') throw new RefinancingValidationError('Los domingos no son días de cobro.');
  if (planDateIssue === 'duplicate') throw new RefinancingValidationError('Ya existe una cuota programada para esta fecha.');
  if (planDateIssue !== null) throw new RefinancingValidationError('Las fechas del plan deben ser válidas, posteriores y estar en orden.');
  return { ...input, originLoanId: input.originLoanId.toLowerCase(), paymentFrequencyId: input.paymentFrequencyId.toLowerCase(),
    preferredPaymentMethodId: input.preferredPaymentMethodId.toLowerCase(),
    disbursementPaymentMethodId: input.disbursementPaymentMethodId?.toLowerCase(),
    newMoney: money(cents(input.newMoney)), newInterestAmount: money(cents(input.newInterestAmount)),
    baseline: input.baseline.toLowerCase(), observations: input.observations?.trim().toUpperCase() || undefined,
    plan: input.plan.map((row) => ({ sequence: row.sequence, dueDate: row.dueDate, pendingAmount: money(cents(row.pendingAmount)) })) };
}

function assertOperation(operation: RefinancingOperation | undefined, amounts?: RefinancingAmounts): asserts operation is RefinancingOperation {
  if (!operation || operation.originStatus !== 'REFINANCED' || !operation.newLoanId || !operation.originLoanId ||
    operation.newMoneyDisbursed === '0.00' && (operation.disbursementId !== null || operation.cashMovementId !== null) ||
    operation.newMoneyDisbursed !== '0.00' && (!operation.disbursementId || !operation.cashMovementId) ||
    operation.newMoneyDisbursed !== '0.00' && (operation.disbursementAmount !== operation.newMoneyDisbursed ||
      operation.cashAmount !== operation.newMoneyDisbursed || operation.disbursementDate !== operation.refinancingDate ||
      operation.cashDate !== operation.refinancingDate || operation.disbursementMethodId !== operation.cashMethodId ||
      operation.cashDirection !== 'OUTFLOW' || operation.cashConcept !== 'REFINANCING_NEW_MONEY_DISBURSEMENT') ||
    amounts && Object.entries(amounts).some(([key, value]) => operation[key as keyof RefinancingAmounts] !== value)) {
    throw new RefinancingConflictError('The refinancing operation does not reconcile.');
  }
}

export class LoanRefinancingUseCase {
  constructor(private readonly store: RefinancingStore, private readonly closedPeriods?: RetroactivePeriodGuard) {}

  private buildChains(graph: RefinancingChainGraph) {
    try { return buildRefinancingChains(graph); }
    catch (error) {
      if (error instanceof RefinancingChainIntegrityError) throw new RefinancingConflictError(error.message, 'CHAIN_INTEGRITY_ERROR');
      throw error;
    }
  }

  async list(raw: { search?: string; customerId?: string; dateFrom?: string; dateTo?: string;
    page?: number; pageSize?: number }) {
    const page = raw.page ?? 1, pageSize = raw.pageSize ?? 20;
    if (raw.search !== undefined && (typeof raw.search !== 'string' || raw.search.length > 120) ||
      raw.customerId !== undefined && (typeof raw.customerId !== 'string' || !UUID.test(raw.customerId)) ||
      raw.dateFrom !== undefined && (typeof raw.dateFrom !== 'string' || !validDate(raw.dateFrom)) ||
      raw.dateTo !== undefined && (typeof raw.dateTo !== 'string' || !validDate(raw.dateTo)) ||
      raw.dateFrom && raw.dateTo && raw.dateFrom > raw.dateTo ||
      !Number.isSafeInteger(page) || page < 1 || ![10, 20, 50].includes(pageSize) ||
      !Number.isSafeInteger((page - 1) * pageSize)) {
      throw new RefinancingValidationError('The refinancing list filters are invalid.');
    }
    const query: RefinancingListQuery = { page, pageSize: pageSize as 10 | 20 | 50,
      search: raw.search?.replace(/\s+/g, ' ').trim() || undefined,
      customerId: raw.customerId?.toLowerCase(), dateFrom: raw.dateFrom, dateTo: raw.dateTo };
    const { items, total } = await this.store.list(query);
    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  async search(raw: { search?: string; page?: number; pageSize?: number }) {
    const query: RefinancingSearchQuery = { search: typeof raw.search === 'string' ? raw.search.replace(/\s+/g, ' ').trim() : undefined,
      page: raw.page ?? 1, pageSize: (raw.pageSize ?? 20) as 10 | 20 | 50 };
    if (raw.search !== undefined && (typeof raw.search !== 'string' || raw.search.length > 120) ||
      !Number.isSafeInteger(query.page) || query.page < 1 || ![10, 20, 50].includes(query.pageSize) ||
      !Number.isSafeInteger((query.page - 1) * query.pageSize)) {
      throw new RefinancingValidationError('The refinancing search filters are invalid.');
    }
    const { items, total } = await this.store.search(query);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async preview(originLoanId: string) {
    if (!UUID.test(originLoanId)) throw new RefinancingValidationError('The loan identifier is invalid.');
    const snapshot = await this.store.preview(originLoanId);
    if (!snapshot) throw new RefinancingNotFoundError('The loan does not exist.');
    return previewResponse(snapshot);
  }

  async confirm(raw: RefinancingRequest, actorId: string) {
    if (!UUID.test(actorId)) throw new RefinancingValidationError('The actor is invalid.');
    const input = normalize(raw);
    const fingerprint = hash({ ...input, idempotencyKey: undefined, actorId });
    return this.store.transaction(async (tx) => {
      const origin = await tx.lockOrigin(input.originLoanId);
      if (!origin) throw new RefinancingNotFoundError('The origin loan does not exist.');
      const existing = await tx.findByKey(input.idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new RefinancingConflictError('The idempotency key was used with different data.', 'IDEMPOTENCY_CONFLICT');
        const operation = await tx.readOperation(existing.id);
        assertOperation(operation);
        return operation;
      }
      try { await this.closedPeriods?.assertDateAllowed(input.refinancingDate, tx.context); }
      catch (error) { if (error instanceof ClosedFinancialPeriodError) throw new RefinancingConflictError(error.message, 'CLOSED_FINANCIAL_PERIOD'); throw error; }
      const check = checkedSnapshot(origin);
      if (origin.status === 'ACTIVE' && refinancingBaseline(origin) !== input.baseline) {
        throw new RefinancingConflictError('The loan changed since the preview. Refresh and retry.', 'STALE_DATA');
      }
      if (!check.eligible) throw new RefinancingConflictError(`The origin loan is not eligible: ${check.reasons.join(', ')}.`,
        origin.status === 'REFINANCED' ? 'ALREADY_REFINANCED' : check.reasons[0]);
      const opening = await tx.openingDate();
      if (!opening || input.refinancingDate < opening || input.refinancingDate < origin.startDate ||
        input.refinancingDate < (origin.lastValidPaymentDate ?? origin.startDate) ||
        input.refinancingDate > new Date().toISOString().slice(0, 10)) {
        throw new RefinancingValidationError('The refinancing date is outside the operational period.');
      }
      if (!await tx.activeReferences(input.paymentFrequencyId,
        [input.preferredPaymentMethodId, ...(input.disbursementPaymentMethodId ? [input.disbursementPaymentMethodId] : [])])) {
        throw new RefinancingValidationError('A payment frequency or method is unavailable.');
      }
      const amounts = refinancingAmounts(check.integrity.outstandingPrincipal, check.integrity.outstandingInterest,
        cents(input.newMoney), cents(input.newInterestAmount));
      if (cents(amounts.newContractualTotal) > MAX_CENTS || cents(amounts.newContractualPrincipal) <= 0n ||
        input.plan.reduce((sum, row) => sum + cents(row.pendingAmount), 0n) !== cents(amounts.newContractualTotal)) {
        throw new RefinancingValidationError('The new loan and payment plan do not reconcile.');
      }
      const newLoan = await tx.insertLoan({ customerId: origin.customerId, refinancingDate: input.refinancingDate,
        paymentFrequencyId: input.paymentFrequencyId, preferredPaymentMethodId: input.preferredPaymentMethodId,
        observations: input.observations ?? null, principal: amounts.newContractualPrincipal,
        interestAmount: amounts.newInterestAmount, totalAmount: amounts.newContractualTotal, actorId });
      await tx.insertPlan(newLoan.id, input.plan);
      const refinancingId = await tx.insertRefinancing({ ...amounts, originLoanId: origin.id, newLoanId: newLoan.id,
        refinancingDate: input.refinancingDate, createdByUserId: actorId, idempotencyKey: input.idempotencyKey,
        idempotencyFingerprint: fingerprint });
      if (!refinancingId) throw new RefinancingConflictError('The origin loan or idempotency key was used by another refinancing.', 'CONCURRENT_REFINANCING');
      if (!await tx.transitionOrigin(origin.id)) throw new RefinancingConflictError('The origin loan is no longer active.', 'LOAN_NOT_ACTIVE');
      await tx.createStatusHistory(origin.id, newLoan, actorId, refinancingId);
      if (cents(input.newMoney) > 0n) await tx.disburseNewMoney({ refinancingId, newLoanId: newLoan.id,
        amount: input.newMoney, date: input.refinancingDate, methodId: input.disbursementPaymentMethodId!, actorId });
      const newSnapshot = await tx.readSnapshot(newLoan.id);
      const originAfter = await tx.readSnapshot(origin.id);
      if (!newSnapshot || !originAfter || originAfter.status !== 'REFINANCED' ||
        refinancingBaseline({ ...originAfter, status: origin.status }) !== input.baseline ||
        newSnapshot.status !== 'ACTIVE' || cents(newSnapshot.principal) !== cents(amounts.newContractualPrincipal) ||
        cents(newSnapshot.interestAmount) !== cents(amounts.newInterestAmount) ||
        cents(newSnapshot.totalAmount) !== cents(amounts.newContractualTotal)) {
        throw new RefinancingConflictError('The refinancing financial state does not reconcile.');
      }
      const after = checkedSnapshot(newSnapshot);
      if (!after.integrity.valid || after.integrity.validPaidAmount !== 0n ||
        after.integrity.pendingPlanAmount !== cents(amounts.newContractualTotal)) {
        throw new RefinancingConflictError('The successor loan financial state does not reconcile.');
      }
      const operation = await tx.readOperation(refinancingId);
      assertOperation(operation, amounts);
      return operation;
    });
  }

  async detail(id: string) {
    if (!UUID.test(id)) throw new RefinancingValidationError('The refinancing identifier is invalid.');
    const operation = await this.store.detail(id);
    if (!operation) throw new RefinancingNotFoundError('The refinancing does not exist.');
    assertOperation(operation);
    return operation;
  }

  async chain(loanId: string) {
    if (!UUID.test(loanId)) throw new RefinancingValidationError('The loan identifier is invalid.');
    const graph = await this.store.chainGraphForLoan(loanId);
    if (!graph) throw new RefinancingNotFoundError('The loan does not exist.');
    const chain = this.buildChains(graph).find((entry) => entry.loans.some((loan) => loan.loanId === loanId.toLowerCase()));
    if (!chain) throw new RefinancingNotFoundError('The loan has no refinancing chain.');
    return chain;
  }

  async chainsForCustomer(customerId: string) {
    if (!UUID.test(customerId)) throw new RefinancingValidationError('The customer identifier is invalid.');
    const graph = await this.store.chainsForCustomer(customerId);
    if (!graph) throw new RefinancingNotFoundError('The customer does not exist.');
    if (graph.customer.id !== customerId.toLowerCase()) {
      throw new RefinancingConflictError('The refinancing customer does not match the request.', 'CHAIN_INTEGRITY_ERROR');
    }
    return { customer: graph.customer, chains: this.buildChains(graph) };
  }
}
