import { createHash } from 'crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { TransactionalCashMovementRecorder } from '../../../../application/cash-movement/cash-movement.use-cases';
import { getNextLoanStatusEventSequence } from '../../../../application/loan/loan-status-history-sequence';
import { MAX_REFINANCING_GRAPH_EDGES } from '../../../../application/loan-refinancing/refinancing-chain';
import type { LoanFinancialTotalsReader } from '../../../../application/loan/loan-financial-totals.reader';
import type { NewRefinancing, RefinancingCandidate, RefinancingChainCustomer, RefinancingChainGraph, RefinancingChainLoanRow, RefinancingChainTransitionRow, RefinancingListItem, RefinancingListQuery, RefinancingOperation, RefinancingSearchQuery, RefinancingStore, RefinancingTransaction } from '../../../../application/loan-refinancing/refinancing.port';
import type { RefinancingSnapshot } from '../../../../domain/loan-refinancing/refinancing-finance';
import { VALID_PAYMENT_TOTALS_SELECT } from './loan-financial-totals.reader';

const operationSql = `SELECT r.id, r.origin_loan_id AS "originLoanId", origin.loan_number::text AS "originLoanNumber",
  r.new_loan_id AS "newLoanId", successor.loan_number::text AS "newLoanNumber",
  r.outstanding_principal_transferred::text AS "outstandingPrincipalTransferred",
  r.capitalized_outstanding_interest::text AS "capitalizedOutstandingInterest",
  r.new_money_disbursed::text AS "newMoneyDisbursed", r.new_interest_amount::text AS "newInterestAmount",
  r.new_contractual_principal::text AS "newContractualPrincipal", r.new_contractual_total::text AS "newContractualTotal",
  r.refinancing_date::text AS "refinancingDate", r.created_by_user_id AS "createdByUserId",
  r.created_at AS "createdAt", origin.status AS "originStatus", successor.status AS "newStatus",
  origin.start_date::text AS "originStartDate", successor.start_date::text AS "newStartDate",
  c.id AS "customerId", concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) AS "customerName",
  c.identification AS "customerIdentification", u.full_name AS "createdByName", successor.observations,
  pf.id AS "paymentFrequencyId", pf.name AS "paymentFrequencyName", pf.interval_unit AS "intervalUnit",
  pf.interval_value AS "intervalValue", pm.id AS "preferredPaymentMethodId", pm.name AS "preferredPaymentMethodName",
  dm.name AS "disbursementPaymentMethodName",
  d.id AS "disbursementId", d.amount::text AS "disbursementAmount",
  d.disbursement_date::text AS "disbursementDate", d.payment_method_id AS "disbursementMethodId",
  m.id AS "cashMovementId", m.amount::text AS "cashAmount", m.movement_date::text AS "cashDate",
  m.payment_method_id AS "cashMethodId", m.direction AS "cashDirection", m.concept AS "cashConcept"
  FROM loan_refinancings r JOIN loans origin ON origin.id = r.origin_loan_id
  JOIN loans successor ON successor.id = r.new_loan_id
  JOIN customers c ON c.id = successor.customer_id JOIN users u ON u.id = r.created_by_user_id
  JOIN payment_frequencies pf ON pf.id = successor.payment_frequency_id
  JOIN payment_methods pm ON pm.id = successor.preferred_payment_method_id
  LEFT JOIN loan_disbursements d ON d.loan_id = successor.id
  LEFT JOIN payment_methods dm ON dm.id = d.payment_method_id
  LEFT JOIN cash_movements m ON m.loan_disbursement_id = d.id AND m.concept = 'REFINANCING_NEW_MONEY_DISBURSEMENT'
  WHERE r.id = $1`;

export class LoanRefinancingTypeormStore implements RefinancingStore {
  constructor(private readonly source: DataSource, private readonly totals: LoanFinancialTotalsReader,
    private readonly cash: TransactionalCashMovementRecorder) {}

  list(query: RefinancingListQuery): Promise<{ items: RefinancingListItem[]; total: number }> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (query.search) {
      params.push(`%${query.search}%`);
      const term = `$${params.length}`;
      conditions.push(`(origin.loan_number::text ILIKE ${term} OR successor.loan_number::text ILIKE ${term}
        OR c.identification ILIKE ${term} OR
        concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) ILIKE ${term})`);
    }
    if (query.customerId) { params.push(query.customerId); conditions.push(`c.id = $${params.length}`); }
    if (query.dateFrom) { params.push(query.dateFrom); conditions.push(`r.refinancing_date >= $${params.length}::date`); }
    if (query.dateTo) { params.push(query.dateTo); conditions.push(`r.refinancing_date <= $${params.length}::date`); }
    const from = `FROM loan_refinancings r
      JOIN loans origin ON origin.id = r.origin_loan_id
      JOIN loans successor ON successor.id = r.new_loan_id
      JOIN customers c ON c.id = successor.customer_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`;
    const pageParams = [...params, query.pageSize, (query.page - 1) * query.pageSize];
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const [count]: Array<{ total: number }> = await manager.query(`SELECT COUNT(*)::int AS total ${from}`, params);
      const items: RefinancingListItem[] = await manager.query(`SELECT r.id AS "refinancingId",
        r.refinancing_date::text AS "refinancingDate",
        json_build_object('id',c.id,'fullName',concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name),
          'identification',c.identification) AS customer,
        json_build_object('id',origin.id,'loanNumber',origin.loan_number::text) AS "originLoan",
        json_build_object('id',successor.id,'loanNumber',successor.loan_number::text) AS "newLoan",
        r.outstanding_principal_transferred::text AS "outstandingPrincipalTransferred",
        r.capitalized_outstanding_interest::text AS "capitalizedOutstandingInterest",
        r.new_money_disbursed::text AS "newMoneyDisbursed",
        r.new_contractual_principal::text AS "newContractualPrincipal",
        r.new_interest_amount::text AS "newInterestAmount",
        r.new_contractual_total::text AS "newContractualTotal"
        ${from} ORDER BY r.refinancing_date DESC, r.id DESC
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`, pageParams);
      return { items, total: count.total };
    });
  }

  search(query: RefinancingSearchQuery): Promise<{ items: RefinancingCandidate[]; total: number }> {
    const params: unknown[] = [];
    const conditions = ["l.status = 'ACTIVE'"];
    if (query.search) {
      params.push(`%${query.search}%`);
      conditions.push(`(l.loan_number::text ILIKE $1 OR c.identification ILIKE $1 OR
        concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) ILIKE $1)`);
    }
    const where = `FROM loans l JOIN customers c ON c.id = l.customer_id WHERE ${conditions.join(' AND ')}`;
    const pageParams = [...params, query.pageSize, (query.page - 1) * query.pageSize];
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const [count]: Array<{ total: number }> = await manager.query(`SELECT COUNT(*)::int AS total ${where}`, params);
      const items: RefinancingCandidate[] = await manager.query(`WITH page AS (
        SELECT l.id, l.loan_number, l.customer_id, c.identification,
          concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) AS customer_name,
          l.status, l.start_date, l.principal, l.interest_amount, l.total_amount
        ${where} ORDER BY l.loan_number DESC, l.id ASC
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
      ), paid AS (
        SELECT p.loan_id, SUM(p.amount) AS total FROM payments p
        WHERE p.status = 'VALID' AND p.loan_id IN (SELECT id FROM page) GROUP BY p.loan_id
      ) SELECT page.id AS "loanId", page.loan_number::text AS "loanNumber",
        json_build_object('id',page.customer_id,'fullName',page.customer_name,'identification',page.identification) AS customer,
        page.status, page.start_date::text AS "startDate", page.principal::text AS principal,
        page.interest_amount::text AS "interestAmount", page.total_amount::text AS "totalAmount",
        COALESCE(paid.total,0)::numeric(18,2)::text AS "paidAmount",
        (page.total_amount - COALESCE(paid.total,0))::numeric(18,2)::text AS "financialBalance"
      FROM page LEFT JOIN paid ON paid.loan_id = page.id ORDER BY page.loan_number DESC, page.id ASC`, pageParams);
      return { items, total: count.total };
    });
  }

  private async snapshot(manager: EntityManager, id: string): Promise<RefinancingSnapshot | undefined> {
    const [loan] = await manager.query(`SELECT l.id, l.loan_number::text AS "loanNumber", l.customer_id AS "customerId",
      concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS "customerName", c.identification,
      l.status, l.start_date::text AS "startDate", l.principal::text AS principal, l.interest_amount::text AS "interestAmount",
      l.total_amount::text AS "totalAmount", (SELECT MAX(payment_date)::text FROM payments WHERE loan_id = l.id AND status = 'VALID') AS "lastValidPaymentDate"
      FROM loans l JOIN customers c ON c.id = l.customer_id WHERE l.id = $1`, [id]);
    if (!loan) return undefined;
    const plan = await manager.query(`SELECT id, sequence, due_date::text AS "dueDate", pending_amount::text AS "pendingAmount"
      FROM payment_plan_entries WHERE loan_id = $1 ORDER BY due_date, sequence, id`, [id]);
    const totals = await this.totals.readValidTotals(manager, id);
    if (!totals) throw new Error('Valid payment totals are unavailable.');
    return { ...loan, totals, plan } as RefinancingSnapshot;
  }

  preview(id: string): Promise<RefinancingSnapshot | undefined> {
    return this.source.transaction('REPEATABLE READ', (manager) => this.snapshot(manager, id));
  }

  transaction<T>(work: (tx: RefinancingTransaction) => Promise<T>): Promise<T> {
    return this.source.transaction(async (manager) => work({
      findByKey: async (key) => (await manager.query(`SELECT id, idempotency_fingerprint AS fingerprint
        FROM loan_refinancings WHERE idempotency_key = $1`, [key]))[0],
      lockOrigin: async (id) => {
        const [row] = await manager.query('SELECT id FROM loans WHERE id = $1 FOR UPDATE', [id]);
        return row ? this.snapshot(manager, id) : undefined;
      },
      readSnapshot: (id) => this.snapshot(manager, id),
      openingDate: async () => (await manager.query(`SELECT opening_date::text AS "openingDate"
        FROM financial_openings WHERE singleton_key = 'DEFAULT' FOR SHARE`))[0]?.openingDate,
      activeReferences: async (frequencyId, methods) => {
        const frequency = await manager.query('SELECT id FROM payment_frequencies WHERE id = $1 AND is_active = true FOR SHARE', [frequencyId]);
        const unique = [...new Set(methods)];
        const active = await manager.query('SELECT id FROM payment_methods WHERE id = ANY($1::uuid[]) AND is_active = true FOR SHARE', [unique]);
        return frequency.length === 1 && active.length === unique.length;
      },
      insertLoan: async (input) => {
        const [row] = await manager.query(`INSERT INTO loans (customer_id, start_date, payment_frequency_id,
          preferred_payment_method_id, observations, principal, interest_amount, total_amount, status, created_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6::numeric(18,2),$7::numeric(18,2),$8::numeric(18,2),'ACTIVE',$9)
          RETURNING id, loan_number::text AS "loanNumber", created_at AS "createdAt"`,
        [input.customerId, input.refinancingDate, input.paymentFrequencyId, input.preferredPaymentMethodId,
          input.observations, input.principal, input.interestAmount, input.totalAmount, input.actorId]);
        return row as { id: string; loanNumber: string; createdAt: Date };
      },
      insertPlan: async (loanId, plan) => {
        for (const row of plan) await manager.query(`INSERT INTO payment_plan_entries (loan_id, sequence, due_date, pending_amount)
          VALUES ($1,$2,$3,$4::numeric(18,2))`, [loanId, row.sequence, row.dueDate, row.pendingAmount]);
      },
      insertRefinancing: async (input: NewRefinancing) => {
        const [row] = await manager.query(`INSERT INTO loan_refinancings (origin_loan_id, new_loan_id,
          outstanding_principal_transferred, capitalized_outstanding_interest, new_money_disbursed,
          new_interest_amount, new_contractual_principal, new_contractual_total, refinancing_date,
          created_by_user_id, idempotency_key, idempotency_fingerprint)
          VALUES ($1,$2,$3::numeric(18,2),$4::numeric(18,2),$5::numeric(18,2),$6::numeric(18,2),
            $7::numeric(18,2),$8::numeric(18,2),$9,$10,$11,$12)
          ON CONFLICT DO NOTHING RETURNING id`, [input.originLoanId, input.newLoanId, input.outstandingPrincipalTransferred,
          input.capitalizedOutstandingInterest, input.newMoneyDisbursed, input.newInterestAmount,
          input.newContractualPrincipal, input.newContractualTotal, input.refinancingDate, input.createdByUserId,
          input.idempotencyKey, input.idempotencyFingerprint]);
        return row?.id;
      },
      transitionOrigin: async (id) => {
        const raw: unknown = await manager.query(`UPDATE loans SET status = 'REFINANCED', updated_at = now()
          WHERE id = $1 AND status = 'ACTIVE' RETURNING id`, [id]);
        return Array.isArray(raw) && Array.isArray(raw[0]) && raw[0].length === 1 && raw[0][0]?.id === id && raw[1] === 1;
      },
      createStatusHistory: async (originId, newLoan, actorId, refinancingId) => {
        const sequence = await getNextLoanStatusEventSequence(manager, originId);
        if (sequence < 2) throw new Error('Origin loan status history is unavailable.');
        await manager.query(`INSERT INTO loan_status_history
          (loan_id, event_sequence, event_kind, from_status, to_status, changed_at, changed_by_user_id, reason)
          VALUES ($1,$2,'TRANSITION','ACTIVE','REFINANCED',clock_timestamp(),$3,$4)`,
        [originId, sequence, actorId, `Refinancing ${refinancingId}`]);
        await manager.query(`INSERT INTO loan_status_history
          (loan_id, event_sequence, event_kind, from_status, to_status, changed_at, changed_by_user_id)
          VALUES ($1,1,'CREATED',NULL,'ACTIVE',$2,$3)`, [newLoan.id, newLoan.createdAt, actorId]);
      },
      disburseNewMoney: async (input) => {
        const [disbursement] = await manager.query(`INSERT INTO loan_disbursements
          (loan_id, amount, payment_method_id, disbursement_date, created_by_user_id)
          VALUES ($1,$2::numeric(18,2),$3,$4,$5) RETURNING id`,
        [input.newLoanId, input.amount, input.methodId, input.date, input.actorId]);
        await this.cash.recordWithManager(manager, { direction: 'OUTFLOW', concept: 'REFINANCING_NEW_MONEY_DISBURSEMENT',
          amount: input.amount, movementDate: input.date, paymentMethodId: input.methodId,
          observations: `Refinancing ${input.refinancingId}`, loanDisbursementId: disbursement.id,
          createdByUserId: input.actorId, idempotencyKey: `refinancing-disbursement:${input.refinancingId}`,
          idempotencyFingerprint: createHash('sha256').update(`${input.refinancingId}:${input.amount}`).digest('hex') });
      },
      readOperation: async (id) => (await manager.query(operationSql, [id]))[0] as RefinancingOperation | undefined,
    }));
  }

  detail(id: string): Promise<RefinancingOperation | undefined> {
    return this.source.transaction('REPEATABLE READ', async (manager) =>
      (await manager.query(operationSql, [id]))[0] as RefinancingOperation | undefined);
  }

  private async chainGraph(manager: EntityManager, customer: RefinancingChainCustomer): Promise<RefinancingChainGraph> {
    const transitions: RefinancingChainTransitionRow[] = await manager.query(`SELECT
      r.id AS "refinancingId", r.refinancing_date::text AS "refinancingDate",
      r.origin_loan_id AS "originLoanId", r.new_loan_id AS "newLoanId",
      origin.customer_id AS "originCustomerId", successor.customer_id AS "newCustomerId",
      r.outstanding_principal_transferred::text AS "outstandingPrincipalTransferred",
      r.capitalized_outstanding_interest::text AS "capitalizedOutstandingInterest",
      r.new_money_disbursed::text AS "newMoneyDisbursed",
      r.new_contractual_principal::text AS "newContractualPrincipal",
      r.new_interest_amount::text AS "newInterestAmount",
      r.new_contractual_total::text AS "newContractualTotal"
      FROM loan_refinancings r JOIN loans origin ON origin.id = r.origin_loan_id
      JOIN loans successor ON successor.id = r.new_loan_id
      WHERE origin.customer_id = $1 OR successor.customer_id = $1
      LIMIT $2`, [customer.id, MAX_REFINANCING_GRAPH_EDGES + 1]);
    if (!transitions.length || transitions.length > MAX_REFINANCING_GRAPH_EDGES) return { customer, transitions, loans: [] };
    const ids = [...new Set(transitions.flatMap((row) => [row.originLoanId, row.newLoanId]))];
    const loans: RefinancingChainLoanRow[] = await manager.query(`SELECT l.id AS "loanId", l.loan_number::text AS "loanNumber",
      l.customer_id AS "customerId", l.status, l.start_date::text AS "startDate",
      l.principal::text AS principal, l.interest_amount::text AS "interestAmount", l.total_amount::text AS "totalAmount",
      COALESCE(paid."paidAmount", '0') AS "paidAmount", COALESCE(paid."paidPrincipal", '0') AS "paidPrincipal",
      COALESCE(paid."paidInterest", '0') AS "paidInterest", COALESCE(paid."invalidCount", 0)::int AS "invalidCount",
      COALESCE(plan."pendingPlanAmount", '0') AS "pendingPlanAmount", d.amount::text AS "rootDisbursedAmount"
      FROM loans l LEFT JOIN loan_disbursements d ON d.loan_id = l.id
      LEFT JOIN (SELECT loan_id, ${VALID_PAYMENT_TOTALS_SELECT} FROM payments
        WHERE status = 'VALID' AND loan_id = ANY($1::uuid[]) GROUP BY loan_id) paid ON paid.loan_id = l.id
      LEFT JOIN (SELECT loan_id, COALESCE(SUM(pending_amount), 0)::text AS "pendingPlanAmount"
        FROM payment_plan_entries WHERE loan_id = ANY($1::uuid[]) GROUP BY loan_id) plan ON plan.loan_id = l.id
      WHERE l.id = ANY($1::uuid[])`, [ids]);
    return { customer, transitions, loans };
  }

  chainGraphForLoan(loanId: string): Promise<RefinancingChainGraph | undefined> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const [customer]: RefinancingChainCustomer[] = await manager.query(`SELECT c.id,
        concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) AS "fullName", c.identification
        FROM loans l JOIN customers c ON c.id = l.customer_id WHERE l.id = $1`, [loanId]);
      return customer ? this.chainGraph(manager, customer) : undefined;
    });
  }

  chainsForCustomer(customerId: string): Promise<RefinancingChainGraph | undefined> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const [customer]: RefinancingChainCustomer[] = await manager.query(`SELECT c.id,
        concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) AS "fullName", c.identification
        FROM customers c WHERE c.id = $1`, [customerId]);
      return customer ? this.chainGraph(manager, customer) : undefined;
    });
  }
}
