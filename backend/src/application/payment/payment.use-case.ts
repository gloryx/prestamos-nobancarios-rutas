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
import { attachPaymentApplications, readPaymentApplications } from './payment-read-applications';
import { alignApplicationSequences, numberCurrentPaymentPlan } from '../../domain/payment/payment-plan-numbering';
import { consolidatePlanAfterPayment } from '../../domain/payment/payment-plan-consolidation';
import type { LockedPaymentPlanConsolidation, PaymentPlanConsolidationWriter } from './payment-plan-consolidation.writer';
import type { PaymentPlanConsolidationHistoryReader } from './payment-plan-consolidation-history.reader';

export { PaymentConflictError, PaymentNotFoundError, PaymentValidationError } from './payment.errors';

const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cents = (value: string) => { const negative = value.startsWith('-'); const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.'); const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); return negative ? -amount : amount; };
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const costaRicaDate = (value = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
const today = () => costaRicaDate();

const SETTLEMENT_PAYMENT_KEY_PREFIX = 'collector-settlement:precollection:';

/** Capability object constructed only by the settlement application path. It is never part of an HTTP DTO. */
export class TrustedSettlementPaymentContext {
  private constructor(readonly precollectionId: string, readonly loanId: string, readonly collectorId: string) {}
  static forPrecollection(precollectionId: string, loanId: string, collectorId: string) {
    if (!UUID.test(precollectionId) || !UUID.test(loanId) || !UUID.test(collectorId)) {
      throw new PaymentValidationError('The trusted settlement context is invalid.');
    }
    return new TrustedSettlementPaymentContext(precollectionId, loanId, collectorId);
  }
  paymentKey() { return `${SETTLEMENT_PAYMENT_KEY_PREFIX}${this.precollectionId}`; }
}

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

export class TransactionalPaymentRegistrar {
  constructor(private readonly totalsReader: LoanFinancialTotalsReader,
    private readonly closedPeriods?: RetroactivePeriodGuard,
    private readonly consolidationWriter?: PaymentPlanConsolidationWriter,
    private readonly consolidationEnabled = false) {}

  assertInput(input: PaymentInput, context?: TrustedSettlementPaymentContext) {
    if (!input?.collectorId || !UUID.test(input.collectorId)) throw new PaymentValidationError('Seleccione un cobrador.', 'INVALID_COLLECTOR', 'collectorId');
    if (!input.loanId || !input.methodId || !input.idempotencyKey || !MONEY.test(input.amount) || cents(input.amount) <= 0n || !DATE.test(input.paymentDate) || input.paymentDate > today()) throw new PaymentValidationError('Revisa la fecha, el monto y la forma de pago antes de continuar.', 'PAYMENT_INVALID');
    const settlementNamespace = input.idempotencyKey.startsWith(SETTLEMENT_PAYMENT_KEY_PREFIX);
    if (settlementNamespace && (!(context instanceof TrustedSettlementPaymentContext)
      || context.paymentKey() !== input.idempotencyKey || context.loanId !== input.loanId || context.collectorId !== input.collectorId)) {
      throw new PaymentValidationError('La clave interna de liquidación no puede utilizarse en pagos regulares.', 'RESERVED_IDEMPOTENCY_NAMESPACE', 'idempotencyKey');
    }
  }

  private async replay(manager: Pick<EntityManager, 'query'>, existing: { id: string; fingerprint: string }, fingerprint: string) {
    if (existing.fingerprint !== fingerprint) throw new PaymentConflictError('The idempotency key was used with different data.');
    const detail = await this.detail(manager, existing.id);
    const [cash] = await manager.query(`SELECT id, amount::text AS amount, movement_date::text AS "movementDate",
      payment_method_id AS "methodId", idempotency_fingerprint AS "fingerprint"
      FROM cash_movements WHERE payment_id = $1 AND direction = 'INFLOW' AND concept = 'CUSTOMER_PAYMENT'`, [existing.id]);
    if (!cash || cash.amount !== detail.amount || cash.movementDate !== detail.paymentDate
      || cash.methodId !== detail.methodId || cash.fingerprint !== fingerprint) {
      throw new PaymentConflictError('The payment cash inflow does not reconcile.');
    }
    return { ...detail, cashId: cash.id };
  }

  async replayByKey(manager: EntityManager, input: PaymentInput) {
    const fingerprint = paymentFingerprint({ loanId: input.loanId, amount: input.amount, paymentDate: input.paymentDate,
      methodId: input.methodId, collectorId: input.collectorId });
    const [existing] = await manager.query('SELECT id, idempotency_fingerprint AS "fingerprint" FROM payments WHERE idempotency_key = $1 FOR SHARE', [input.idempotencyKey]);
    if (!existing) throw new PaymentConflictError('The concurrent payment could not be reconciled.');
    return this.replay(manager, existing, fingerprint);
  }

  async register(manager: EntityManager, input: PaymentInput, actorId: string, context?: TrustedSettlementPaymentContext) {
    this.assertInput(input, context);
    const fp = paymentFingerprint({ loanId: input.loanId, amount: input.amount, paymentDate: input.paymentDate, methodId: input.methodId, collectorId: input.collectorId });
      const existing = await manager.query('SELECT id, idempotency_fingerprint AS "fingerprint" FROM payments WHERE idempotency_key = $1 FOR SHARE', [input.idempotencyKey]);
      if (existing[0]) return this.replay(manager, existing[0], fp);
      if (this.closedPeriods) await manager.query(`SELECT pg_advisory_xact_lock_shared(hashtext('financial-closes-v2'))`);
      const loan = await manager.query(`SELECT id, status, start_date::text AS "startDate", total_amount AS "totalAmount", principal, interest_amount AS "interestAmount" FROM loans WHERE id = $1 FOR UPDATE`, [input.loanId]);
      if (!loan[0]) throw new PaymentNotFoundError('The loan does not exist.');
      const raced = await manager.query('SELECT id, idempotency_fingerprint AS "fingerprint" FROM payments WHERE idempotency_key = $1 FOR SHARE', [input.idempotencyKey]);
      if (raced[0]) return this.replay(manager, raced[0], fp);
      try { await this.closedPeriods?.assertDateAllowed(input.paymentDate, manager); }
      catch (error) { if (error instanceof ClosedFinancialPeriodError) throw new PaymentConflictError(error.message, 'CLOSED_FINANCIAL_PERIOD'); throw error; }
      if (loan[0].status !== 'ACTIVE') throw new PaymentValidationError('Only active loans accept payments.', 'LOAN_NOT_ACTIVE');
      const opening = await manager.query(`SELECT opening_date::text AS "openingDate" FROM financial_openings WHERE singleton_key = 'DEFAULT' FOR SHARE`);
      if (!opening[0]) throw new PaymentValidationError('The financial opening is required.', 'FINANCIAL_OPENING_REQUIRED');
      try { assertPaymentDate(opening[0].openingDate, loan[0].startDate, input.paymentDate, today()); } catch { throw new PaymentValidationError('The payment date is outside the operational period.', 'PAYMENT_DATE_INVALID', 'paymentDate'); }
      const [latestValid] = await manager.query(`SELECT payment_date::text AS "paymentDate" FROM payments WHERE loan_id = $1 AND status = 'VALID' ORDER BY payment_date DESC, created_at DESC, id DESC LIMIT 1`, [input.loanId]) as Array<{ paymentDate: string | Date }>;
      if (latestValid && input.paymentDate < paymentDateOnlyKey(latestValid.paymentDate)) throw new PaymentValidationError('La fecha del pago no puede ser anterior al último pago válido registrado.', 'PAYMENT_DATE_BEFORE_LAST', 'paymentDate');
       const reservationParams: unknown[] = [input.loanId];
       const settlementExclusion = context instanceof TrustedSettlementPaymentContext
         ? ` AND id <> $${reservationParams.push(context.precollectionId)}` : '';
       const [precollections] = await manager.query(`SELECT
         COALESCE(SUM(amount), 0)::numeric(18,2)::text AS reserved,
         MIN(effective_date)::text AS "earliestEffectiveDate"
         FROM collector_precollections WHERE loan_id = $1 AND status IN ('RECORDED','SUBMITTED')${settlementExclusion}`,
       reservationParams) as Array<{ reserved: string; earliestEffectiveDate: string | null }>;
      if (precollections?.earliestEffectiveDate && input.paymentDate > precollections.earliestEffectiveDate) {
        throw new PaymentConflictError('Existe un cobro preliminar anterior pendiente de resolución.', 'PENDING_PRECOLLECTION_CHRONOLOGY');
      }
      const method = await manager.query('SELECT id FROM payment_methods WHERE id = $1 AND is_active = true', [input.methodId]);
      if (!method[0]) throw new PaymentValidationError('La forma de pago seleccionada está inactiva o ya no existe. Selecciona otra para continuar.', 'PAYMENT_METHOD_INACTIVE', 'methodId');
       const collector = await manager.query(`SELECT c.id, c.user_id AS "userId",
         (SELECT actor_role.code FROM users actor_user JOIN roles actor_role ON actor_role.id = actor_user.role_id AND actor_role.is_active = true
           WHERE actor_user.id = $3 AND actor_user.is_active = true) AS "actorRoleCode",
         (SELECT actor_collector.id FROM collectors actor_collector WHERE actor_collector.user_id = $3 AND actor_collector.is_active = true) AS "actorCollectorId",
         EXISTS (SELECT 1 FROM loans assigned_loan
           JOIN customer_route_assignments customer_assignment ON customer_assignment.customer_id = assigned_loan.customer_id AND customer_assignment.ended_at IS NULL
           JOIN routes assigned_route ON assigned_route.id = customer_assignment.route_id AND assigned_route.is_active = true
           JOIN collector_route_assignments collector_assignment ON collector_assignment.route_id = assigned_route.id
             AND collector_assignment.collector_user_id = c.user_id AND collector_assignment.ended_at IS NULL
           WHERE assigned_loan.id = $2) AS "assigned"
         FROM collectors c JOIN users u ON u.id = c.user_id AND u.is_active = true
         JOIN roles role ON role.id = u.role_id AND role.is_active = true AND role.code = 'COLLECTOR'
         WHERE c.id = $1 AND c.is_active = true FOR SHARE OF c`, [input.collectorId, input.loanId, actorId]);
       if (!collector[0]) throw new PaymentValidationError('El cobrador seleccionado no es válido.', 'INVALID_COLLECTOR', 'collectorId');
       if (!collector[0].actorRoleCode) throw new PaymentValidationError('El usuario que registra el pago no está activo.', 'PAYMENT_ACTOR_INVALID');
        if (!collector[0].assigned && !(context instanceof TrustedSettlementPaymentContext)) throw new PaymentValidationError('El cobrador seleccionado no tiene asignado este cliente.', 'COLLECTOR_NOT_ASSIGNED', 'collectorId');
       if (collector[0].actorRoleCode === 'COLLECTOR' && collector[0].actorCollectorId !== input.collectorId) {
         throw new PaymentValidationError('No puedes registrar pagos para un cobrador o cliente ajeno.', 'COLLECTOR_SCOPE_FORBIDDEN', 'collectorId');
       }
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
        const reserved = cents(precollections?.reserved ?? '0.00');
        const operationalBalance = balance - reserved;
        if (operationalBalance < 0n) throw new PaymentConflictError('Los cobros preliminares pendientes no concilian con el saldo financiero.', 'OPERATIONAL_BALANCE_INVALID');
        if (cents(input.amount) > operationalBalance) throw new PaymentValidationError('El monto recibido supera el saldo operativo disponible del préstamo.', 'PAYMENT_AMOUNT_EXCEEDS_OPERATIONAL_BALANCE', 'amount');
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
        if (this.consolidationEnabled) {
          if (!this.consolidationWriter) throw new PaymentConflictError('Payment plan consolidation is enabled without a persistence writer.');
          const appliedPending = new Map(allocation.applications.map((application) => [application.planEntryId, application.pendingAfter]));
          const entriesAfterPayment = entries.map((entry: { id: string; dueDate: string | Date; sequence: number; pendingAmount: string }) => ({
            ...entry, pendingAmount: appliedPending.get(entry.id) ?? entry.pendingAmount,
          }));
          const consolidation = consolidatePlanAfterPayment({ trigger: 'PAYMENT', paymentDate: input.paymentDate,
            financialBalance: money(after.financialBalance), entries: entriesAfterPayment });
          if (consolidation.consolidatedAmount !== '0.00') {
            await this.consolidationWriter.write(manager, { paymentId: payment[0].id, loanId: input.loanId,
              effectivePaymentDate: input.paymentDate, entriesBefore: entriesAfterPayment, consolidation });
            const [consolidated] = await manager.query(`SELECT COALESCE(SUM(pending_amount), 0)::text AS "pendingAmount"
              FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0`, [input.loanId]);
            if (cents(consolidated.pendingAmount) !== after.financialBalance) {
              throw new PaymentConflictError('The consolidated payment plan does not reconcile with the financial balance.');
            }
          }
        }
        if (after.financialBalance === 0n) {
         if (cents(pendingAfter[0].pendingAmount) !== 0n) throw new PaymentConflictError('The paid loan still has pending obligations.');
          const updated = await manager.query(`UPDATE loans SET status = 'CANCELLED', updated_at = now() WHERE id = $1 AND status = 'ACTIVE' RETURNING id`, [input.loanId]);
          if (!Array.isArray(updated[0]) || updated[0].length !== 1 || updated[0][0]?.id !== loan[0].id || updated[1] !== 1) throw new PaymentConflictError('The loan status changed during payment registration.');
            const sequence = await nextPaymentStatusEventSequence(manager, loan[0].id);
           await manager.query(`INSERT INTO loan_status_history (loan_id, event_sequence, event_kind, from_status, to_status, changed_at, changed_by_user_id, reason, payment_id, payment_annulment_id) VALUES ($1,$5,'TRANSITION','ACTIVE','CANCELLED',$2,$3,NULL,$4,NULL)`, [input.loanId, payment[0].createdAt, payment[0].createdByUserId, payment[0].id, sequence]);
       }
        return { ...(await this.detail(manager, payment[0].id)), cashId: cash[0].id };
  }

  async detail(manager: Pick<EntityManager, 'query'>, id: string) {
    const payment = await manager.query(`SELECT id, loan_id AS "loanId", amount, principal_applied AS "principalApplied", interest_applied AS "interestApplied", payment_date::text AS "paymentDate", method_id AS "methodId", collector_id AS "collectorId", created_by_user_id AS "createdByUserId", status, created_at AS "createdAt" FROM payments WHERE id = $1`, [id]);
    if (!payment[0]) throw new PaymentNotFoundError('The payment does not exist.');
    const applications = await manager.query(`SELECT payment_plan_entry_id AS "paymentPlanEntryId", amount_applied AS "amountApplied", pending_before AS "pendingBefore", pending_after AS "pendingAfter", carried_forward_amount AS "carriedForwardAmount", carried_to_plan_entry_id AS "carriedToPlanEntryId", created_at AS "createdAt" FROM payment_applications WHERE payment_id = $1 ORDER BY created_at, payment_plan_entry_id`, [id]);
    return { ...payment[0], applications };
  }
}

export class RegisterPaymentUseCase {
  private readonly registrar: TransactionalPaymentRegistrar;

  constructor(private readonly dataSource: DataSource, private readonly totalsReader: LoanFinancialTotalsReader,
    private readonly closedPeriods?: RetroactivePeriodGuard, registrar?: TransactionalPaymentRegistrar,
    private readonly consolidationWriter?: PaymentPlanConsolidationWriter) {
    this.registrar = registrar ?? new TransactionalPaymentRegistrar(totalsReader, closedPeriods);
  }

  async execute(input: PaymentInput, actorId: string) {
    this.registrar.assertInput(input);
    try {
      return await this.dataSource.transaction((manager) => this.registrar.register(manager, input, actorId));
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== '23505'
        || !('constraint' in error) || error.constraint !== 'UQ_payments_idempotency') throw error;
      return this.dataSource.transaction((manager) => this.registrar.replayByKey(manager, input));
    }
  }

  async detail(manager: Pick<EntityManager, 'query'>, id: string) {
    return this.registrar.detail(manager, id);
  }

  async annul(paymentId: string, reason: string, idempotencyKey: string, actorId: string,
    annulmentType: PaymentAnnulmentType = 'CASH_REFUND') {
    if (!reason?.trim() || !idempotencyKey?.trim()) throw new PaymentValidationError('Indica el motivo de la anulación para continuar.', 'ANNULMENT_REASON_REQUIRED', 'reason');
    if (annulmentType !== 'DATA_CORRECTION' && annulmentType !== 'CASH_REFUND') {
      throw new PaymentValidationError('Selecciona si corresponde a una corrección de datos o a una devolución de dinero.', 'ANNULMENT_TYPE_INVALID', 'annulmentType');
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
       const consolidation = await this.consolidationWriter?.lockForReversal(manager, paymentId, loanId) ?? null;
        if (existing) {
        const existingEffectiveDate = existing.annulmentType === 'DATA_CORRECTION'
          ? original.movementDate : costaRicaDate(new Date(existing.annulledAt));
        if (payment.status !== 'ANNULLED' || !reversal || reversal.direction !== 'OUTFLOW' || reversal.concept !== 'REVERSAL'
          || reversal.methodId !== original.methodId || reversal.idempotencyKey !== reversalKey || reversal.fingerprint !== reversalFingerprint
          || reversal.movementDate !== existingEffectiveDate || !MONEY.test(reversal.amount)
           || cents(reversal.amount) !== cents(payment.amount)
           || consolidation && consolidation.reversalAnnulmentId !== existing.id) {
          throw new PaymentConflictError('The annulment cash reversal does not reconcile.');
        }
          return this.detail(manager, paymentId);
       }
      const [settlementPayment] = await manager.query(`SELECT EXISTS (
        SELECT 1 FROM collector_settlement_items item
        JOIN collector_settlements settlement ON settlement.id = item.settlement_id
        WHERE item.payment_id = $1 AND settlement.status = 'CONFIRMED'
      ) AS "inConfirmedSettlement"`, [paymentId]);
      if (settlementPayment?.inConfirmedSettlement === true) {
        throw new PaymentConflictError('Los pagos asociados a una liquidación confirmada no pueden anularse.',
          'PAYMENT_IN_CONFIRMED_SETTLEMENT');
      }
       const effectiveDate = annulmentType === 'DATA_CORRECTION' ? original.movementDate : costaRicaDate();
      try { await this.closedPeriods?.assertDateAllowed(effectiveDate, manager); }
      catch (error) { if (error instanceof ClosedFinancialPeriodError) throw new PaymentConflictError(error.message, 'CLOSED_FINANCIAL_PERIOD'); throw error; }
      if (consolidation && consolidation.effectivePaymentDate !== effectiveDate) {
        try { await this.closedPeriods?.assertDateAllowed(consolidation.effectivePaymentDate, manager); }
        catch (error) { if (error instanceof ClosedFinancialPeriodError) throw new PaymentConflictError(error.message, 'CLOSED_FINANCIAL_PERIOD'); throw error; }
      }
      if (loan.status === 'REFINANCED') throw new PaymentConflictError('Los pagos de un préstamo refinanciado no pueden anularse por separado.', 'REFINANCED_LOAN_PAYMENT');
      if (payment.status !== 'VALID' || reversal) throw new PaymentConflictError('El pago ya no está vigente o ya tiene una reversión registrada.', 'PAYMENT_NOT_ANNULABLE');
      if (latestValid?.id !== paymentId) throw new PaymentConflictError('Solo se puede anular el último pago válido.', 'PAYMENT_NOT_LATEST');
      if (consolidation?.reversalAnnulmentId) throw new PaymentConflictError('The payment plan consolidation was already reversed.');
      const [opening] = await manager.query(`SELECT opening_date::text AS "openingDate" FROM financial_openings WHERE singleton_key = 'DEFAULT' FOR SHARE`);
      if (!opening || effectiveDate < opening.openingDate) throw new PaymentConflictError('The financial opening does not permit this annulment.');

       type PlanRow = { id: string; loanId: string; dueDate: string; sequence: number; pendingAmount: string };
      type Application = { entryId: string; amountApplied: string; pendingBefore: string; pendingAfter: string; carriedForwardAmount: string; carriedToEntryId: string | null };
      const plan = await manager.query(`SELECT id, loan_id AS "loanId", due_date::text AS "dueDate", sequence, pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 ORDER BY due_date, sequence, id FOR UPDATE`, [loanId]) as PlanRow[];
      if (plan.some((entry) => !MONEY.test(entry.pendingAmount))) throw new PaymentConflictError('The current payment plan is invalid.');
      const pending = plan.reduce((sum, entry) => sum + cents(entry.pendingAmount), 0n);
       assertFinancialIntegrity(loan, await readPaymentTotals(this.totalsReader, manager, loanId), pending);
       const applications = await manager.query(`SELECT payment_plan_entry_id AS "entryId", amount_applied AS "amountApplied", pending_before AS "pendingBefore", pending_after AS "pendingAfter", carried_forward_amount AS "carriedForwardAmount", carried_to_plan_entry_id AS "carriedToEntryId" FROM payment_applications WHERE payment_id = $1 FOR UPDATE`, [paymentId]) as Application[];
       const reversedPending = this.validateConsolidationReversal(consolidation, plan, paymentId, loanId);
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
         exact &&= cents(reversedPending.get(source.id) ?? source.pendingAmount) === cents(application.pendingAfter);
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
       if (consolidation && !exact) throw new PaymentConflictError('The consolidated payment applications cannot be safely reversed.');
       const target = exact ? undefined : (plan.find((entry) => cents(entry.pendingAmount) > 0n) ?? plan.find((entry) => sources.has(entry.id)));
      if (!exact && !target) throw new PaymentConflictError('No current plan entry can receive the restored balance.');
        const inserted = await manager.query(`INSERT INTO payment_annulments
          (payment_id, reason, annulment_type, created_by_user_id, idempotency_key, idempotency_fingerprint)
          VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id, payment_id AS "paymentId", reason,
          annulment_type AS "annulmentType", annulled_at AS "annulledAt", created_by_user_id AS "createdByUserId"`,
        [paymentId, trimmedReason, annulmentType, actorId, idempotencyKey, fingerprint]);
        if (!inserted[0]) throw new PaymentConflictError('The payment has already been annulled or the key is in use.');
        if (inserted[0].paymentId !== paymentId) throw new PaymentConflictError('The annulment payment does not match the locked payment.');
       if (consolidation) await this.consolidationWriter!.reverse(manager, consolidation, inserted[0].id);
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

  private validateConsolidationReversal(consolidation: LockedPaymentPlanConsolidation | null,
    plan: Array<{ id: string; loanId: string; dueDate: string; sequence: number; pendingAmount: string }>,
    paymentId: string, loanId: string): Map<string, string> {
    const reversed = new Map<string, string>();
    if (!consolidation) return reversed;
    if (consolidation.paymentId !== paymentId || consolidation.loanId !== loanId || !MONEY.test(consolidation.totalMoved)) {
      throw new PaymentConflictError('The payment plan consolidation identity does not reconcile.');
    }
    const target = plan.find((entry) => entry.id === consolidation.target.planEntryId);
    if (!target || target.loanId !== loanId || target.dueDate !== consolidation.target.dueDate
      || target.sequence !== consolidation.target.sequence || !MONEY.test(consolidation.target.pendingBefore)
      || !MONEY.test(consolidation.target.pendingAfter)
      || cents(target.pendingAmount) !== cents(consolidation.target.pendingAfter)
      || cents(consolidation.target.pendingAfter) - cents(consolidation.target.pendingBefore) !== cents(consolidation.totalMoved)) {
      throw new PaymentConflictError('The payment plan consolidation target cannot be safely reversed.');
    }
    reversed.set(target.id, consolidation.target.pendingBefore);
    const sourceIds = new Set<string>();
    let sourceTotal = 0n;
    for (const source of consolidation.sources) {
      const row = plan.find((entry) => entry.id === source.planEntryId);
      if (!row || row.loanId !== loanId || sourceIds.has(source.planEntryId) || source.planEntryId === target.id
        || row.dueDate !== source.dueDate || row.sequence !== source.sequence || !MONEY.test(source.amountMoved)
        || !MONEY.test(source.pendingBefore) || !MONEY.test(source.pendingAfter)
        || cents(row.pendingAmount) !== cents(source.pendingAfter)
        || cents(source.pendingBefore) - cents(source.pendingAfter) !== cents(source.amountMoved)) {
        throw new PaymentConflictError('A payment plan consolidation source cannot be safely reversed.');
      }
      sourceIds.add(source.planEntryId); sourceTotal += cents(source.amountMoved);
      reversed.set(source.planEntryId, source.pendingBefore);
    }
    if (sourceIds.size === 0 || sourceTotal !== cents(consolidation.totalMoved)) {
      throw new PaymentConflictError('The payment plan consolidation sources do not reconcile.');
    }
    return reversed;
  }
}

export class PaymentContextUseCase {
  constructor(private readonly dataSource: DataSource, private readonly totalsReader: LoanFinancialTotalsReader,
    private readonly consolidationHistory?: PaymentPlanConsolidationHistoryReader) {}
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
        ) AS "isProtected" FROM payment_plan_entries e WHERE e.loan_id = $1 ORDER BY e.due_date, e.sequence, e.id`, [loanId]) as Array<{ id: string; dueDate: string; sequence: number; pendingAmount: string; isProtected?: boolean }>;
        const protectedPlanEntryIds = planRows.filter((entry) => entry.isProtected === true && cents(entry.pendingAmount) > 0n).map((entry) => entry.id);
        const rawApplications = await readPaymentApplications(this.dataSource, loanId);
        const numberedPlan = numberCurrentPaymentPlan(planRows, rawApplications);
        const combinedPlan = numberedPlan.filter((entry) => cents(entry.pendingAmount) > 0n)
          .map(({ id, dueDate, sequence, pendingAmount }) => ({ id, dueDate, sequence, pendingAmount }));
         const row = summary[0];
         const { intervalUnit, intervalValue, ...summaryRow } = row;
         const totals = await readPaymentTotals(this.totalsReader, this.dataSource, loanId);
        const balances = assertFinancialIntegrity(row, totals, combinedPlan.reduce((sum: bigint, entry: { pendingAmount: string }) => sum + cents(entry.pendingAmount), 0n));
       const methods = await this.dataSource.query(`SELECT id, name FROM payment_methods WHERE is_active = true ORDER BY name, id`);
        const collectors = await this.dataSource.query(`SELECT id, concat_ws(' ', first_name, first_last_name, second_last_name) AS name FROM collectors WHERE is_active = true ORDER BY name, id`);
       const preferredMethod = { id: row.preferredMethodId, activeMethods: methods, collectors };
          const applications = alignApplicationSequences(rawApplications, numberedPlan);
         const consolidations = await this.consolidationHistory?.read(loanId) ?? [];
         const projection = buildPaymentProjection(combinedPlan, payments, row.totalAmount, row.interestAmount, today(), applications);
        const validPayments = attachPaymentApplications(projection.validPayments, applications);
        const lastValidPayment = projection.lastValidPayment ? validPayments.find((payment) => payment.id === projection.lastValidPayment?.id) ?? null : null;
             return buildPaymentContext({ summary: { ...summaryRow, paidAmount: money(cents(totals.paidAmount)) }, balances: { financialBalance: money(balances.financialBalance), outstandingPrincipal: money(balances.outstandingPrincipal), outstandingInterest: money(balances.outstandingInterest) }, combinedPlan: projection.combinedPlan, validPayments, lastValidPayment, refinanceEligibility: projection.refinanceEligibility, preferredMethod, paymentFrequency: { intervalUnit, intervalValue }, protectedPlanEntryIds, collectionProjection: projection.collectionProjection, consolidations });
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
