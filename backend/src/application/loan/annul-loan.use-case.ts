import { cents, evaluateLoanFinancialIntegrity, type ValidPaymentTotals } from '../../domain/loan/loan-financial-integrity';
import { paymentFingerprint } from '../../domain/payment/payment-rules';
import type { LoanFinancialTotalsQuery, LoanFinancialTotalsReader } from './loan-financial-totals.reader';
import { getNextLoanStatusEventSequence, LoanStatusHistorySequenceError } from './loan-status-history-sequence';
import type { DisbursementResolution } from './annulled-loans.use-case';
import { isDateOnly } from './uncollectible-eligibility.use-case';

export class AnnulLoanValidationError extends Error {}
export class AnnulLoanNotFoundError extends Error {}
export class AnnulLoanConflictError extends Error {}
export class AnnulLoanIntegrityError extends Error {}
export type AnnulmentEvent = { id: string; loanId: string; eventSequence: number; eventKind: string;
  fromStatus: string | null; toStatus: string; actorId: string | null; reason: string | null;
  disbursementResolution: string | null; fingerprint: string | null; annulledAt: string; annulledBusinessDate: string };
export type AnnulmentLedger = { principal: string; interestAmount: string; totalAmount: string; startDate: string;
  planCount: number; pendingPlan: string; disbursementId: string | null; disbursementAmount: string | null;
  disbursementDate: string | null; disbursementMethodId: string | null; originalId: string | null;
  originalAmount: string | null; originalDate: string | null; originalMethodId: string | null;
  originalConcept: string | null; originalDirection: string | null; reversalId: string | null;
  reversalAmount: string | null; reversalDate: string | null; reversalMethodId: string | null;
  reversalConcept: string | null; reversalDirection: string | null; reversalActorId: string | null;
  reversalKey: string | null; reversalFingerprint: string | null };
export interface AnnulLoanTransaction {
  executor: LoanFinancialTotalsQuery;
  lockLoan(id: string): Promise<{ id: string; status: string } | undefined>;
  findByKey(key: string): Promise<AnnulmentEvent | undefined>;
  latestEvent(id: string): Promise<AnnulmentEvent | undefined>;
  hasValidPayment(id: string): Promise<boolean>;
  isRefinancingSuccessor(id: string): Promise<boolean>;
  readLedger(id: string): Promise<AnnulmentLedger | undefined>;
  updateActiveLoan(id: string): Promise<boolean>;
  insertEvent(id: string, sequence: number, actor: string, reason: string, resolution: DisbursementResolution,
    key: string, fingerprint: string): Promise<AnnulmentEvent | undefined>;
  reverse(originalId: string, amount: string, date: string, methodId: string, actor: string, key: string, fingerprint: string): Promise<boolean>;
}
export interface AnnulLoanWriter { transaction<T>(run: (tx: AnnulLoanTransaction) => Promise<T>): Promise<T> }
export const ANNUL_LOAN_WRITER = Symbol('ANNUL_LOAN_WRITER');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[\x21-\x7e]{1,128}$/;
const money = (v: unknown): v is string => typeof v === 'string' && /^\d+(?:\.\d{1,2})?$/.test(v);
const receipt = (e: AnnulmentEvent) => ({ loanId: e.loanId, status: 'ANNULLED' as const,
  annulledAt: e.annulledAt, annulledBusinessDate: e.annulledBusinessDate,
  reason: e.reason!, disbursementResolution: e.disbursementResolution as DisbursementResolution });

function assertLedger(ledger: AnnulmentLedger | undefined, event?: AnnulmentEvent): asserts ledger is AnnulmentLedger {
  if (!ledger || !money(ledger.principal) || !money(ledger.interestAmount) || !money(ledger.totalAmount) ||
    cents(ledger.principal) <= 0n || cents(ledger.totalAmount) !== cents(ledger.principal) + cents(ledger.interestAmount) ||
    !isDateOnly(ledger.startDate) || !ledger.disbursementId || !money(ledger.disbursementAmount) ||
    cents(ledger.disbursementAmount) !== cents(ledger.principal) || ledger.disbursementDate !== ledger.startDate ||
    !ledger.disbursementMethodId || !ledger.originalId || !money(ledger.originalAmount) ||
    cents(ledger.originalAmount) !== cents(ledger.principal) || ledger.originalDate !== ledger.disbursementDate ||
    ledger.originalMethodId !== ledger.disbursementMethodId || ledger.originalConcept !== 'LOAN_DISBURSEMENT' ||
    ledger.originalDirection !== 'OUTFLOW' || (event && (!ledger.reversalId || !money(ledger.reversalAmount) ||
      cents(ledger.reversalAmount) !== cents(ledger.principal) || ledger.reversalMethodId !== ledger.originalMethodId ||
      ledger.reversalDate !== event.annulledBusinessDate || ledger.reversalConcept !== 'REVERSAL' || ledger.reversalDirection !== 'INFLOW' ||
      ledger.reversalActorId !== event.actorId || ledger.reversalKey !== `loan-annulment:${event.id}` ||
      ledger.reversalFingerprint !== event.fingerprint))) {
    throw new AnnulLoanIntegrityError('El desembolso y los movimientos de caja no concuerdan.');
  }
}

export class AnnulLoanUseCase {
  constructor(private readonly writer: AnnulLoanWriter, private readonly totals: LoanFinancialTotalsReader) {}
  async execute(loanId: string, input: { reason: string; disbursementResolution: DisbursementResolution; idempotencyKey: string }, actorId: string) {
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    const key = typeof input?.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
    const resolution = input?.disbursementResolution;
    if (!UUID.test(loanId) || !UUID.test(actorId) || !KEY.test(key) || !reason || reason.length > 500 ||
      !['NOT_DELIVERED', 'RETURNED_IN_FULL'].includes(resolution)) {
      throw new AnnulLoanValidationError('Los datos para anular el préstamo no son válidos.');
    }
    return this.writer.transaction(async (tx) => {
      const loan = await tx.lockLoan(loanId);
      if (!loan) throw new AnnulLoanNotFoundError('El préstamo no existe.');
      const fingerprint = paymentFingerprint({ operation: 'ANNUL_LOAN', loanId: loan.id, actorId, reason, disbursementResolution: resolution });
      const existing = await tx.findByKey(key);
      if (existing) {
        if (existing.loanId !== loan.id || existing.eventKind !== 'TRANSITION' || existing.fromStatus !== 'ACTIVE' ||
          existing.toStatus !== 'ANNULLED' || existing.actorId !== actorId || existing.reason !== reason ||
          existing.disbursementResolution !== resolution || existing.fingerprint !== fingerprint) {
          throw new AnnulLoanConflictError('La clave de idempotencia ya fue utilizada con otros datos.');
        }
        const latest = await tx.latestEvent(loan.id);
        if (loan.status !== 'ANNULLED' || latest?.id !== existing.id || latest.eventSequence !== existing.eventSequence ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(existing.annulledAt) ||
          !isDateOnly(existing.annulledBusinessDate)) throw new AnnulLoanIntegrityError('El historial de anulación no concuerda.');
        const ledger = await tx.readLedger(loan.id);
        assertLedger(ledger, existing);
        return receipt(existing);
      }
      if (loan.status !== 'ACTIVE') throw new AnnulLoanConflictError('Solo se puede anular un préstamo activo.');
      if (await tx.isRefinancingSuccessor(loan.id)) throw new AnnulLoanConflictError('Un préstamo sucesor de refinanciamiento no puede anularse de forma aislada.');
      if (await tx.hasValidPayment(loan.id)) throw new AnnulLoanConflictError('El préstamo tiene pagos válidos.');
      const ledger = await tx.readLedger(loan.id);
      assertLedger(ledger);
      if (ledger.reversalId) throw new AnnulLoanConflictError('El desembolso ya fue reversado.');
      const totals = await this.totals.readValidTotals(tx.executor, loan.id);
      const valid = (v: ValidPaymentTotals | undefined): v is ValidPaymentTotals => !!v &&
        money(v.paidAmount) && money(v.paidPrincipal) && money(v.paidInterest) && Number.isSafeInteger(v.invalidCount);
      if (!valid(totals) || !money(ledger.pendingPlan) || !Number.isSafeInteger(ledger.planCount) || ledger.planCount < 1 ||
        !evaluateLoanFinancialIntegrity(ledger, totals, cents(ledger.pendingPlan)).valid ||
        cents(totals.paidAmount) !== 0n || cents(totals.paidPrincipal) !== 0n || cents(totals.paidInterest) !== 0n) {
        throw new AnnulLoanIntegrityError('El plan y los pagos válidos no concuerdan con el préstamo.');
      }
      let sequence: number;
      try { sequence = await getNextLoanStatusEventSequence(tx.executor, loan.id); }
      catch (error) {
        if (error instanceof LoanStatusHistorySequenceError) throw new AnnulLoanIntegrityError('El historial del préstamo no está disponible.');
        throw error;
      }
      const latest = await tx.latestEvent(loan.id);
      if (sequence < 2 || latest?.eventSequence !== sequence - 1 || latest.toStatus !== 'ACTIVE' ||
        (sequence === 2 && (latest.eventKind !== 'CREATED' || latest.fromStatus !== null))) {
        throw new AnnulLoanIntegrityError('El historial del préstamo no está disponible.');
      }
      if (!await tx.updateActiveLoan(loan.id)) throw new AnnulLoanConflictError('El estado del préstamo cambió durante la operación.');
      const event = await tx.insertEvent(loan.id, sequence, actorId, reason, resolution, key, fingerprint);
      if (!event) throw new AnnulLoanConflictError('La clave de idempotencia ya fue utilizada.');
      if (event.annulledBusinessDate < ledger.disbursementDate!) throw new AnnulLoanConflictError('La fecha de anulación es anterior al desembolso.');
      if (!await tx.reverse(ledger.originalId!, ledger.principal, event.annulledBusinessDate,
        ledger.originalMethodId!, actorId, `loan-annulment:${event.id}`, fingerprint)) {
        throw new AnnulLoanConflictError('El desembolso ya fue reversado.');
      }
      return receipt(event);
    });
  }
}
