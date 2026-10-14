import type { DataSource, EntityManager } from 'typeorm';
import type {
  CollectorPrecollectionListQuery,
  CollectorPrecollectionPage,
  CollectorPrecollectionStore,
} from '../../../../application/collector-precollection/collector-precollection.ports';
import type { NormalizedCollectorPrecollectionInput } from '../../../../domain/collector-precollection/collector-precollection.rules';
import type { CollectorPrecollectionDetail } from '../../../../domain/collector-precollection/collector-precollection.types';
import { calculateCustomerVisibleBalance } from '../../../../domain/collector-precollection/customer-visible-balance';
import {
  CollectorPrecollectionConflictError,
  CollectorPrecollectionForbiddenError,
  CollectorPrecollectionNotFoundError,
  CollectorPrecollectionValidationError,
} from '../../../../domain/collector-precollection/collector-precollection.errors';

type ExistingCreate = { id: string; fingerprint: string; collectorUserId: string };
type CancellationIdentity = { id: string; fingerprint: string; cancellationKey: string | null };

const cents = (value: string): bigint => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};

const DETAIL_SQL = `SELECT cp.id, cp.receipt_number AS "receiptNumber",
  cp.collector_id AS "collectorId", cp.collector_user_id AS "collectorUserId",
  cp.customer_id AS "customerId", cp.loan_id AS "loanId", cp.route_id AS "routeId",
  cp.customer_route_assignment_id AS "customerRouteAssignmentId",
  cp.collector_route_assignment_id AS "collectorRouteAssignmentId",
  cp.payment_method_id AS "paymentMethodId", cp.custody_treatment AS "custodyTreatment", cp.amount::text AS amount,
  cp.customer_balance_before::text AS "customerBalanceBefore",
  cp.customer_balance_after::text AS "customerBalanceAfter",
  cp.effective_date::text AS "effectiveDate", cp.reference, cp.notes, cp.status,
  cp.recorded_by_user_id AS "recordedByUserId", cp.recorded_at AS "recordedAt",
  cp.cancelled_by_user_id AS "cancelledByUserId", cp.cancelled_at AS "cancelledAt",
  cp.cancellation_reason AS "cancellationReason",
  concat_ws(' ', collector.first_name, collector.first_last_name, collector.second_last_name) AS "collectorName",
  concat_ws(' ', customer.first_name, customer.middle_name, customer.first_last_name, customer.second_last_name) AS "customerName",
  customer.identification AS "customerIdentification", customer.primary_phone AS "customerPhone",
  customer.secondary_phone AS "customerSecondaryPhone",
  loan.loan_number::text AS "loanNumber",
  route.name AS "routeName", method.name AS "paymentMethodName", recorder.full_name AS "recordedByName",
  canceller.full_name AS "cancelledByName",
  balances.financial_balance::text AS "financialBalance",
  balances.reserved_precollections::text AS "reservedPrecollections",
  (balances.financial_balance - balances.reserved_precollections)::numeric(18,2)::text AS "operationalBalance"
  FROM collector_precollections cp
  JOIN collectors collector ON collector.id = cp.collector_id
  JOIN customers customer ON customer.id = cp.customer_id
  JOIN loans loan ON loan.id = cp.loan_id
  JOIN routes route ON route.id = cp.route_id
  JOIN payment_methods method ON method.id = cp.payment_method_id
  JOIN users recorder ON recorder.id = cp.recorded_by_user_id
  LEFT JOIN users canceller ON canceller.id = cp.cancelled_by_user_id
  JOIN LATERAL (SELECT
    (loan.total_amount - COALESCE((SELECT SUM(payment.amount) FROM payments payment
      WHERE payment.loan_id = loan.id AND payment.status = 'VALID'), 0))::numeric(18,2) AS financial_balance,
    COALESCE((SELECT SUM(pending.amount) FROM collector_precollections pending
      WHERE pending.loan_id = loan.id AND pending.status IN ('RECORDED','SUBMITTED')), 0)::numeric(18,2) AS reserved_precollections
  ) balances ON TRUE`;

export class CollectorPrecollectionTypeOrmStore implements CollectorPrecollectionStore {
  constructor(private readonly source: DataSource) {}

  private async detailWith(executor: Pick<EntityManager, 'query'>, id: string, actorUserId?: string) {
    const params: unknown[] = [id];
    const scope = actorUserId ? ` AND cp.collector_user_id = $${params.push(actorUserId)}` : '';
    const [row] = await executor.query(`${DETAIL_SQL} WHERE cp.id = $1${scope}`, params);
    return row as CollectorPrecollectionDetail | undefined;
  }

  private async replayCreate(manager: EntityManager, input: NormalizedCollectorPrecollectionInput,
    actorUserId: string, fingerprint: string): Promise<CollectorPrecollectionDetail> {
    const [existing] = await manager.query(`SELECT id, idempotency_fingerprint AS fingerprint,
      collector_user_id AS "collectorUserId" FROM collector_precollections WHERE idempotency_key = $1 FOR SHARE`,
    [input.idempotencyKey]) as ExistingCreate[];
    if (!existing) throw new CollectorPrecollectionConflictError('No se pudo reconciliar el cobro preliminar concurrente.', 'IDEMPOTENCY_RETRY_FAILED');
    if (existing.fingerprint !== fingerprint || existing.collectorUserId !== actorUserId) {
      throw new CollectorPrecollectionConflictError('La clave de idempotencia fue utilizada con datos diferentes.', 'IDEMPOTENCY_KEY_REUSED');
    }
    const detail = await this.detailWith(manager, existing.id);
    if (!detail) throw new CollectorPrecollectionConflictError('El cobro preliminar idempotente no se pudo consultar.');
    return detail;
  }

  private async insert(input: NormalizedCollectorPrecollectionInput, actorUserId: string, fingerprint: string) {
    return this.source.transaction(async (manager) => {
      const existing = await manager.query(`SELECT id, idempotency_fingerprint AS fingerprint,
        collector_user_id AS "collectorUserId" FROM collector_precollections WHERE idempotency_key = $1 FOR SHARE`,
      [input.idempotencyKey]) as ExistingCreate[];
      if (existing[0]) return this.replayCreate(manager, input, actorUserId, fingerprint);

      const [actor] = await manager.query(`SELECT collector.id AS "collectorId"
        FROM users actor
        JOIN collectors collector ON collector.user_id = actor.id AND collector.is_active = true
        WHERE actor.id = $1 AND actor.is_active = true FOR SHARE OF actor, collector`, [actorUserId]);
      if (!actor) throw new CollectorPrecollectionForbiddenError('El usuario autenticado no tiene un perfil de cobrador activo.');

      await manager.query(`SELECT pg_advisory_xact_lock_shared(hashtext('financial-closes-v2'))`);
      const [loan] = await manager.query(`SELECT id, customer_id AS "customerId", status, total_amount::text AS "totalAmount"
        FROM loans WHERE id = $1 FOR UPDATE`, [input.loanId]);
      if (!loan || loan.customerId !== input.customerId) {
        throw new CollectorPrecollectionValidationError('El préstamo no pertenece al cliente seleccionado.', 'LOAN_CUSTOMER_MISMATCH', 'loanId');
      }
      if (loan.status !== 'ACTIVE') {
        throw new CollectorPrecollectionConflictError('Solo se pueden registrar cobros para préstamos activos.', 'LOAN_NOT_ACTIVE');
      }

      const [opening] = await manager.query(`SELECT opening_date::text AS "openingDate"
        FROM financial_openings WHERE singleton_key = 'DEFAULT' FOR SHARE`);
      if (!opening) throw new CollectorPrecollectionConflictError('La apertura financiera es obligatoria.', 'FINANCIAL_OPENING_REQUIRED');
      if (input.effectiveDate < opening.openingDate) {
        throw new CollectorPrecollectionConflictError('La fecha del cobro es anterior a la apertura financiera.', 'BEFORE_FINANCIAL_OPENING');
      }
      const [closed] = await manager.query(`SELECT to_date::text AS "toDate" FROM financial_closes
        WHERE confirmed_at IS NOT NULL ORDER BY sequence DESC LIMIT 1`);
      if (closed && input.effectiveDate <= closed.toDate) {
        throw new CollectorPrecollectionConflictError('La fecha del cobro pertenece a un período financiero cerrado.', 'CLOSED_FINANCIAL_PERIOD');
      }

      const [method] = await manager.query(`SELECT id, name FROM payment_methods WHERE id = $1 AND is_active = true FOR SHARE`,
        [input.paymentMethodId]);
      if (!method) throw new CollectorPrecollectionValidationError('La forma de pago está inactiva o no existe.', 'PAYMENT_METHOD_INACTIVE', 'paymentMethodId');
      if (method.name.trim().toUpperCase() !== 'EFECTIVO' && !input.reference) {
        throw new CollectorPrecollectionValidationError('La referencia es obligatoria para formas de pago distintas de efectivo.', 'REFERENCE_REQUIRED', 'reference');
      }

      const [assignment] = await manager.query(`SELECT customer_assignment.id AS "customerRouteAssignmentId",
        collector_assignment.id AS "collectorRouteAssignmentId", customer_assignment.route_id AS "routeId"
        FROM customer_route_assignments customer_assignment
        JOIN customers customer ON customer.id = customer_assignment.customer_id AND customer.is_active = true
        JOIN routes route ON route.id = customer_assignment.route_id AND route.is_active = true
        JOIN collector_route_assignments collector_assignment ON collector_assignment.route_id = route.id
          AND collector_assignment.collector_user_id = $2 AND collector_assignment.ended_at IS NULL
        WHERE customer_assignment.customer_id = $1 AND customer_assignment.ended_at IS NULL
        FOR SHARE OF customer_assignment, route, collector_assignment`, [input.customerId, actorUserId]);
      if (!assignment) {
        throw new CollectorPrecollectionForbiddenError('El cliente y el cobrador no tienen una asignación activa en la misma ruta.');
      }

      const [balance] = await manager.query(`SELECT
        COALESCE((SELECT SUM(entry.pending_amount) FROM payment_plan_entries entry
          WHERE entry.loan_id = $1 AND entry.pending_amount > 0), 0)::numeric(18,2)::text AS "planBalance",
        ($2::numeric(18,2) - COALESCE((SELECT SUM(payment.amount) FROM payments payment
          WHERE payment.loan_id = $1 AND payment.status = 'VALID'), 0))::numeric(18,2)::text AS "financialBalance",
        COALESCE((SELECT SUM(cp.amount) FROM collector_precollections cp
          WHERE cp.loan_id = $1 AND cp.status IN ('RECORDED','SUBMITTED')), 0)::numeric(18,2)::text AS reserved,
        ($2::numeric(18,2) - COALESCE((SELECT SUM(payment.amount) FROM payments payment
          WHERE payment.loan_id = $1 AND payment.status = 'VALID' AND payment.payment_date <= $3), 0))
          ::numeric(18,2)::text AS "customerFinancialBalance",
        COALESCE((SELECT SUM(previous.amount) FROM collector_precollections previous
          WHERE previous.loan_id = $1 AND previous.effective_date <= $3
            AND previous.status NOT IN ('CANCELLED','REJECTED')
            AND NOT EXISTS (SELECT 1 FROM collector_settlement_items item
              JOIN payments linked_payment ON linked_payment.id = item.payment_id AND linked_payment.status = 'VALID'
              WHERE item.precollection_id = previous.id)), 0)::numeric(18,2)::text AS "unappliedCustomerCollections"`,
      [input.loanId, loan.totalAmount, input.effectiveDate]);
      if (cents(balance.planBalance) !== cents(balance.financialBalance) || cents(balance.financialBalance) < 0n) {
        throw new CollectorPrecollectionConflictError('El saldo operativo no concilia con el saldo financiero del préstamo.', 'OPERATIONAL_BALANCE_INVALID');
      }
      const available = cents(balance.planBalance) - cents(balance.reserved);
      if (available < 0n) throw new CollectorPrecollectionConflictError('Las reservas operativas del préstamo no concilian.', 'OPERATIONAL_BALANCE_INVALID');
      if (cents(input.amount) > available) {
        throw new CollectorPrecollectionValidationError('El monto supera el saldo operativo disponible del préstamo.', 'AMOUNT_EXCEEDS_OPERATIONAL_BALANCE', 'amount');
      }
      const customerBalance = calculateCustomerVisibleBalance(
        balance.customerFinancialBalance,
        balance.unappliedCustomerCollections,
        input.amount,
      );
      if (cents(input.amount) > cents(customerBalance.before)) {
        throw new CollectorPrecollectionValidationError('El monto supera el saldo visible del cliente.', 'AMOUNT_EXCEEDS_OPERATIONAL_BALANCE', 'amount');
      }

      const [created] = await manager.query(`INSERT INTO collector_precollections
        (collector_id, collector_user_id, customer_id, loan_id, route_id, customer_route_assignment_id,
          collector_route_assignment_id, payment_method_id, custody_treatment, amount,
          customer_balance_before, customer_balance_after, effective_date, reference, notes, status,
          recorded_by_user_id, idempotency_key, idempotency_fingerprint)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::numeric(18,2),$11::numeric(18,2),$12::numeric(18,2),
          $13,$14,$15,'RECORDED',$2,$16,$17)
        RETURNING id`, [actor.collectorId, actorUserId, input.customerId, input.loanId, assignment.routeId,
        assignment.customerRouteAssignmentId, assignment.collectorRouteAssignmentId, input.paymentMethodId,
        input.custodyTreatment, input.amount, customerBalance.before, customerBalance.after, input.effectiveDate,
        input.reference, input.notes, input.idempotencyKey, fingerprint]);
      if (input.custodyTreatment === 'COLLECTOR_HELD') {
        await manager.query(`INSERT INTO collector_custody_entries
          (collector_id, direction, entry_type, amount, effective_date, payment_method_id, reference, notes,
           precollection_id, created_by_user_id, idempotency_key, idempotency_fingerprint)
          VALUES ($1,'CREDIT','CUSTOMER_COLLECTION',$2::numeric(18,2),$3,$4,$5,$6,$7,$8,$9,$10)`,
        [actor.collectorId, input.amount, input.effectiveDate, input.paymentMethodId, input.reference, input.notes,
          created.id, actorUserId, `precollection:${created.id}:custody`, fingerprint]);
      }
      const detail = await this.detailWith(manager, created.id);
      if (!detail) throw new CollectorPrecollectionConflictError('No se pudo consultar el cobro preliminar registrado.');
      return detail;
    });
  }

  async create(input: NormalizedCollectorPrecollectionInput, actorUserId: string, fingerprint: string) {
    try { return await this.insert(input, actorUserId, fingerprint); }
    catch (error) {
      const databaseError = error as { code?: string; constraint?: string };
      if (databaseError.code !== '23505' || databaseError.constraint !== 'UQ_collector_precollections_idempotency') throw error;
      return this.source.transaction((manager) => this.replayCreate(manager, input, actorUserId, fingerprint));
    }
  }

  private filters(query: CollectorPrecollectionListQuery, actorUserId?: string) {
    const params: unknown[] = [query.fromDate, query.toDate];
    const clauses = ['cp.effective_date BETWEEN $1 AND $2'];
    if (actorUserId) { params.push(actorUserId); clauses.push(`cp.collector_user_id = $${params.length}`); }
    if (query.status) { params.push(query.status); clauses.push(`cp.status = $${params.length}`); }
    if (query.paymentMethodId) { params.push(query.paymentMethodId); clauses.push(`cp.payment_method_id = $${params.length}`); }
    if (query.collectorId) { params.push(query.collectorId); clauses.push(`cp.collector_id = $${params.length}`); }
    if (query.routeId) { params.push(query.routeId); clauses.push(`cp.route_id = $${params.length}`); }
    if (query.search) {
      params.push(`%${query.search}%`);
      clauses.push(`(customer.identification ILIKE $${params.length}
        OR concat_ws(' ', customer.first_name, customer.middle_name, customer.first_last_name, customer.second_last_name) ILIKE $${params.length}
        OR loan.loan_number::text ILIKE $${params.length} OR COALESCE(cp.reference, '') ILIKE $${params.length})`);
    }
    return { params, where: clauses.join(' AND ') };
  }

  private async assertActiveCollector(actorUserId: string) {
    const [actor] = await this.source.query(`SELECT collector.id FROM users actor
      JOIN collectors collector ON collector.user_id = actor.id AND collector.is_active = true
      WHERE actor.id = $1 AND actor.is_active = true`, [actorUserId]);
    if (!actor) throw new CollectorPrecollectionForbiddenError('El usuario autenticado no tiene un perfil de cobrador activo.');
  }

  async list(query: CollectorPrecollectionListQuery, actorUserId?: string): Promise<CollectorPrecollectionPage> {
    if (actorUserId) await this.assertActiveCollector(actorUserId);
    const { params, where } = this.filters(query, actorUserId);
    const joins = `FROM collector_precollections cp
      JOIN customers customer ON customer.id = cp.customer_id
      JOIN loans loan ON loan.id = cp.loan_id
      JOIN payment_methods method ON method.id = cp.payment_method_id`;
    const sortColumns: Record<string, string> = { effectiveDate: 'cp.effective_date', recordedAt: 'cp.recorded_at',
      amount: 'cp.amount', status: 'cp.status', customer: 'customer.first_last_name', loanNumber: 'loan.loan_number' };
    const direction = query.sortDir.toUpperCase();
    const pageParams = [...params, query.pageSize, (query.page - 1) * query.pageSize];
    const [items, aggregate] = await Promise.all([
      this.source.query(`${DETAIL_SQL} WHERE ${where}
        ORDER BY ${sortColumns[query.sortBy]} ${direction}, cp.effective_date ${direction}, cp.recorded_at ${direction}, cp.id ${direction}
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`, pageParams),
      this.source.query(`SELECT COUNT(*)::int AS count,
        COALESCE(SUM(cp.amount) FILTER (WHERE cp.status <> 'CANCELLED'), 0)::numeric(18,2)::text AS total,
        COALESCE(SUM(cp.amount) FILTER (WHERE cp.status <> 'CANCELLED' AND upper(btrim(method.name)) = 'EFECTIVO'), 0)::numeric(18,2)::text AS cash,
        COALESCE(SUM(cp.amount) FILTER (WHERE cp.status <> 'CANCELLED' AND upper(btrim(method.name)) <> 'EFECTIVO'), 0)::numeric(18,2)::text AS electronic,
        COALESCE(SUM(cp.amount) FILTER (WHERE cp.status IN ('RECORDED','SUBMITTED')), 0)::numeric(18,2)::text AS pending,
        COALESCE(SUM(cp.amount) FILTER (WHERE cp.status = 'CANCELLED'), 0)::numeric(18,2)::text AS cancelled
        ${joins} WHERE ${where}`, params),
    ]);
    const indicators = aggregate[0] ?? { count: 0, total: '0.00', cash: '0.00', electronic: '0.00', pending: '0.00', cancelled: '0.00' };
    return { items, total: indicators.count, page: query.page, pageSize: query.pageSize,
      totalPages: Math.ceil(indicators.count / query.pageSize), indicators };
  }

  detail(id: string, actorUserId?: string): Promise<CollectorPrecollectionDetail | null> {
    return this.detailWith(this.source, id, actorUserId).then((row) => row ?? null);
  }

  private async cancelOnce(id: string, reason: string, idempotencyKey: string, fingerprint: string,
    actorUserId: string, allowGlobal: boolean) {
    return this.source.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock_shared(hashtext('financial-closes-v2'))`);
      const [identity] = await manager.query(`SELECT loan_id AS "loanId" FROM collector_precollections WHERE id = $1`, [id]);
      if (!identity) throw new CollectorPrecollectionNotFoundError('El cobro preliminar no existe.');
      await manager.query(`SELECT id FROM loans WHERE id = $1 FOR UPDATE`, [identity.loanId]);
      const [row] = await manager.query(`SELECT id, status, collector_id AS "collectorId", custody_treatment AS "custodyTreatment",
        amount::text AS amount, effective_date::text AS "effectiveDate", payment_method_id AS "paymentMethodId",
        collector_user_id AS "collectorUserId",
        cancellation_idempotency_key AS "cancellationKey", cancellation_idempotency_fingerprint AS fingerprint
        FROM collector_precollections WHERE id = $1 FOR UPDATE`, [id]);
      if (!row) throw new CollectorPrecollectionNotFoundError('El cobro preliminar no existe.');
      if (!allowGlobal && row.collectorUserId !== actorUserId) {
        throw new CollectorPrecollectionForbiddenError('Solo puedes cancelar cobros preliminares propios.');
      }
      if (row.status === 'CANCELLED') {
        if (row.cancellationKey !== idempotencyKey || row.fingerprint !== fingerprint) {
          throw new CollectorPrecollectionConflictError('El cobro preliminar ya fue cancelado con datos diferentes.', 'CANCELLATION_ALREADY_RECORDED');
        }
        return (await this.detailWith(manager, id))!;
      }
      if (row.status !== 'RECORDED') {
        throw new CollectorPrecollectionConflictError('Solo se puede cancelar un cobro preliminar en estado RECORDED.', 'PRECOLLECTION_NOT_CANCELLABLE');
      }
      const [closed] = await manager.query(`SELECT to_date::text AS "toDate" FROM financial_closes
        WHERE confirmed_at IS NOT NULL ORDER BY sequence DESC LIMIT 1`);
      if (closed && row.effectiveDate <= closed.toDate) {
        throw new CollectorPrecollectionConflictError('La fecha del cobro pertenece a un período financiero cerrado.', 'CLOSED_FINANCIAL_PERIOD');
      }
      const [keyOwner] = await manager.query(`SELECT id FROM collector_precollections
        WHERE cancellation_idempotency_key = $1 FOR SHARE`, [idempotencyKey]);
      if (keyOwner) throw new CollectorPrecollectionConflictError('La clave de cancelación ya fue utilizada.', 'IDEMPOTENCY_KEY_REUSED');
      await manager.query(`UPDATE collector_precollections SET status = 'CANCELLED', cancellation_reason = $1,
        cancelled_by_user_id = $2, cancelled_at = now(), cancellation_idempotency_key = $3,
        cancellation_idempotency_fingerprint = $4, updated_at = now() WHERE id = $5`,
      [reason, actorUserId, idempotencyKey, fingerprint, id]);
      if (row.custodyTreatment === 'COLLECTOR_HELD') {
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext('collector-custody:' || $1::text))`, [row.collectorId]);
        const [balance] = await manager.query(`SELECT
          COALESCE((SELECT SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END)
            FROM collector_custody_entries WHERE collector_id = $1),0)::numeric(18,2)::text AS balance,
          COALESCE((SELECT SUM(amount) FROM collector_precollections WHERE collector_id = $1 AND id <> $2
            AND custody_treatment = 'COLLECTOR_HELD' AND status IN ('RECORDED','SUBMITTED')),0)::numeric(18,2)::text AS "reservedOther"`,
        [row.collectorId, id]);
        if (cents(row.amount) > cents(balance.balance) - cents(balance.reservedOther)) {
          throw new CollectorPrecollectionConflictError('La custodia disponible está reservada para otros cobros pendientes.', 'INSUFFICIENT_AVAILABLE_CUSTODY');
        }
        const [original] = await manager.query(`SELECT id FROM collector_custody_entries
          WHERE precollection_id = $1 AND entry_type = 'CUSTOMER_COLLECTION' FOR SHARE`, [id]);
        if (!original) throw new CollectorPrecollectionConflictError('El ingreso de custodia original no existe.', 'CUSTODY_ENTRY_MISSING');
        await manager.query(`INSERT INTO collector_custody_entries
          (collector_id, direction, entry_type, amount, effective_date, payment_method_id, reference, reason,
            precollection_id, reversed_entry_id, created_by_user_id, idempotency_key, idempotency_fingerprint)
          VALUES ($1,'DEBIT','REVERSAL',$2::numeric(18,2),$3,$4,NULL,$5,$6,$7,$8,$9,$10)`,
        [row.collectorId, row.amount, row.effectiveDate, row.paymentMethodId, reason, id, original.id,
          actorUserId, `precollection-cancel:${id}:${idempotencyKey}`, fingerprint]);
      }
      return (await this.detailWith(manager, id))!;
    });
  }

  async cancel(id: string, reason: string, idempotencyKey: string, fingerprint: string,
    actorUserId: string, allowGlobal: boolean) {
    try { return await this.cancelOnce(id, reason, idempotencyKey, fingerprint, actorUserId, allowGlobal); }
    catch (error) {
      const databaseError = error as { code?: string; constraint?: string };
      if (databaseError.code !== '23505' || databaseError.constraint !== 'UQ_collector_precollections_cancellation_key') throw error;
      const [owner] = await this.source.query(`SELECT id, cancellation_idempotency_key AS "cancellationKey",
        cancellation_idempotency_fingerprint AS fingerprint FROM collector_precollections
        WHERE cancellation_idempotency_key = $1`, [idempotencyKey]) as CancellationIdentity[];
      if (!owner || owner.id !== id || owner.fingerprint !== fingerprint) {
        throw new CollectorPrecollectionConflictError('La clave de cancelación ya fue utilizada.', 'IDEMPOTENCY_KEY_REUSED');
      }
      const detail = await this.detail(id, allowGlobal ? undefined : actorUserId);
      if (!detail) throw new CollectorPrecollectionConflictError('No se pudo reconciliar la cancelación concurrente.', 'IDEMPOTENCY_RETRY_FAILED');
      return detail;
    }
  }
}
