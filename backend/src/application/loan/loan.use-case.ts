import { createHash } from 'crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { TransactionalCashMovementRecorder } from '../cash-movement/cash-movement.use-cases';
import type { ActiveLoanListQuery, CreateLoanInput, LoanSortBy } from '../../domain/loan/loan.types';
import { ACTIVE_LOAN_OVERDUE_SQL } from './active-loan-condition.sql';
import { paymentPlanDateIssue } from '../../domain/payment/payment-plan-dates';
import type { RetroactivePeriodGuard } from '../financial-close/retroactive-period.guard';
import { ClosedFinancialPeriodError } from '../../domain/financial-close/financial-close.errors';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const dateOk = (value: string) => DATE.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const money = (value: string) => `${value.split('.')[0]}.${(value.split('.')[1] ?? '').padEnd(2, '0')}`;
const cents = (value: string) => { const [whole, decimal = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0')); };
const moneyFromCents = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const today = () => new Date().toISOString().slice(0, 10);
const PENDING_TOTAL_SQL = 'COALESCE((SELECT SUM(pe.pending_amount) FROM payment_plan_entries pe WHERE pe.loan_id=l.id AND pe.pending_amount > 0),0)::numeric(18,2)';
const LOAN_SORT_COLUMNS: Record<LoanSortBy, string> = {
  number: 'l.loan_number',
  customer: "LOWER(CONCAT_WS(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name))",
  startDate: 'l.start_date',
  principal: 'l.principal',
  interest: 'l.interest_amount',
  total: 'l.total_amount',
  frequency: 'LOWER(pf.name)',
  pending: PENDING_TOTAL_SQL,
  condition: '"isOverdue"',
};

export class LoanValidationError extends Error {}
export class LoanConflictError extends Error {}

export function normalizeLoanInput(input: CreateLoanInput): CreateLoanInput {
  return { ...input, principal: money(input.principal), interestAmount: money(input.interestAmount), observations: input.observations?.trim().toUpperCase() || undefined, plan: input.plan.map((entry, index) => ({ sequence: index + 1, dueDate: entry.dueDate, pendingAmount: money(entry.pendingAmount) })) };
}
export function calculateLoanTotal(principal: string, interestAmount: string): string { return moneyFromCents(cents(money(principal)) + cents(money(interestAmount))); }
export function loanPlanMatchesTotal(input: CreateLoanInput): boolean { return input.plan.reduce((sum, entry) => sum + cents(entry.pendingAmount), 0n) === cents(input.principal) + cents(input.interestAmount); }
export function loanPlanDatesAreValid(input: CreateLoanInput): boolean {
  return paymentPlanDateIssue(input.startDate, input.plan.map((entry) => entry.dueDate)) === null;
}
function fingerprint(input: CreateLoanInput): string { const request = { ...input }; delete request.idempotencyKey; return createHash('sha256').update(JSON.stringify(request)).digest('hex'); }

export class CreateLoanUseCase {
  constructor(private readonly dataSource: DataSource, private readonly cashMovements: TransactionalCashMovementRecorder,
    private readonly closedPeriods?: RetroactivePeriodGuard) {}

  async execute(raw: CreateLoanInput, actorId: string) {
    if (!raw || !raw.customerId || !raw.paymentFrequencyId || !raw.preferredPaymentMethodId || !raw.disbursementPaymentMethodId || !raw.startDate || !MONEY.test(raw.principal) || !MONEY.test(raw.interestAmount)) throw new LoanValidationError('Los datos del préstamo no son válidos.');
    const input = normalizeLoanInput(raw);
    if (!dateOk(input.startDate) || input.startDate > today() || cents(input.principal) <= 0n || cents(input.interestAmount) < 0n) throw new LoanValidationError('La fecha o los importes del préstamo no son válidos.');
    if (!Array.isArray(input.plan) || input.plan.length < 1 || input.plan.some((entry) => !MONEY.test(entry.pendingAmount) || cents(entry.pendingAmount) <= 0n)) throw new LoanValidationError('El plan de pago no es válido.');
    const planDateIssue = paymentPlanDateIssue(input.startDate, input.plan.map((entry) => entry.dueDate));
    if (planDateIssue === 'sunday') throw new LoanValidationError('Los domingos no son días de cobro.');
    if (planDateIssue === 'duplicate') throw new LoanValidationError('Ya existe una cuota programada para esta fecha.');
    if (planDateIssue !== null) throw new LoanValidationError('Las fechas del plan deben ser válidas, posteriores al inicio y estar en orden.');
    if (!loanPlanMatchesTotal(input)) throw new LoanValidationError('El plan de pago debe reconciliar exactamente con el total del préstamo.');
    const fp = fingerprint(input);
    return this.dataSource.transaction(async (manager) => {
      if (input.idempotencyKey) {
        const existing = await manager.query('SELECT id, idempotency_fingerprint AS "fingerprint" FROM loans WHERE idempotency_key = $1 FOR SHARE', [input.idempotencyKey]);
        if (existing[0]) { if (existing[0].fingerprint !== fp) throw new LoanConflictError('La clave de idempotencia ya fue utilizada con otros datos.'); return this.detail(manager, existing[0].id); }
      }
      try { await this.closedPeriods?.assertDateAllowed(input.startDate, manager); }
      catch (error) { if (error instanceof ClosedFinancialPeriodError) throw new LoanConflictError(error.message); throw error; }
      const opening = await manager.query(`SELECT opening_date AS "openingDate" FROM financial_openings WHERE singleton_key = 'DEFAULT' FOR SHARE`);
      if (!opening[0]) throw new LoanConflictError('Debe realizar la apertura financiera antes de registrar préstamos.');
      if (input.startDate < opening[0].openingDate) throw new LoanValidationError('La fecha de inicio no puede ser anterior a la apertura financiera.');
      const activeCustomer = await manager.query('SELECT id FROM customers WHERE id = $1 AND is_active = true', [input.customerId]);
      const activeFrequency = await manager.query('SELECT id FROM payment_frequencies WHERE id = $1 AND is_active = true', [input.paymentFrequencyId]);
      const activeMethods = await manager.query('SELECT id FROM payment_methods WHERE id = ANY($1::uuid[]) AND is_active = true', [[input.preferredPaymentMethodId, input.disbursementPaymentMethodId]]);
      if (!activeCustomer[0]) throw new LoanValidationError('El cliente no existe o está inactivo.');
      if (!activeFrequency[0]) throw new LoanValidationError('La frecuencia no existe o está inactiva.');
      if (activeMethods.length !== new Set([input.preferredPaymentMethodId, input.disbursementPaymentMethodId]).size) throw new LoanValidationError('Las formas de pago deben existir y estar activas.');
      let loanId: string;
      let loanInserted = false;
      try {
         const totalAmount = calculateLoanTotal(input.principal, input.interestAmount);
         loanId = await manager.transaction(async (nestedManager) => {
            const loan: { id: string; created_at: Date; created_by_user_id: string }[] = await nestedManager.query('INSERT INTO loans (customer_id, payment_frequency_id, preferred_payment_method_id, start_date, principal, interest_amount, total_amount, observations, status, created_by_user_id, idempotency_key, idempotency_fingerprint) VALUES ($1,$2,$3,$4,$5::numeric(18,2),$6::numeric(18,2),$7::numeric(18,2),$8,\'ACTIVE\',$9,$10,$11) RETURNING id, created_at, created_by_user_id', [input.customerId, input.paymentFrequencyId, input.preferredPaymentMethodId, input.startDate, input.principal, input.interestAmount, totalAmount, input.observations ?? null, actorId, input.idempotencyKey ?? null, fp]);
           loanInserted = true;
            await nestedManager.query('INSERT INTO loan_status_history (loan_id, event_sequence, event_kind, from_status, to_status, changed_at, changed_by_user_id, reason, payment_id, payment_annulment_id) VALUES ($1,1,\'CREATED\',NULL,\'ACTIVE\',$2,$3,NULL,NULL,NULL)', [loan[0].id, loan[0].created_at, loan[0].created_by_user_id]);
           return loan[0].id;
         });
      } catch (error) {
        if (!loanInserted && input.idempotencyKey && (error as { code?: string; constraint?: string }).code === '23505' && (error as { constraint?: string }).constraint === 'UQ_loans_idempotency') {
          const existing = await manager.query('SELECT id, idempotency_fingerprint AS "fingerprint" FROM loans WHERE idempotency_key = $1 FOR SHARE', [input.idempotencyKey]);
          if (existing[0]?.fingerprint === fp) return this.detail(manager, existing[0].id);
          throw new LoanConflictError('La clave de idempotencia ya fue utilizada con otros datos.');
        }
        throw error;
      }
      for (const entry of input.plan) await manager.query('INSERT INTO payment_plan_entries (loan_id, sequence, due_date, pending_amount) VALUES ($1,$2,$3,$4)', [loanId, entry.sequence, entry.dueDate, entry.pendingAmount]);
      const disbursement = await manager.query('INSERT INTO loan_disbursements (loan_id, amount, payment_method_id, disbursement_date, created_by_user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id', [loanId, input.principal, input.disbursementPaymentMethodId, input.startDate, actorId]);
      await this.cashMovements.recordWithManager(manager, { direction: 'OUTFLOW', concept: 'LOAN_DISBURSEMENT', amount: input.principal, movementDate: input.startDate, paymentMethodId: input.disbursementPaymentMethodId, observations: `Desembolso de préstamo ${loanId}`, loanDisbursementId: disbursement[0].id, createdByUserId: actorId, idempotencyKey: `loan-disbursement:${disbursement[0].id}`, idempotencyFingerprint: createHash('sha256').update(`${disbursement[0].id}:${input.principal}`).digest('hex') });
      return this.detail(manager, loanId);
    });
  }

  async detail(manager: Pick<EntityManager, 'query'>, id: string, includeOperational = false) {
     const rows = await manager.query(`SELECT l.id, l.loan_number AS "loanNumber", l.status, l.start_date AS "startDate", l.principal, l.interest_amount AS "interestAmount", l.total_amount AS "totalAmount", l.observations, l.updated_at AS "updatedAt", c.id AS "customerId", concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) AS "customerName", c.identification, pf.id AS "paymentFrequencyId", pf.name AS "frequencyName", pf.interval_unit AS "intervalUnit", pf.interval_value AS "intervalValue", u.full_name AS "createdByName", pm.id AS "preferredPaymentMethodId", pm.name AS "preferredPaymentMethod", dm.name AS "disbursementPaymentMethod", COALESCE((SELECT SUM(pe.pending_amount) FROM payment_plan_entries pe WHERE pe.loan_id=l.id AND pe.pending_amount > 0),0)::numeric(18,2)::text AS "pendingTotal" FROM loans l JOIN customers c ON c.id=l.customer_id JOIN payment_frequencies pf ON pf.id=l.payment_frequency_id JOIN payment_methods pm ON pm.id=l.preferred_payment_method_id LEFT JOIN loan_disbursements d ON d.loan_id=l.id LEFT JOIN payment_methods dm ON dm.id=d.payment_method_id JOIN users u ON u.id=l.created_by_user_id WHERE l.id=$1`, [id]);
    if (!rows[0]) throw new LoanValidationError('El préstamo no existe.');
    const plan = await manager.query(includeOperational
      ? 'SELECT id, sequence, due_date::text AS "dueDate", pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id=$1 ORDER BY sequence'
      : 'SELECT sequence, due_date AS "dueDate", pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id=$1 ORDER BY sequence', [id]);
    return { ...rows[0], plan };
  }
  async get(id: string) {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const loan = await this.detail(manager, id, true);
      const validPayments: Array<{ id: string; amount: string; paymentDate: string; status: 'VALID' }> = await manager.query('SELECT id, amount::text AS amount, payment_date::text AS "paymentDate", status FROM payments WHERE loan_id=$1 AND status=\'VALID\' ORDER BY payment_date, id', [id]);
      const paid = validPayments.reduce((sum, payment) => sum + cents(payment.amount), 0n);
      return { ...loan, financialBalance: moneyFromCents(cents(loan.totalAmount) - paid), validPayments };
    });
  }
}

export class ListLoansUseCase {
  constructor(private readonly dataSource: DataSource) {}
  async execute(query: ActiveLoanListQuery) {
    const conditions = ["l.status = 'ACTIVE'"]; const params: unknown[] = []; const add = (sql: string, value: unknown) => { params.push(value); conditions.push(sql.replace('?', `$${params.length}`)); };
    if (query.frequencyId) add('l.payment_frequency_id = ?', query.frequencyId); if (query.fromDate) add('l.start_date >= ?', query.fromDate); if (query.toDate) add('l.start_date <= ?', query.toDate);
    if (query.search) { params.push(`%${query.search}%`); const p = `$${params.length}`; conditions.push(`(l.loan_number::text ILIKE ${p} OR c.identification ILIKE ${p} OR concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) ILIKE ${p} OR c.primary_phone ILIKE ${p} OR c.secondary_phone ILIKE ${p} OR EXISTS (SELECT 1 FROM customer_addresses ca WHERE ca.customer_id=c.id AND ca.exact_address ILIKE ${p}))`); }
     const offset = (query.page - 1) * query.pageSize; const listParams = [...params, query.pageSize, offset];
     const sortColumn = LOAN_SORT_COLUMNS[query.sortBy ?? 'number']; const direction = (query.sortOrder ?? 'desc').toUpperCase();
     const orderBy = query.sortBy === 'number' || !query.sortBy ? `ORDER BY l.loan_number ${direction}, l.id ASC` : `ORDER BY ${sortColumn} ${direction}, l.loan_number DESC, l.id ASC`;
      const rows = await this.dataSource.query(`SELECT l.id,l.loan_number AS "loanNumber",l.start_date AS "startDate",l.principal,l.interest_amount AS "interestAmount",l.total_amount AS "totalAmount", concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) AS "customerName",c.identification,pf.name AS "frequencyName", ${PENDING_TOTAL_SQL}::text AS "pendingTotal", ${ACTIVE_LOAN_OVERDUE_SQL} AS "isOverdue" FROM loans l JOIN customers c ON c.id=l.customer_id JOIN payment_frequencies pf ON pf.id=l.payment_frequency_id WHERE ${conditions.join(' AND ')} ${orderBy} LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`, listParams);
    const count = await this.dataSource.query(`SELECT COUNT(*)::int AS total FROM loans l JOIN customers c ON c.id=l.customer_id WHERE ${conditions.join(' AND ')}`, params);
    return { items: rows, total: count[0]?.total ?? 0, page: query.page, pageSize: query.pageSize };
  }
}

export class ListActiveLoanCustomersUseCase {
  constructor(private readonly dataSource: DataSource) {}
  execute(query: { page: number; pageSize: number; search?: string }) {
    const params: unknown[] = []; const filters = ['c.is_active = true'];
    if (query.search?.trim()) { params.push(`%${query.search.trim()}%`); const p = `$${params.length}`; filters.push(`(c.identification ILIKE ${p} OR concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) ILIKE ${p} OR c.primary_phone ILIKE ${p} OR EXISTS (SELECT 1 FROM customer_addresses ca WHERE ca.customer_id=c.id AND ca.exact_address ILIKE ${p}))`); }
    const offset = (query.page - 1) * query.pageSize; params.push(query.pageSize, offset);
    return this.dataSource.query(`SELECT c.id, c.identification, concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS "fullName", c.primary_phone AS "primaryPhone", ca.exact_address AS address FROM customers c LEFT JOIN customer_addresses ca ON ca.customer_id=c.id WHERE ${filters.join(' AND ')} ORDER BY "fullName" LIMIT $${params.length - 1} OFFSET $${params.length}`, params).then(async (items) => { const count = await this.dataSource.query(`SELECT COUNT(*)::int AS total FROM customers c WHERE ${filters.join(' AND ')}`, params.slice(0, -2)); return { items, total: count[0]?.total ?? 0, page: query.page, pageSize: query.pageSize }; });
  }
}
