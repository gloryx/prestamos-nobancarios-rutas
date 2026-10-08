import { createHash } from 'crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { allocatePayment } from '../../domain/payment/payment-allocation';
import type { PaymentAnnulmentType, PaymentInput } from '../../domain/payment/payment.types';
import { assertPaymentDate, paymentFingerprint } from '../../domain/payment/payment-rules';
import { buildPaymentProjection } from '../../domain/payment/payment-projection';
import { buildPaymentContext, type PlanBaseline } from '../../domain/payment/payment-invariants';
import { paymentDateOnlyKey } from '../../domain/payment/payment-date-only';
import { evaluateLoanFinancialIntegrity, type LoanFinancialAmounts, type ValidPaymentTotals } from '../../domain/loan/loan-financial-integrity';
import type { LoanFinancialTotalsQuery, LoanFinancialTotalsReader } from '../loan/loan-financial-totals.reader';
import { getNextLoanStatusEventSequence, LoanStatusHistorySequenceError } from '../loan/loan-status-history-sequence';
import { ACTIVE_LOAN_OVERDUE_SQL } from '../loan/active-loan-condition.sql';
import { PaymentConflictError, PaymentNotFoundError, PaymentValidationError } from './payment.errors';
import { applyPaymentPlanDraft } from './payment-plan-draft';
import type { RetroactivePeriodGuard } from '../financial-close/retroactive-period.guard';
import { ClosedFinancialPeriodError } from '../../domain/financial-close/financial-close.errors';

export { PaymentConflictError, PaymentNotFoundError, PaymentValidationError } from './payment.errors';

const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cents = (value: string) => { const negative = value.startsWith('-'); const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.'); const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); return negative ? -amount : amount; };
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const today = () => new Date().toISOString().slice(0, 10);
const costaRicaDate = (value = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);

async function nextPaymentStatusEventSequence(manager: Pick<EntityManager, 'query'>, loanId: string): Promise<number> {
  try {
    const sequence = await getNextLoanStatusEventSequence(manager, loanId);
    if (sequence === 1) throw new LoanStatusHistorySequenceError();
    return sequence;
  } catch (error) {
    if (error instanceof LoanStatusHistorySequenceError) throw new PaymentConflictError(error.message);
    throw error;
  }
}

async function readPaymentTotals(reader: LoanFinancialTotalsReader, executor: LoanFinancialTotalsQuery, loanId: string): Promise<ValidPaymentTotals> {
  const totals = await reader.readValidTotals(executor, loanId);
  if (!totals) throw new PaymentConflictError('Payment totals are unavailable.');
  return totals;
}

function assertFinancialIntegrity(loan: LoanFinancialAmounts, totals: ValidPaymentTotals, pending: bigint) {
  const result = evaluateLoanFinancialIntegrity(loan, totals, pending);
  if (!result.valid) throw new PaymentConflictError('Payment balances do not reconcile with the loan and pending plan.');
  return result;
}

export class RegisterPaymentUseCase {
  constructor(private readonly dataSource: DataSource, private readonly totalsReader: LoanFinancialTotalsReader,
    private readonly closedPeriods?: RetroactivePeriodGuard) {}

  private async replay(manager: Pick<EntityManager, 'query'>, existing: { id: string; fingerprint: string }, fingerprint: string) {
    if (existing.fingerprint !== fingerprint) throw new PaymentConflictError('The idempotency key was used with different data.');
    const detail = await this.detail(manager, existing.id);
    const [cash] = await manager.query(`SELECT id FROM cash_movements WHERE payment_id = $1 AND direction = 'INFLOW' AND concept = 'CUSTOMER_PAYMENT'`, [existing.id]);
    if (!cash) throw new PaymentConflictError('The payment cash inflow does not reconcile.');
    return { ...detail, cashId: cash.id };
  }

  async execute(input: PaymentInput, actorId: string) {
    if (!input?.collectorId || !UUID.test(input.collectorId)) throw new PaymentValidationError('Seleccione un cobrador.');
    if (!input.loanId || !input.methodId || !input.idempotencyKey || !MONEY.test(input.amount) || cents(input.amount) <= 0n || !DATE.test(input.paymentDate) || input.paymentDate > today()) throw new PaymentValidationError('Payment data is invalid.');
    const fp = paymentFingerprint({ loanId: input.loanId, amount: input.amount, paymentDate: input.paymentDate, methodId: input.methodId, collectorId: input.collectorId });
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.query('SELECT id, idempotency_fingerprint AS "fingerprint" FROM payments WHERE idempotency_key = $1 FOR SHARE', [input.idempotencyKey]);
      if (existing[0]) return this.replay(manager, existing[0], fp);
      const loan = await manager.query(`SELECT id, status, start_date::text AS "startDate", total_amount AS "totalAmount", principal, interest_amount AS "interestAmount" FROM loans WHERE id = $1 FOR UPDATE`, [input.loanId]);
      if (!loan[0]) throw new PaymentNotFoundError('The loan does not exist.');
      const raced = await manager.query('SELECT id, idempotency_fingerprint AS "fingerprint" FROM payments WHERE idempotency_key = $1 FOR SHARE', [input.idempotencyKey]);
      if (raced[0]) return this.replay(manager, raced[0], fp);
      try { await this.closedPeriods?.assertDateAllowed(input.paymentDate, manager); }
      catch (error) { if (error instanceof ClosedFinancialPeriodError) throw new PaymentConflictError(error.message); throw error; }
      if (loan[0].status !== 'ACTIVE') throw new PaymentValidationError('Only active loans accept payments.');
      const opening = await manager.query(`SELECT opening_date::text AS "openingDate" FROM financial_openings WHERE singleton_key = 'DEFAULT' FOR SHARE`);
      if (!opening[0]) throw new PaymentValidationError('The financial opening is required.');
      try { assertPaymentDate(opening[0].openingDate, loan[0].startDate, input.paymentDate, today()); } catch { throw new PaymentValidationError('The payment date is outside the operational period.'); }
      const [latestValid] = await manager.query(`SELECT payment_date::text AS "paymentDate" FROM payments WHERE loan_id = $1 AND status = 'VALID' ORDER BY payment_date DESC, created_at DESC, id DESC LIMIT 1`, [input.loanId]) as Array<{ paymentDate: string | Date }>;
      if (latestValid && input.paymentDate < paymentDateOnlyKey(latestValid.paymentDate)) throw new PaymentValidationError('La fecha del pago no puede ser anterior al último pago válido registrado.');
      const method = await manager.query('SELECT id FROM payment_methods WHERE id = $1 AND is_active = true', [input.methodId]);
      if (!method[0]) throw new PaymentValidationError('The payment method is inactive or does not exist.');
       const collector = await manager.query('SELECT id FROM collectors WHERE id = $1 AND is_active = true FOR SHARE', [input.collectorId]);
       if (!collector[0] || input.collectorId === actorId) throw new PaymentValidationError('El cobrador seleccionado no es válido.');
       const entries = await manager.query(`SELECT id, due_date::text AS "dueDate", sequence, pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0 ORDER BY due_date, sequence, id FOR UPDATE`, [input.loanId]);
        const balance = entries.reduce((sum: bigint, entry: { pendingAmount: string }) => sum + cents(entry.pendingAmount), 0n);
         const before = assertFinancialIntegrity(loan[0], await readPaymentTotals(this.totalsReader, manager, input.loanId), balance);
        const outstandingPrincipal = before.outstandingPrincipal;
       let principalRemaining = outstandingPrincipal;
       const allocationEntries = entries.map((entry: { id: string; dueDate: string | Date; sequence: number; pendingAmount: string }) => {
         const pending = cents(entry.pendingAmount);
         const principalPending = pending < principalRemaining ? pending : principalRemaining > 0n ? principalRemaining : 0n;
         principalRemaining -= principalPending;
         return { ...entry, principalPending: money(principalPending), interestPending: money(pending - principalPending) };
       });
       if (cents(input.amount) > balance) throw new PaymentValidationError('The payment exceeds the financial balance.');
        const allocation = allocatePayment(input.amount, allocationEntries);
       const appliedPrincipal = cents(allocation.principalApplied); const appliedInterest = cents(allocation.interestApplied);
        if (appliedPrincipal < 0n || appliedInterest < 0n || appliedPrincipal + appliedInterest !== cents(input.amount)
          || appliedPrincipal > before.outstandingPrincipal || appliedInterest > before.outstandingInterest
          || allocation.applications.reduce((sum, application) => sum + cents(application.amountApplied), 0n) !== cents(input.amount)) {
          throw new PaymentConflictError('The payment allocation exceeds the outstanding loan components.');
        }
      const payment = await manager.query(`INSERT INTO payments (loan_id, amount, principal_applied, interest_applied, payment_date, method_id, collector_id, created_by_user_id, status, idempotency_key, idempotency_fingerprint) VALUES ($1,$2::numeric(18,2),$3::numeric(18,2),$4::numeric(18,2),$5,$6,$7,$8,'VALID',$9,$10) RETURNING id, created_at AS "createdAt", created_by_user_id AS "createdByUserId"`, [input.loanId, input.amount, allocation.principalApplied, allocation.interestApplied, input.paymentDate, input.methodId, input.collectorId, actorId, input.idempotencyKey, fp]);
       for (const application of allocation.applications.filter((item) => item.amountApplied !== '0.00' || item.pendingAfter !== item.pendingBefore)) {
        await manager.query(`UPDATE payment_plan_entries SET pending_amount = $1::numeric(18,2), updated_at = now() WHERE id = $2`, [application.pendingAfter, application.planEntryId]);
         await manager.query(`INSERT INTO payment_applications (payment_id, payment_plan_entry_id, amount_applied, pending_before, pending_after, carried_forward_amount, carried_to_plan_entry_id, created_at) VALUES ($1,$2,$3::numeric(18,2),$4::numeric(18,2),$5::numeric(18,2),$6::numeric(18,2),$7,GREATEST(clock_timestamp(), COALESCE((SELECT MAX(created_at) + interval '1 microsecond' FROM payment_applications WHERE payment_id = $1), clock_timestamp())))`, [payment[0].id, application.planEntryId, application.amountApplied, application.pendingBefore, application.pendingAfter, application.carriedForwardAmount, application.carriedToPlanEntryId]);
      }
       const cash = await manager.query(`INSERT INTO cash_movements (direction, concept, amount, movement_date, payment_method_id, observations, created_by_user_id, idempotency_key, idempotency_fingerprint, payment_id) VALUES ('INFLOW','CUSTOMER_PAYMENT',$1::numeric(18,2),$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [input.amount, input.paymentDate, input.methodId, `Customer payment ${payment[0].id}`, actorId, `payment:${input.idempotencyKey}`, fp, payment[0].id]);
       const pendingAfter = await manager.query(`SELECT COALESCE(SUM(pending_amount), 0)::text AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0`, [input.loanId]);
        const after = assertFinancialIntegrity(loan[0], await readPaymentTotals(this.totalsReader, manager, input.loanId), cents(pendingAfter[0].pendingAmount));
       if (after.financialBalance === 0n) {
         if (cents(pendingAfter[0].pendingAmount) !== 0n) throw new PaymentConflictError('The paid loan still has pending obligations.');
          const updated = await manager.query(`UPDATE loans SET status = 'CANCELLED', updated_at = now() WHERE id = $1 AND status = 'ACTIVE' RETURNING id`, [input.loanId]);
          if (!Array.isArray(updated[0]) || updated[0].length !== 1 || updated[0][0]?.id !== loan[0].id || updated[1] !== 1) throw new PaymentConflictError('The loan status changed during payment registration.');
            const sequence = await nextPaymentStatusEventSequence(manager, loan[0].id);
           await manager.query(`INSERT INTO loan_status_history (loan_id, event_sequence, event_kind, from_status, to_status, changed_at, changed_by_user_id, reason, payment_id, payment_annulment_id) VALUES ($1,$5,'TRANSITION','ACTIVE','CANCELLED',$2,$3,NULL,$4,NULL)`, [input.loanId, payment[0].createdAt, payment[0].createdByUserId, payment[0].id, sequence]);
       }
       return { ...(await this.detail(manager, payment[0].id)), cashId: cash[0].id };
    });
  }

  async detail(manager: Pick<EntityManager, 'query'>, id: string) {
    const payment = await manager.query(`SELECT id, loan_id AS "loanId", amount, principal_applied AS "principalApplied", interest_applied AS "interestApplied", payment_date::text AS "paymentDate", method_id AS "methodId", collector_id AS "collectorId", created_by_user_id AS "createdByUserId", status, created_at AS "createdAt" FROM payments WHERE id = $1`, [id]);
    if (!payment[0]) throw new PaymentNotFoundError('The payment does not exist.');
    const applications = await manager.query(`SELECT payment_plan_entry_id AS "paymentPlanEntryId", amount_applied AS "amountApplied", pending_before AS "pendingBefore", pending_after AS "pendingAfter", carried_forward_amount AS "carriedForwardAmount", carried_to_plan_entry_id AS "carriedToPlanEntryId", created_at AS "createdAt" FROM payment_applications WHERE payment_id = $1 ORDER BY created_at, payment_plan_entry_id`, [id]);
    return { ...payment[0], applications };
  }

  async annul(paymentId: string, reason: string, idempotencyKey: string, actorId: string,
    annulmentType: PaymentAnnulmentType = 'CASH_REFUND') {
    if (!reason?.trim() || !idempotencyKey?.trim()) throw new PaymentValidationError('An annulment reason and idempotency key are required.');
    if (annulmentType !== 'DATA_CORRECTION' && annulmentType !== 'CASH_REFUND') {
      throw new PaymentValidationError('The payment annulment type is invalid.');
    }
    const trimmedReason = reason.trim();
    const fingerprint = createHash('sha256').update(JSON.stringify({ paymentId, reason: trimmedReason, annulmentType })).digest('hex');
    const legacyFingerprint = createHash('sha256').update(JSON.stringify({ paymentId, reason: trimmedReason })).digest('hex');
    const reversalKey = `payment-annulment:${idempotencyKey}`;
    const reversalFingerprint = createHash('sha256').update(`${paymentId}:${idempotencyKey}`).digest('hex');
    return this.dataSource.transaction(async (manager) => {
      const identity = await manager.query('SELECT loan_id AS "loanId" FROM payments WHERE id = $1', [paymentId]);
      if (!identity[0]) throw new PaymentNotFoundError('The payment does not exist.');
      const loanId = identity[0].loanId;
      const [loan] = await manager.query(`SELECT id, status, principal, interest_amount AS "interestAmount", total_amount AS "totalAmount" FROM loans WHERE id = $1 FOR UPDATE`, [loanId]);
      if (!loan) throw new PaymentConflictError('The payment loan is unavailable.');
      const [payment] = await manager.query(`SELECT id, loan_id AS "loanId", amount,
        payment_date::text AS "paymentDate", method_id AS "methodId", status
        FROM payments WHERE id = $1 FOR UPDATE`, [paymentId]);
      if (!payment || payment.loanId !== loanId) throw new PaymentConflictError('The payment loan has changed.');
      const [latestValid] = await manager.query(`SELECT id FROM payments WHERE loan_id = $1 AND status = 'VALID' ORDER BY payment_date DESC, created_at DESC, id DESC LIMIT 1`, [loanId]);
      const [existing] = await manager.query(`SELECT id, payment_id AS "paymentId", reason, annulment_type AS "annulmentType",
        annulled_at AS "annulledAt", idempotency_fingerprint AS "fingerprint"
        FROM payment_annulments WHERE idempotency_key = $1`, [idempotencyKey]);
      const legacyReplay = annulmentType === 'CASH_REFUND' && existing?.annulmentType === 'CASH_REFUND'
        && existing?.fingerprint === legacyFingerprint;
      if (existing && (existing.paymentId !== paymentId || existing.reason !== trimmedReason || existing.annulmentType !== annulmentType
        || existing.fingerprint !== fingerprint && !legacyReplay)) {
        throw new PaymentConflictError('The annulment idempotency key was used with different data.');
      }
      const [original] = await manager.query(`SELECT id, amount, movement_date::text AS "movementDate", payment_method_id AS "methodId"
        FROM cash_movements WHERE payment_id = $1 AND direction = 'INFLOW' AND concept = 'CUSTOMER_PAYMENT' FOR UPDATE`, [paymentId]);
      if (!original || !MONEY.test(original.amount) || cents(original.amount) !== cents(payment.amount)
        || original.methodId !== payment.methodId || original.movementDate !== payment.paymentDate) {
        throw new PaymentConflictError('The payment cash inflow does not reconcile.');
      }
      const [reversal] = await manager.query(`SELECT amount, movement_date::text AS "movementDate", direction, concept,
        payment_method_id AS "methodId", idempotency_key AS "idempotencyKey", idempotency_fingerprint AS "fingerprint"
        FROM cash_movements WHERE reversed_movement_id = $1 FOR UPDATE`, [original.id]);
      if (existing) {
        const existingEffectiveDate = existing.annulmentType === 'DATA_CORRECTION'
          ? original.movementDate : costaRicaDate(new Date(existing.annulledAt));
        if (payment.status !== 'ANNULLED' || !reversal || reversal.direction !== 'OUTFLOW' || reversal.concept !== 'REVERSAL'
          || reversal.methodId !== original.methodId || reversal.idempotencyKey !== reversalKey || reversal.fingerprint !== reversalFingerprint
          || reversal.movementDate !== existingEffectiveDate || !MONEY.test(reversal.amount)
          || cents(reversal.amount) !== cents(payment.amount)) throw new PaymentConflictError('The annulment cash reversal does not reconcile.');
        return this.detail(manager, paymentId);
      }
      const effectiveDate = annulmentType === 'DATA_CORRECTION' ? original.movementDate : costaRicaDate();
      try { await this.closedPeriods?.assertDateAllowed(effectiveDate, manager); }
      catch (error) { if (error instanceof ClosedFinancialPeriodError) throw new PaymentConflictError(error.message); throw error; }
      if (loan.status === 'REFINANCED') throw new PaymentConflictError('Payments on a refinanced loan cannot be annulled independently.');
      if (payment.status !== 'VALID' || reversal) throw new PaymentConflictError('Only a valid payment without a prior reversal can be annulled.');
      if (latestValid?.id !== paymentId) throw new PaymentConflictError('Solo se puede anular el último pago válido.');
      const [opening] = await manager.query(`SELECT opening_date::text AS "openingDate" FROM financial_openings WHERE singleton_key = 'DEFAULT' FOR SHARE`);
      if (!opening || effectiveDate < opening.openingDate) throw new PaymentConflictError('The financial opening does not permit this annulment.');

      type PlanRow = { id: string; loanId: string; pendingAmount: string };
      type Application = { entryId: string; amountApplied: string; pendingBefore: string; pendingAfter: string; carriedForwardAmount: string; carriedToEntryId: string | null };
      const plan = await manager.query(`SELECT id, loan_id AS "loanId", due_date::text AS "dueDate", sequence, pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 ORDER BY due_date, sequence, id FOR UPDATE`, [loanId]) as PlanRow[];
      if (plan.some((entry) => !MONEY.test(entry.pendingAmount))) throw new PaymentConflictError('The current payment plan is invalid.');
      const pending = plan.reduce((sum, entry) => sum + cents(entry.pendingAmount), 0n);
       assertFinancialIntegrity(loan, await readPaymentTotals(this.totalsReader, manager, loanId), pending);
       const applications = await manager.query(`SELECT payment_plan_entry_id AS "entryId", amount_applied AS "amountApplied", pending_before AS "pendingBefore", pending_after AS "pendingAfter", carried_forward_amount AS "carriedForwardAmount", carried_to_plan_entry_id AS "carriedToEntryId" FROM payment_applications WHERE payment_id = $1 FOR UPDATE`, [paymentId]) as Application[];
       const sources = new Set<string>();
       let applied = 0n;
       let exact = true;
       const carries = applications.some((item) => item.carriedForwardAmount !== '0.00' || item.carriedToEntryId !== null);
       for (const application of applications) {
         const source = plan.find((entry) => entry.id === application.entryId);
         if (!source || source.loanId !== loanId || sources.has(application.entryId)
           || !MONEY.test(application.amountApplied) || !MONEY.test(application.pendingBefore) || !MONEY.test(application.pendingAfter)
           || !MONEY.test(application.carriedForwardAmount)
           || (!carries && (cents(application.amountApplied) <= 0n || application.carriedForwardAmount !== '0.00'
             || application.carriedToEntryId !== null || cents(application.pendingAfter) + cents(application.amountApplied) !== cents(application.pendingBefore)))) {
           throw new PaymentConflictError('The payment applications cannot be safely reversed.');
         }
         sources.add(application.entryId);
         applied += cents(application.amountApplied);
         exact &&= cents(source.pendingAmount) === cents(application.pendingAfter);
       }
       if (carries) {
         const [source] = applications.filter((item) => cents(item.carriedForwardAmount) > 0n);
         const receiver = applications.find((item) => item.entryId === source?.carriedToEntryId);
         if (applications.length !== 2 || !source || !receiver || source.entryId === receiver.entryId
           || cents(source.amountApplied) <= 0n || cents(source.pendingAfter) !== 0n
           || cents(source.pendingBefore) !== cents(source.amountApplied) + cents(source.carriedForwardAmount)
           || cents(receiver.amountApplied) !== 0n || cents(receiver.pendingBefore) <= 0n
           || cents(receiver.pendingAfter) !== cents(receiver.pendingBefore) + cents(source.carriedForwardAmount)
           || receiver.carriedForwardAmount !== '0.00' || receiver.carriedToEntryId !== null) {
           throw new PaymentConflictError('The payment applications cannot be safely reversed.');
         }
       }
       if (applied !== cents(payment.amount)) throw new PaymentConflictError('The payment applications do not reconcile.');
      const target = exact ? undefined : (plan.find((entry) => cents(entry.pendingAmount) > 0n) ?? plan.find((entry) => sources.has(entry.id)));
      if (!exact && !target) throw new PaymentConflictError('No current plan entry can receive the restored balance.');
        const inserted = await manager.query(`INSERT INTO payment_annulments
          (payment_id, reason, annulment_type, created_by_user_id, idempotency_key, idempotency_fingerprint)
          VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id, payment_id AS "paymentId", reason,
          annulment_type AS "annulmentType", annulled_at AS "annulledAt", created_by_user_id AS "createdByUserId"`,
        [paymentId, trimmedReason, annulmentType, actorId, idempotencyKey, fingerprint]);
       if (!inserted[0]) throw new PaymentConflictError('The payment has already been annulled or the key is in use.');
       if (inserted[0].paymentId !== paymentId) throw new PaymentConflictError('The annulment payment does not match the locked payment.');
      if (exact) {
        for (const application of applications) await manager.query(`UPDATE payment_plan_entries SET pending_amount = $1::numeric(18,2), updated_at = now() WHERE id = $2`, [application.pendingBefore, application.entryId]);
      } else {
        await manager.query(`UPDATE payment_plan_entries SET pending_amount = pending_amount + $1::numeric(18,2), updated_at = now() WHERE id = $2`, [payment.amount, target!.id]);
      }
      await manager.query(`UPDATE payments SET status = 'ANNULLED' WHERE id = $1`, [paymentId]);
      const [pendingAfter] = await manager.query(`SELECT COALESCE(SUM(pending_amount), 0)::text AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0`, [loanId]);
       const after = assertFinancialIntegrity(loan, await readPaymentTotals(this.totalsReader, manager, loanId), cents(pendingAfter.pendingAmount));
       const reopening = loan.status === 'CANCELLED' && after.financialBalance > 0n;
       if (reopening) {
         const updated = await manager.query(`UPDATE loans SET status = 'ACTIVE', updated_at = now() WHERE id = $1 AND status = 'CANCELLED' RETURNING id`, [loanId]);
         if (!Array.isArray(updated[0]) || updated[0].length !== 1 || updated[0][0]?.id !== loanId || updated[1] !== 1) throw new PaymentConflictError('The loan status changed during payment annulment.');
       }
        const cash = await manager.query(`INSERT INTO cash_movements (direction, concept, amount, movement_date, payment_method_id, observations, reversed_movement_id, created_by_user_id, idempotency_key, idempotency_fingerprint) VALUES ('OUTFLOW','REVERSAL',$1::numeric(18,2),$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`, [payment.amount, effectiveDate, original.methodId, trimmedReason, original.id, actorId, reversalKey, reversalFingerprint]);
       if (!cash[0]) throw new PaymentConflictError('The annulment cash reversal conflicts with an existing movement.');
        if (reopening) {
           const sequence = await nextPaymentStatusEventSequence(manager, loanId);
          await manager.query(`INSERT INTO loan_status_history (loan_id, event_sequence, event_kind, from_status, to_status, changed_at, changed_by_user_id, reason, payment_id, payment_annulment_id) VALUES ($1,$7,'TRANSITION','CANCELLED','ACTIVE',$2,$3,$4,$5,$6)`, [loanId, inserted[0].annulledAt, inserted[0].createdByUserId, inserted[0].reason, inserted[0].paymentId, inserted[0].id, sequence]);
        }
      return this.detail(manager, paymentId);
    });
  }
}

export class PaymentContextUseCase {
  constructor(private readonly dataSource: DataSource, private readonly totalsReader: LoanFinancialTotalsReader) {}
  listLoans(query: { search?: string; page: number; pageSize: number }) {
    const params: unknown[] = []; const filters = [`l.status = 'ACTIVE'`];
    if (query.search?.trim()) { params.push(`%${query.search.trim()}%`); filters.push(`(l.loan_number::text ILIKE $${params.length} OR c.identification ILIKE $${params.length} OR concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) ILIKE $${params.length} OR c.primary_phone ILIKE $${params.length})`); }
    const where = `FROM loans l JOIN customers c ON c.id = l.customer_id WHERE ${filters.join(' AND ')}`;
    const count = this.dataSource.query(`SELECT COUNT(*)::int AS total ${where}`, params);
    const listParams = [...params, query.pageSize, (query.page - 1) * query.pageSize];
    const items = this.dataSource.query(`SELECT l.id, l.loan_number AS "loanNumber", c.identification, concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS "customerName", l.total_amount AS "totalAmount", (l.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.loan_id = l.id AND p.status = 'VALID'), 0))::numeric(18,2)::text AS "financialBalance", ${ACTIVE_LOAN_OVERDUE_SQL} AS "isOverdue" ${where} ORDER BY l.loan_number DESC, l.id LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`, listParams);
    return Promise.all([items, count]).then(([rows, totals]) => {
      if (rows.some((row: { financialBalance: string }) => cents(row.financialBalance) < 0n)) throw new PaymentConflictError('Payment balances do not reconcile with the loan.');
      return { items: rows, total: totals[0]?.total ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }
   execute(loanId: string) {
      return this.dataSource.query(`SELECT l.id AS "loanId", l.loan_number AS "loanNumber", l.status, c.identification, concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS "customerName", l.total_amount AS "totalAmount", l.principal, l.interest_amount AS "interestAmount", l.preferred_payment_method_id AS "preferredMethodId", pf.interval_unit AS "intervalUnit", pf.interval_value AS "intervalValue", COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.loan_id = l.id AND p.status = 'VALID'), 0)::numeric(18,2)::text AS "paidAmount", COALESCE((SELECT SUM(e.pending_amount) FROM payment_plan_entries e WHERE e.loan_id = l.id AND e.pending_amount > 0), 0)::numeric(18,2)::text AS "pendingAmount" FROM loans l JOIN customers c ON c.id = l.customer_id JOIN payment_frequencies pf ON pf.id = l.payment_frequency_id WHERE l.id = $1`, [loanId]).then(async (summary) => {
      if (!summary[0]) throw new PaymentNotFoundError('The loan does not exist.');
       const payments = await this.dataSource.query(`SELECT id, amount, payment_date::text AS "paymentDate", status, created_at AS "createdAt" FROM payments WHERE loan_id = $1 ORDER BY payment_date, created_at, id`, [loanId]);
       const planRows = await this.dataSource.query(`SELECT e.id, e.due_date::text AS "dueDate", e.sequence, e.pending_amount AS "pendingAmount", EXISTS (
         SELECT 1 FROM payment_applications pa JOIN payments applied_payment ON applied_payment.id = pa.payment_id AND applied_payment.status = 'VALID'
         WHERE pa.payment_plan_entry_id = e.id OR pa.carried_to_plan_entry_id = e.id
       ) AS "isProtected" FROM payment_plan_entries e WHERE e.loan_id = $1 AND e.pending_amount > 0 ORDER BY e.due_date, e.sequence, e.id`, [loanId]) as Array<{ id: string; dueDate: string; sequence: number; pendingAmount: string; isProtected?: boolean }>;
       const protectedPlanEntryIds = planRows.filter((entry) => entry.isProtected === true).map((entry) => entry.id);
       const combinedPlan = planRows.map(({ id, dueDate, sequence, pendingAmount }) => ({ id, dueDate, sequence, pendingAmount }));
         const row = summary[0];
         const { intervalUnit, intervalValue, ...summaryRow } = row;
         const totals = await readPaymentTotals(this.totalsReader, this.dataSource, loanId);
        const balances = assertFinancialIntegrity(row, totals, combinedPlan.reduce((sum: bigint, entry: { pendingAmount: string }) => sum + cents(entry.pendingAmount), 0n));
       const methods = await this.dataSource.query(`SELECT id, name FROM payment_methods WHERE is_active = true ORDER BY name, id`);
        const collectors = await this.dataSource.query(`SELECT id, concat_ws(' ', first_name, first_last_name, second_last_name) AS name FROM collectors WHERE is_active = true ORDER BY name, id`);
       const preferredMethod = { id: row.preferredMethodId, activeMethods: methods, collectors };
       const applications = await this.dataSource.query(`SELECT pa.payment_plan_entry_id AS "planEntryId", pa.amount_applied AS "amountApplied", pa.carried_forward_amount AS "carriedForwardAmount", pa.carried_to_plan_entry_id AS "carriedToPlanEntryId", source.due_date::text AS "sourceDueDate", pa.created_at AS "createdAt"
         FROM payment_applications pa JOIN payments p ON p.id = pa.payment_id AND p.status = 'VALID'
         JOIN payment_plan_entries source ON source.id = pa.payment_plan_entry_id
         WHERE p.loan_id = $1 AND (pa.amount_applied > 0 OR pa.carried_to_plan_entry_id IS NOT NULL) ORDER BY pa.created_at, pa.payment_plan_entry_id`, [loanId]);
       const projection = buildPaymentProjection(combinedPlan, payments, row.totalAmount, row.interestAmount, today(), applications);
           return buildPaymentContext({ summary: { ...summaryRow, paidAmount: money(cents(totals.paidAmount)) }, balances: { financialBalance: money(balances.financialBalance), outstandingPrincipal: money(balances.outstandingPrincipal), outstandingInterest: money(balances.outstandingInterest) }, combinedPlan: projection.combinedPlan, validPayments: projection.validPayments, lastValidPayment: projection.lastValidPayment, refinanceEligibility: projection.refinanceEligibility, preferredMethod, paymentFrequency: { intervalUnit, intervalValue }, protectedPlanEntryIds, collectionProjection: projection.collectionProjection });
    });
  }
}

export class CustomizePaymentPlanUseCase {
  constructor(private readonly dataSource: DataSource, private readonly totalsReader: LoanFinancialTotalsReader) {}
  async execute(loanId: string, entries: Array<{ id: string | null; dueDate: string; pendingAmount: string }>, idempotencyKey: string, base: PlanBaseline) {
    if (!Array.isArray(entries) || !idempotencyKey?.trim()) throw new PaymentValidationError('The payment plan is invalid.');
    if (entries.some((entry) => !entry || typeof entry !== 'object' || !Object.prototype.hasOwnProperty.call(entry, 'id') || entry.id === undefined)) {
      throw new PaymentValidationError('El formato del plan está desactualizado. Cada obligación debe indicar su identificador.');
    }
    if (!base || typeof base !== 'object' || typeof base.financialBalance !== 'string' || !MONEY.test(base.financialBalance) || cents(base.financialBalance) <= 0n || !Array.isArray(base.entries)
      || !base.entries.length || base.entries.some((entry) => !entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !UUID.test(entry.id)
        || typeof entry.dueDate !== 'string' || !DATE.test(entry.dueDate) || Number.isNaN(Date.parse(`${entry.dueDate}T00:00:00Z`))
        || new Date(`${entry.dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== entry.dueDate
        || typeof entry.pendingAmount !== 'string' || !MONEY.test(entry.pendingAmount) || cents(entry.pendingAmount) <= 0n)
      || new Set(base.entries.map((entry) => entry.id.toLowerCase())).size !== base.entries.length
      || base.entries.reduce((sum, entry) => sum + cents(entry.pendingAmount), 0n) !== cents(base.financialBalance)) {
      throw new PaymentValidationError('The opening payment plan is invalid. Refresh the loan and try again.');
    }
    const planFingerprint = paymentFingerprint({ loanId, entries: JSON.stringify(entries), base: JSON.stringify(base) });
    return this.dataSource.transaction(async (manager) => {
      const loan = await manager.query(`SELECT status, start_date::text AS "startDate", principal, interest_amount AS "interestAmount", total_amount AS "totalAmount", payment_plan_idempotency_key AS "idempotencyKey", payment_plan_idempotency_fingerprint AS "fingerprint" FROM loans WHERE id = $1 FOR UPDATE`, [loanId]);
      if (!loan[0]) throw new PaymentNotFoundError('The loan does not exist.');
      if (loan[0].status !== 'ACTIVE') throw new PaymentConflictError('The loan is no longer active. Refresh the loan and try again.');
      const resultSql = `SELECT id, due_date::text AS "dueDate", sequence, pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0 ORDER BY due_date, sequence, id`;
      if (loan[0].idempotencyKey === idempotencyKey) {
        if (loan[0].fingerprint !== planFingerprint) throw new PaymentConflictError('The plan idempotency key was used with different data.');
        return manager.query(resultSql, [loanId]);
      }
      type PlanRow = { id: string; dueDate: string; sequence: number; pendingAmount: string };
      const current = await manager.query(`SELECT id, due_date::text AS "dueDate", sequence, pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 ORDER BY due_date, sequence, id FOR UPDATE`, [loanId]) as PlanRow[];
       const totals = await readPaymentTotals(this.totalsReader, manager, loanId);
      const balance = cents(loan[0].totalAmount) - cents(totals.paidAmount);
      if (balance <= 0n) throw new PaymentConflictError('The payment plan does not reconcile with the current balance.');
      const positive = current.filter((row) => cents(row.pendingAmount) > 0n);
      assertFinancialIntegrity(loan[0], totals, positive.reduce((sum, row) => sum + cents(row.pendingAmount), 0n));
      const opening = base.entries.map((entry) => `${entry.id.toLowerCase()}|${entry.dueDate}|${cents(entry.pendingAmount)}`).sort();
      const persisted = positive.map((entry) => `${entry.id.toLowerCase()}|${paymentDateOnlyKey(entry.dueDate)}|${cents(entry.pendingAmount)}`).sort();
      if (cents(base.financialBalance) !== balance || opening.length !== persisted.length || opening.some((entry, index) => entry !== persisted[index])) {
        throw new PaymentConflictError('The payment plan changed since it was opened. Refresh the loan and try again.');
      }
       assertFinancialIntegrity(loan[0], totals, balance);
       const final = await applyPaymentPlanDraft(manager, loanId, loan[0].startDate, balance, entries);
       assertFinancialIntegrity(loan[0], await readPaymentTotals(this.totalsReader, manager, loanId), final.reduce((sum, row) => sum + cents(row.pendingAmount), 0n));
       await manager.query('UPDATE loans SET payment_plan_idempotency_key = $1, payment_plan_idempotency_fingerprint = $2, updated_at = now() WHERE id = $3', [idempotencyKey, planFingerprint, loanId]);
       return final;
    });
  }
}
