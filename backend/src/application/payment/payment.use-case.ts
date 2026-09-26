import { createHash } from 'crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { allocatePayment } from '../../domain/payment/payment-allocation';
import type { PaymentInput } from '../../domain/payment/payment.types';
import { assertPaymentDate, isLastValidPayment, paymentFingerprint } from '../../domain/payment/payment-rules';
import { buildPaymentProjection } from '../../domain/payment/payment-projection';
import { buildPaymentContext, validatePlanCustomization } from '../../domain/payment/payment-invariants';

const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cents = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); };
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const today = () => new Date().toISOString().slice(0, 10);

export class PaymentValidationError extends Error {}
export class PaymentConflictError extends Error {}
export class PaymentNotFoundError extends Error {}

export class RegisterPaymentUseCase {
  constructor(private readonly dataSource: DataSource) {}

  async execute(input: PaymentInput, actorId: string) {
    if (!input?.loanId || !input.methodId || !input.idempotencyKey || !MONEY.test(input.amount) || cents(input.amount) <= 0n || !DATE.test(input.paymentDate) || input.paymentDate > today()) throw new PaymentValidationError('Payment data is invalid.');
    const fp = paymentFingerprint({ loanId: input.loanId, amount: input.amount, paymentDate: input.paymentDate, methodId: input.methodId, collectorId: input.collectorId });
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.query('SELECT id, idempotency_fingerprint AS "fingerprint" FROM payments WHERE idempotency_key = $1 FOR SHARE', [input.idempotencyKey]);
      if (existing[0]) { if (existing[0].fingerprint !== fp) throw new PaymentConflictError('The idempotency key was used with different data.'); return this.detail(manager, existing[0].id); }
      const loan = await manager.query(`SELECT id, status, start_date AS "startDate", total_amount AS "totalAmount", principal, interest_amount AS "interestAmount" FROM loans WHERE id = $1 FOR UPDATE`, [input.loanId]);
      if (!loan[0]) throw new PaymentNotFoundError('The loan does not exist.');
      if (loan[0].status !== 'ACTIVE') throw new PaymentValidationError('Only active loans accept payments.');
      const opening = await manager.query(`SELECT opening_date AS "openingDate" FROM financial_openings WHERE singleton_key = 'DEFAULT' FOR SHARE`);
      if (!opening[0]) throw new PaymentValidationError('The financial opening is required.');
      try { assertPaymentDate(opening[0].openingDate, loan[0].startDate, input.paymentDate, today()); } catch { throw new PaymentValidationError('The payment date is outside the operational period.'); }
      const method = await manager.query('SELECT id FROM payment_methods WHERE id = $1 AND is_active = true', [input.methodId]);
      if (!method[0]) throw new PaymentValidationError('The payment method is inactive or does not exist.');
      if (input.collectorId) { const collector = await manager.query('SELECT id FROM collectors WHERE id = $1 AND is_active = true', [input.collectorId]); if (!collector[0] || input.collectorId === actorId) throw new PaymentValidationError('The collector is invalid.'); }
       const entries = await manager.query(`SELECT id, due_date AS "dueDate", sequence, pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0 ORDER BY due_date, sequence, id FOR UPDATE`, [input.loanId]);
       const paidPrincipal = await manager.query(`SELECT COALESCE(SUM(principal_applied), 0)::numeric(18,2)::text AS amount FROM payments WHERE loan_id = $1 AND status = 'VALID'`, [input.loanId]);
       const outstandingPrincipal = cents(loan[0].principal) - cents(paidPrincipal[0].amount);
       let principalRemaining = outstandingPrincipal;
       const allocationEntries = entries.map((entry: { id: string; dueDate: string; sequence: number; pendingAmount: string }) => {
         const pending = cents(entry.pendingAmount);
         const principalPending = pending < principalRemaining ? pending : principalRemaining > 0n ? principalRemaining : 0n;
         principalRemaining -= principalPending;
         return { ...entry, principalPending: money(principalPending), interestPending: money(pending - principalPending) };
       });
       const balance = entries.reduce((sum: bigint, entry: { pendingAmount: string }) => sum + cents(entry.pendingAmount), 0n);
      if (cents(input.amount) > balance) throw new PaymentValidationError('The payment exceeds the financial balance.');
       const allocation = allocatePayment(input.amount, allocationEntries);
      const payment = await manager.query(`INSERT INTO payments (loan_id, amount, principal_applied, interest_applied, payment_date, method_id, collector_id, created_by_user_id, status, idempotency_key, idempotency_fingerprint) VALUES ($1,$2::numeric(18,2),$3::numeric(18,2),$4::numeric(18,2),$5,$6,$7,$8,'VALID',$9,$10) RETURNING id`, [input.loanId, input.amount, allocation.principalApplied, allocation.interestApplied, input.paymentDate, input.methodId, input.collectorId ?? null, actorId, input.idempotencyKey, fp]);
      for (const application of allocation.applications.filter((item) => item.amountApplied !== '0.00')) {
        await manager.query(`UPDATE payment_plan_entries SET pending_amount = $1::numeric(18,2), updated_at = now() WHERE id = $2`, [application.pendingAfter, application.planEntryId]);
        await manager.query(`INSERT INTO payment_applications (payment_id, payment_plan_entry_id, amount_applied, pending_before, pending_after, carried_forward_amount, carried_to_plan_entry_id) VALUES ($1,$2,$3::numeric(18,2),$4::numeric(18,2),$5::numeric(18,2),$6::numeric(18,2),$7)`, [payment[0].id, application.planEntryId, application.amountApplied, application.pendingBefore, application.pendingAfter, application.carriedForwardAmount, application.carriedToPlanEntryId]);
      }
      const cash = await manager.query(`INSERT INTO cash_movements (direction, concept, amount, movement_date, payment_method_id, observations, created_by_user_id, idempotency_key, idempotency_fingerprint, payment_id) VALUES ('INFLOW','CUSTOMER_PAYMENT',$1::numeric(18,2),$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [input.amount, input.paymentDate, input.methodId, `Customer payment ${payment[0].id}`, actorId, `payment:${input.idempotencyKey}`, fp, payment[0].id]);
      return { ...(await this.detail(manager, payment[0].id)), cashId: cash[0].id };
    });
  }

  async detail(manager: Pick<EntityManager, 'query'>, id: string) {
    const payment = await manager.query(`SELECT id, loan_id AS "loanId", amount, principal_applied AS "principalApplied", interest_applied AS "interestApplied", payment_date AS "paymentDate", method_id AS "methodId", collector_id AS "collectorId", created_by_user_id AS "createdByUserId", status, created_at AS "createdAt" FROM payments WHERE id = $1`, [id]);
    if (!payment[0]) throw new PaymentNotFoundError('The payment does not exist.');
    const applications = await manager.query(`SELECT payment_plan_entry_id AS "paymentPlanEntryId", amount_applied AS "amountApplied", pending_before AS "pendingBefore", pending_after AS "pendingAfter", carried_forward_amount AS "carriedForwardAmount", carried_to_plan_entry_id AS "carriedToPlanEntryId", created_at AS "createdAt" FROM payment_applications WHERE payment_id = $1 ORDER BY created_at, payment_plan_entry_id`, [id]);
    return { ...payment[0], applications };
  }

  async annul(paymentId: string, reason: string, idempotencyKey: string, actorId: string) {
    if (!reason?.trim() || !idempotencyKey?.trim()) throw new PaymentValidationError('An annulment reason and idempotency key are required.');
    return this.dataSource.transaction(async (manager) => {
      const payment = await manager.query(`SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [paymentId]);
      if (!payment[0]) throw new PaymentNotFoundError('The payment does not exist.');
      if (payment[0].status !== 'VALID') throw new PaymentConflictError('Only valid payments can be annulled.');
      const validPayments = await manager.query(`SELECT id, status, payment_date AS "paymentDate", created_at AS "createdAt" FROM payments WHERE loan_id = $1`, [payment[0].loan_id]);
      if (!isLastValidPayment(paymentId, validPayments)) throw new PaymentConflictError('Only the last valid payment can be annulled.');
      const opening = await manager.query(`SELECT opening_date AS "openingDate" FROM financial_openings WHERE singleton_key = 'DEFAULT' FOR SHARE`);
      if (!opening[0] || today() < opening[0].openingDate) throw new PaymentConflictError('The financial opening does not permit an annulment today.');
      const annulmentFingerprint = createHash('sha256').update(JSON.stringify({ paymentId, reason: reason.trim() })).digest('hex');
      const existing = await manager.query('SELECT id, payment_id AS "paymentId", idempotency_fingerprint AS "fingerprint" FROM payment_annulments WHERE idempotency_key = $1', [idempotencyKey]);
      if (existing[0]) { if (existing[0].fingerprint !== annulmentFingerprint) throw new PaymentConflictError('The annulment idempotency key was used with different data.'); return this.detail(manager, existing[0].paymentId); }
      const applications = await manager.query('SELECT payment_plan_entry_id AS "entryId", amount_applied AS "amountApplied" FROM payment_applications WHERE payment_id = $1 FOR UPDATE', [paymentId]);
       for (const application of applications) await manager.query('UPDATE payment_plan_entries SET pending_amount = pending_amount + $1::numeric(18,2), updated_at = now() WHERE id = $2', [application.amountApplied, application.entryId]);
       await manager.query(`UPDATE loans SET status = 'ACTIVE', updated_at = now() WHERE id = $1 AND status = 'CANCELLED' AND EXISTS (SELECT 1 FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0)`, [payment[0].loan_id]);
      await manager.query(`UPDATE payments SET status = 'ANNULLED' WHERE id = $1` , [paymentId]);
      await manager.query(`INSERT INTO payment_annulments (payment_id, reason, created_by_user_id, idempotency_key, idempotency_fingerprint) VALUES ($1,$2,$3,$4,$5)`, [paymentId, reason.trim(), actorId, idempotencyKey, annulmentFingerprint]);
      const original = await manager.query(`SELECT * FROM cash_movements WHERE payment_id = $1 FOR UPDATE`, [paymentId]);
      if (!original[0]) throw new PaymentConflictError('The payment has no linked cash inflow.');
      await manager.query(`INSERT INTO cash_movements (direction, concept, amount, movement_date, payment_method_id, observations, reversed_movement_id, created_by_user_id, idempotency_key, idempotency_fingerprint) VALUES ('OUTFLOW','REVERSAL',$1::numeric(18,2),$2,$3,$4,$5,$6,$7,$8)`, [original[0].amount, today(), original[0].payment_method_id, reason.trim(), original[0].id, actorId, `payment-annulment:${idempotencyKey}`, createHash('sha256').update(`${paymentId}:${idempotencyKey}`).digest('hex')]);
      return this.detail(manager, paymentId);
    });
  }
}

export class PaymentContextUseCase {
  constructor(private readonly dataSource: DataSource) {}
  listLoans(query: { search?: string; page: number; pageSize: number }) {
    const params: unknown[] = []; const filters = [`l.status = 'ACTIVE'`];
    if (query.search?.trim()) { params.push(`%${query.search.trim()}%`); filters.push(`(l.loan_number::text ILIKE $${params.length} OR c.identification ILIKE $${params.length} OR concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) ILIKE $${params.length})`); }
    params.push(query.pageSize, (query.page - 1) * query.pageSize);
    return this.dataSource.query(`SELECT l.id, l.loan_number AS "loanNumber", concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS "customerName", l.total_amount AS "totalAmount", (l.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.loan_id = l.id AND p.status = 'VALID'), 0))::numeric(18,2)::text AS "financialBalance" FROM loans l JOIN customers c ON c.id = l.customer_id WHERE ${filters.join(' AND ')} ORDER BY l.loan_number DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params).then(async (items) => ({ items, total: items.length, page: query.page, pageSize: query.pageSize }));
  }
   execute(loanId: string) {
     return this.dataSource.query(`SELECT l.id AS "loanId", l.loan_number AS "loanNumber", l.status, l.total_amount AS "totalAmount", l.principal, l.interest_amount AS "interestAmount", l.preferred_payment_method_id AS "preferredMethodId", COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.loan_id = l.id AND p.status = 'VALID'), 0)::numeric(18,2)::text AS "paidAmount", COALESCE((SELECT SUM(e.pending_amount) FROM payment_plan_entries e WHERE e.loan_id = l.id AND e.pending_amount > 0), 0)::numeric(18,2)::text AS "pendingAmount" FROM loans l WHERE l.id = $1`, [loanId]).then(async (summary) => {
      if (!summary[0]) throw new PaymentNotFoundError('The loan does not exist.');
       const payments = await this.dataSource.query(`SELECT id, amount, payment_date AS "paymentDate", status, created_at AS "createdAt" FROM payments WHERE loan_id = $1 ORDER BY payment_date, created_at, id`, [loanId]);
       const combinedPlan = await this.dataSource.query(`SELECT id, due_date AS "dueDate", sequence, pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0 ORDER BY due_date, sequence, id`, [loanId]);
       const row = summary[0];
       const methods = await this.dataSource.query(`SELECT id, name FROM payment_methods WHERE is_active = true ORDER BY name, id`);
        const collectors = await this.dataSource.query(`SELECT id, concat_ws(' ', first_name, first_last_name, second_last_name) AS name FROM collectors WHERE is_active = true ORDER BY name, id`);
       const preferredMethod = { id: row.preferredMethodId, activeMethods: methods, collectors };
      const projection = buildPaymentProjection(combinedPlan, payments, row.totalAmount, row.interestAmount);
      const balance = money(cents(row.totalAmount) - cents(row.paidAmount));
       return buildPaymentContext({ summary: row, balances: { financialBalance: balance, outstandingPrincipal: money(cents(row.principal) - cents(row.paidAmount)) }, combinedPlan: projection.combinedPlan, lastValidPayment: projection.lastValidPayment, refinanceEligibility: projection.refinanceEligibility, preferredMethod });
    });
  }
}

export class CustomizePaymentPlanUseCase {
  constructor(private readonly dataSource: DataSource) {}
  async execute(loanId: string, entries: Array<{ dueDate: string; pendingAmount: string }>, idempotencyKey: string) {
    if (!idempotencyKey?.trim()) throw new PaymentValidationError('The payment plan is invalid.');
    const planFingerprint = paymentFingerprint({ loanId, entries: JSON.stringify(entries) });
    return this.dataSource.transaction(async (manager) => {
      const loan = await manager.query(`SELECT start_date AS "startDate", total_amount AS "totalAmount", payment_plan_idempotency_key AS "idempotencyKey", payment_plan_idempotency_fingerprint AS "fingerprint" FROM loans WHERE id = $1 AND status = 'ACTIVE' FOR UPDATE`, [loanId]);
      if (!loan[0]) throw new PaymentNotFoundError('The active loan does not exist.');
      if (loan[0].idempotencyKey === idempotencyKey) { if (loan[0].fingerprint !== planFingerprint) throw new PaymentConflictError('The plan idempotency key was used with different data.'); return manager.query(`SELECT id, due_date AS "dueDate", sequence, pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0 ORDER BY due_date, sequence, id`, [loanId]); }
      const current = await manager.query(`SELECT id, pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0 ORDER BY due_date, sequence, id FOR UPDATE`, [loanId]);
      const paid = await manager.query(`SELECT COALESCE(SUM(amount),0)::numeric(18,2)::text AS amount FROM payments WHERE loan_id = $1 AND status = 'VALID'`, [loanId]);
      const balance = cents(loan[0].totalAmount) - cents(paid[0].amount);
       try { validatePlanCustomization(entries, loan[0].startDate, money(balance)); } catch { throw new PaymentConflictError('The payment plan does not reconcile with the current balance.'); }
      for (let i = 0; i < entries.length; i += 1) { if (current[i]) await manager.query('UPDATE payment_plan_entries SET due_date = $1, pending_amount = $2::numeric(18,2), sequence = $3, updated_at = now() WHERE id = $4', [entries[i].dueDate, entries[i].pendingAmount, i + 1, current[i].id]); else await manager.query('INSERT INTO payment_plan_entries (loan_id, sequence, due_date, pending_amount) VALUES ($1,$2,$3,$4::numeric(18,2))', [loanId, i + 1, entries[i].dueDate, entries[i].pendingAmount]); }
      for (const old of current.slice(entries.length)) await manager.query('UPDATE payment_plan_entries SET pending_amount = 0, updated_at = now() WHERE id = $1', [old.id]);
      await manager.query('UPDATE loans SET payment_plan_idempotency_key = $1, payment_plan_idempotency_fingerprint = $2, updated_at = now() WHERE id = $3', [idempotencyKey, planFingerprint, loanId]);
      return manager.query(`SELECT id, due_date AS "dueDate", sequence, pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0 ORDER BY due_date, sequence, id`, [loanId]);
    });
  }
}
