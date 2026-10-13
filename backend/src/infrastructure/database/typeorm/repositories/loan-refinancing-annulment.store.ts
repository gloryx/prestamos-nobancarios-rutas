import type { DataSource, EntityManager } from 'typeorm';
import { getNextLoanStatusEventSequence } from '../../../../application/loan/loan-status-history-sequence';
import type {
  CreateRefinancingAnnulment,
  RefinancingAnnulmentDetail,
  RefinancingAnnulmentListQuery,
  RefinancingAnnulmentPayment,
  RefinancingAnnulmentPaymentMethod,
  RefinancingAnnulmentSnapshot,
  RefinancingAnnulmentStore,
  RefinancingAnnulmentTransaction,
} from '../../../../application/loan-refinancing/refinancing-annulment.port';

const detailSql = `SELECT a.id AS "annulmentId", a.refinancing_id AS "refinancingId",
  r.refinancing_date::text AS "refinancingDate",
  a.annulment_type AS "annulmentType", a.effective_date::text AS "effectiveDate", a.reason,
  a.annulled_at AS "annulledAt", a.created_by_user_id AS "createdByUserId",
  json_build_object('id',actor.id,'fullName',actor.full_name) AS "createdBy",
  a.refund_payment_method_id AS "refundPaymentMethodId", reversal.id AS "cashMovementId",
  CASE WHEN refund_method.id IS NULL THEN NULL ELSE json_build_object('id',refund_method.id,'name',refund_method.name) END
    AS "refundPaymentMethod",
  json_build_object('id',c.id,'fullName',concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name),
    'identification',c.identification) AS customer,
  json_build_object('id',origin.id,'loanNumber',origin.loan_number::text,'status',origin.status) AS "originLoan",
  json_build_object('id',successor.id,'loanNumber',successor.loan_number::text,'status',successor.status) AS "successorLoan"
  FROM loan_refinancing_annulments a JOIN loan_refinancings r ON r.id = a.refinancing_id
  JOIN loans origin ON origin.id = r.origin_loan_id JOIN loans successor ON successor.id = r.new_loan_id
  JOIN customers c ON c.id = successor.customer_id JOIN users actor ON actor.id = a.created_by_user_id
  LEFT JOIN payment_methods refund_method ON refund_method.id = a.refund_payment_method_id
  LEFT JOIN cash_movements reversal ON reversal.refinancing_annulment_id = a.id`;

function exactlyOneUpdated(raw: unknown, id: string): boolean {
  return Array.isArray(raw) && Array.isArray(raw[0]) && raw[0].length === 1 && raw[0][0]?.id === id && raw[1] === 1;
}

export class LoanRefinancingAnnulmentTypeormStore implements RefinancingAnnulmentStore {
  constructor(private readonly source: DataSource) {}

  private async snapshot(manager: EntityManager, id: string, lock = false): Promise<RefinancingAnnulmentSnapshot | undefined> {
    const [row] = await manager.query(`SELECT r.id AS "refinancingId", r.status,
      r.refinancing_date::text AS "refinancingDate", r.origin_loan_id AS "originLoanId",
      origin.loan_number::text AS "originLoanNumber", origin.status AS "originStatus",
      r.new_loan_id AS "successorLoanId", successor.loan_number::text AS "successorLoanNumber",
      successor.status AS "successorStatus", r.outstanding_principal_transferred::text AS "outstandingPrincipalTransferred",
      r.capitalized_outstanding_interest::text AS "capitalizedOutstandingInterest",
      r.new_money_disbursed::text AS "newMoneyDisbursed", r.new_contractual_total::text AS "newContractualTotal",
      json_build_object('id',c.id,'fullName',concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name),
        'identification',c.identification) AS customer
      FROM loan_refinancings r JOIN loans origin ON origin.id = r.origin_loan_id
      JOIN loans successor ON successor.id = r.new_loan_id JOIN customers c ON c.id = successor.customer_id
      WHERE r.id = $1 ${lock ? 'FOR UPDATE OF r' : ''}`, [id]);
    if (!row) return undefined;
    if (lock) await manager.query(`SELECT id FROM loans WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [[row.originLoanId, row.successorLoanId]]);
    const [plans] = await manager.query(`SELECT
      COALESCE(SUM(pending_amount) FILTER (WHERE loan_id = $1),0)::numeric(18,2)::text AS "originPendingPlanAmount",
      COALESCE(SUM(pending_amount) FILTER (WHERE loan_id = $2),0)::numeric(18,2)::text AS "successorPendingPlanAmount"
      FROM payment_plan_entries WHERE loan_id = ANY($3::uuid[])`,
    [row.originLoanId, row.successorLoanId, [row.originLoanId, row.successorLoanId]]);
    const [child] = await manager.query(`SELECT COUNT(*)::int AS count FROM loan_refinancings
      WHERE origin_loan_id = $1 AND status = 'CONFIRMED'`, [row.successorLoanId]);
    const disbursements = await manager.query(`SELECT d.id, d.amount::text, d.disbursement_date::text AS date,
      d.payment_method_id AS "methodId", cash.id AS "cashMovementId", cash.amount::text AS "cashAmount",
      cash.movement_date::text AS "cashDate", cash.payment_method_id AS "cashMethodId",
      cash.direction AS "cashDirection", cash.concept AS "cashConcept"
      FROM loan_disbursements d LEFT JOIN cash_movements cash ON cash.loan_disbursement_id = d.id
        AND cash.concept = 'REFINANCING_NEW_MONEY_DISBURSEMENT'
      WHERE d.loan_id = $1 ORDER BY d.id`, [row.successorLoanId]);
    const payments: RefinancingAnnulmentPayment[] = await manager.query(`SELECT p.id, p.status, p.amount::text,
      p.principal_applied::text AS "principalApplied", p.interest_applied::text AS "interestApplied",
      p.payment_date::text AS "paymentDate", applications.count AS "applicationCount",
      applications.amount::text AS "applicationAmount", applications.valid AS "applicationsValid",
      annulments.count AS "annulmentCount", annulments.type AS "annulmentType",
      original.count AS "originalCashCount", original.amount::text AS "originalCashAmount",
      original.method_id AS "originalCashMethodId", original.direction AS "originalCashDirection",
      original.concept AS "originalCashConcept", reversal.count AS "reversalCount",
      reversal.amount::text AS "reversalAmount", reversal.method_id AS "reversalMethodId",
      reversal.direction AS "reversalDirection", reversal.concept AS "reversalConcept",
      reversal.effective_date AS "reversalEffectiveDate"
      FROM payments p
      LEFT JOIN LATERAL (SELECT COUNT(*)::int AS count, COALESCE(SUM(pa.amount_applied),0) AS amount,
        COALESCE(bool_and(pa.amount_applied >= 0 AND pa.pending_before >= 0 AND pa.pending_after >= 0
          AND pa.carried_forward_amount >= 0 AND entry.loan_id = p.loan_id),false) AS valid
        FROM payment_applications pa JOIN payment_plan_entries entry ON entry.id = pa.payment_plan_entry_id
        WHERE pa.payment_id = p.id) applications ON true
      LEFT JOIN LATERAL (SELECT COUNT(*)::int AS count, MIN(a.annulment_type) AS type
        FROM payment_annulments a WHERE a.payment_id = p.id) annulments ON true
      LEFT JOIN LATERAL (SELECT COUNT(*)::int AS count, MIN(c.id::text)::uuid AS id, MIN(c.amount) AS amount,
        MIN(c.payment_method_id::text)::uuid AS method_id, MIN(c.direction) AS direction, MIN(c.concept) AS concept
        FROM cash_movements c WHERE c.payment_id = p.id AND c.direction = 'INFLOW' AND c.concept = 'CUSTOMER_PAYMENT') original ON true
      LEFT JOIN LATERAL (SELECT COUNT(*)::int AS count, MIN(c.amount) AS amount,
        MIN(c.payment_method_id::text)::uuid AS method_id, MIN(c.direction) AS direction, MIN(c.concept) AS concept,
        MIN(c.movement_date)::text AS effective_date FROM cash_movements c WHERE c.reversed_movement_id = original.id) reversal ON true
      WHERE p.loan_id = $1 ORDER BY p.payment_date, p.created_at, p.id`, [row.successorLoanId]);
    return { ...row, ...plans, activeChildRefinancingCount: child.count, disbursements, payments } as RefinancingAnnulmentSnapshot;
  }

  private async detailWith(manager: EntityManager, id: string): Promise<RefinancingAnnulmentDetail | undefined> {
    return (await manager.query(`${detailSql} WHERE a.id = $1`, [id]))[0] as RefinancingAnnulmentDetail | undefined;
  }

  private async create(manager: EntityManager, state: RefinancingAnnulmentSnapshot,
    input: CreateRefinancingAnnulment): Promise<RefinancingAnnulmentDetail | undefined> {
    const [annulment] = await manager.query(`INSERT INTO loan_refinancing_annulments
      (refinancing_id,annulment_type,effective_date,reason,created_by_user_id,refund_payment_method_id,
        idempotency_key,idempotency_fingerprint)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
    [input.refinancingId, input.annulmentType, input.effectiveDate, input.reason, input.actorId,
      input.refundPaymentMethodId, input.idempotencyKey, input.idempotencyFingerprint]);
    if (!annulment) return undefined;
    if (state.newMoneyDisbursed !== '0.00') {
      const original = state.disbursements[0];
      const methodId = input.annulmentType === 'CASH_REFUND'
        ? input.refundPaymentMethodId : original.cashMethodId;
      const reversal = await manager.query(`INSERT INTO cash_movements
        (direction,concept,amount,movement_date,payment_method_id,observations,reversed_movement_id,
          created_by_user_id,idempotency_key,idempotency_fingerprint,refinancing_annulment_id)
        VALUES ('INFLOW','REVERSAL',$1::numeric(18,2),$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT DO NOTHING RETURNING id`, [state.newMoneyDisbursed, input.effectiveDate, methodId,
        input.reason, original.cashMovementId, input.actorId, `refinancing-annulment:${annulment.id}`,
        input.idempotencyFingerprint, annulment.id]);
      if (reversal.length !== 1) throw new Error('Refinancing new-money reversal could not be recorded.');
    }
    const originUpdate = await manager.query(`UPDATE loans SET status = 'ACTIVE', updated_at = now()
      WHERE id = $1 AND status = 'REFINANCED' RETURNING id`, [state.originLoanId]);
    const successorUpdate = await manager.query(`UPDATE loans SET status = 'ANNULLED', updated_at = now()
      WHERE id = $1 AND status = 'ACTIVE' RETURNING id`, [state.successorLoanId]);
    if (!exactlyOneUpdated(originUpdate, state.originLoanId) || !exactlyOneUpdated(successorUpdate, state.successorLoanId))
      throw new Error('Refinancing loan statuses changed concurrently.');
    for (const event of [
      { loanId: state.originLoanId, from: 'REFINANCED', to: 'ACTIVE', role: 'ORIGIN', resolution: null },
      { loanId: state.successorLoanId, from: 'ACTIVE', to: 'ANNULLED', role: 'SUCCESSOR',
        resolution: input.disbursementResolution },
    ]) {
      const sequence = await getNextLoanStatusEventSequence(manager, event.loanId);
      const minimumSequence = event.role === 'ORIGIN' ? 3 : 2;
      if (sequence < minimumSequence) throw new Error('Refinancing loan status history is incomplete.');
      await manager.query(`INSERT INTO loan_status_history
        (loan_id,event_sequence,event_kind,from_status,to_status,changed_at,changed_by_user_id,reason,disbursement_resolution,
          refinancing_id,refinancing_annulment_id,refinancing_role)
        VALUES ($1,$2,'TRANSITION',$3,$4,clock_timestamp(),$5,$6,$7,$8,$9,$10)`,
      [event.loanId, sequence, event.from, event.to, input.actorId, input.reason, event.resolution, input.refinancingId,
        annulment.id, event.role]);
    }
    const refinancingUpdate = await manager.query(`UPDATE loan_refinancings SET status = 'ANNULLED'
      WHERE id = $1 AND status = 'CONFIRMED' RETURNING id`, [input.refinancingId]);
    if (!exactlyOneUpdated(refinancingUpdate, input.refinancingId)) throw new Error('Refinancing status changed concurrently.');
    return this.detailWith(manager, annulment.id);
  }

  transaction<T>(work: (tx: RefinancingAnnulmentTransaction) => Promise<T>): Promise<T> {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      let locked: RefinancingAnnulmentSnapshot | undefined;
      let lockedPaymentMethodId: string | undefined;
      const tx: RefinancingAnnulmentTransaction = {
        context: manager,
        lockSnapshot: async (id) => { locked = await this.snapshot(manager, id, true); return locked; },
        hasPendingPrecollection: async (loanIds) => Boolean((await manager.query(`SELECT EXISTS (
          SELECT 1 FROM collector_precollections WHERE loan_id = ANY($1::uuid[])
            AND status IN ('RECORDED','SUBMITTED')) AS present`, [loanIds]))[0]?.present),
        lockActivePaymentMethod: async (id) => {
          const active = (await manager.query(`SELECT id FROM payment_methods
            WHERE id = $1 AND is_active = true FOR UPDATE`, [id]))[0]?.id === id;
          if (active) lockedPaymentMethodId = id;
          return active;
        },
        findByKey: async (key) => (await manager.query(`SELECT id AS "annulmentId", refinancing_id AS "refinancingId",
          idempotency_fingerprint AS fingerprint FROM loan_refinancing_annulments WHERE idempotency_key = $1 FOR SHARE`, [key]))[0],
        create: async (input) => {
          if (!locked || locked.refinancingId !== input.refinancingId) throw new Error('Refinancing must be locked before annulment.');
          if (input.refundPaymentMethodId && input.refundPaymentMethodId !== lockedPaymentMethodId)
            throw new Error('The active refund payment method must be locked before annulment.');
          return this.create(manager, locked, input);
        },
        detail: (id) => this.detailWith(manager, id),
      };
      return work(tx);
    });
  }

  private filters(query: RefinancingAnnulmentListQuery, dateColumn: string) {
    const params: unknown[] = []; const conditions: string[] = [];
    if (query.search) { params.push(`%${query.search}%`); const p = `$${params.length}`;
      conditions.push(`(origin.loan_number::text ILIKE ${p} OR successor.loan_number::text ILIKE ${p}
        OR c.identification ILIKE ${p} OR concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) ILIKE ${p})`); }
    if (query.dateFrom) { params.push(query.dateFrom); conditions.push(`${dateColumn} >= $${params.length}::date`); }
    if (query.dateTo) { params.push(query.dateTo); conditions.push(`${dateColumn} <= $${params.length}::date`); }
    return { params, conditions };
  }

  listAnnulled(query: RefinancingAnnulmentListQuery): Promise<{ items: RefinancingAnnulmentDetail[]; total: number }> {
    const { params, conditions } = this.filters(query, 'a.effective_date');
    const joins = `FROM loan_refinancing_annulments a JOIN loan_refinancings r ON r.id = a.refinancing_id
      JOIN loans origin ON origin.id = r.origin_loan_id JOIN loans successor ON successor.id = r.new_loan_id
      JOIN customers c ON c.id = successor.customer_id JOIN users actor ON actor.id = a.created_by_user_id
      LEFT JOIN payment_methods refund_method ON refund_method.id = a.refund_payment_method_id
      LEFT JOIN cash_movements reversal ON reversal.refinancing_annulment_id = a.id`;
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const [count] = await manager.query(`SELECT COUNT(*)::int AS total ${joins} ${where}`, params);
      const pageParams = [...params, query.pageSize, (query.page - 1) * query.pageSize];
      const select = detailSql.slice(0, detailSql.indexOf('FROM loan_refinancing_annulments'));
      const sortColumns: Record<string, string> = { refinancingDate: 'r.refinancing_date', effectiveDate: 'a.effective_date',
        customer: "lower(concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name))",
        originLoan: 'origin.loan_number', successorLoan: 'successor.loan_number', annulmentType: 'a.annulment_type',
        createdBy: 'lower(actor.full_name)' };
      const order = sortColumns[query.sortBy ?? 'effectiveDate'];
      const direction = query.sortDir === 'asc' ? 'ASC' : 'DESC';
      const items = await manager.query(`${select}${joins} ${where} ORDER BY ${order} ${direction},a.id DESC
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`, pageParams);
      return { items, total: count.total };
    });
  }

  listCandidates(query: RefinancingAnnulmentListQuery): Promise<{ items: RefinancingAnnulmentSnapshot[]; total: number }> {
    const { params, conditions } = this.filters(query, 'r.refinancing_date');
    conditions.unshift(`r.status = 'CONFIRMED'`);
    conditions.push(`NOT EXISTS (SELECT 1 FROM payments valid_payment
      WHERE valid_payment.loan_id = successor.id AND valid_payment.status = 'VALID')`);
    const from = `FROM loan_refinancings r JOIN loans origin ON origin.id = r.origin_loan_id
      JOIN loans successor ON successor.id = r.new_loan_id JOIN customers c ON c.id = successor.customer_id
      WHERE ${conditions.join(' AND ')}`;
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const [count] = await manager.query(`SELECT COUNT(*)::int AS total ${from}`, params);
      const pageParams = [...params, query.pageSize, (query.page - 1) * query.pageSize];
      const sortColumns: Record<string, string> = { refinancingDate: 'r.refinancing_date',
        customer: "lower(concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name))",
        originLoan: 'origin.loan_number', successorLoan: 'successor.loan_number', newMoneyDisbursed: 'r.new_money_disbursed' };
      const order = sortColumns[query.sortBy ?? 'refinancingDate'];
      const direction = query.sortDir === 'asc' ? 'ASC' : 'DESC';
      const ids: Array<{ id: string }> = await manager.query(`SELECT r.id ${from}
        ORDER BY ${order} ${direction},r.id DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`, pageParams);
      const items: RefinancingAnnulmentSnapshot[] = [];
      for (const row of ids) { const candidate = await this.snapshot(manager, row.id); if (candidate) items.push(candidate); }
      return { items, total: count.total };
    });
  }

  async listActivePaymentMethods(): Promise<RefinancingAnnulmentPaymentMethod[]> {
    return this.source.query(`SELECT id,name FROM payment_methods WHERE is_active = true ORDER BY display_order,id`);
  }

  detail(id: string): Promise<RefinancingAnnulmentDetail | undefined> {
    return this.source.transaction('REPEATABLE READ', (manager) => this.detailWith(manager, id));
  }
}
