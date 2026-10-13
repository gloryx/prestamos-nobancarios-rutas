import type { DataSource, EntityManager } from 'typeorm';
import type { CollectorSettlementStore, ConfirmCollectorSettlementCommand,
  CreateCollectorSettlementCommand } from '../../../../application/collector-settlement/collector-settlement.ports';
import { CollectorSettlementConflictError, CollectorSettlementForbiddenError,
  CollectorSettlementNotFoundError } from '../../../../domain/collector-settlement/collector-settlement.errors';
import type { CollectorSettlementDetail } from '../../../../domain/collector-settlement/collector-settlement.types';
import { TransactionalPaymentRegistrar, TrustedSettlementPaymentContext } from '../../../../application/payment/payment.use-case';

const cents = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); };
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

export class CollectorSettlementTypeOrmStore implements CollectorSettlementStore {
  constructor(private readonly source: DataSource, private readonly registrar: TransactionalPaymentRegistrar) {}

  private async assertActor(manager: Pick<EntityManager, 'query'>, actorUserId: string) {
    const [actor] = await manager.query(`SELECT actor.id, collector.id AS "collectorId"
      FROM users actor LEFT JOIN collectors collector ON collector.user_id = actor.id AND collector.is_active = true
      WHERE actor.id = $1 AND actor.is_active = true FOR SHARE OF actor`, [actorUserId]);
    if (!actor) throw new CollectorSettlementForbiddenError('El usuario autenticado no está activo.');
    return actor as { id: string; collectorId: string | null };
  }

  private async detailWith(executor: Pick<EntityManager, 'query'>, id: string, actorUserId?: string): Promise<CollectorSettlementDetail | null> {
    const params: unknown[] = [id];
    const scope = actorUserId ? ` AND settlement.collector_user_id = $${params.push(actorUserId)}` : '';
    const [settlement] = await executor.query(`SELECT settlement.id, settlement.collector_id AS "collectorId",
      settlement.collector_user_id AS "collectorUserId", settlement.status,
      settlement.total_declared::text AS "totalDeclared", settlement.total_confirmed::text AS "totalConfirmed",
      settlement.amount_delivered::text AS "amountDelivered", settlement.retained_amount::text AS "retainedAmount",
      settlement.difference_amount::text AS "differenceAmount", settlement.delivery_date::text AS "deliveryDate",
      settlement.delivery_payment_method_id AS "deliveryPaymentMethodId", settlement.delivery_reference AS "deliveryReference",
      settlement.delivery_notes AS "deliveryNotes", settlement.reason, settlement.created_by_user_id AS "createdByUserId",
      settlement.created_at AS "createdAt", settlement.submitted_by_user_id AS "submittedByUserId",
      settlement.submitted_at AS "submittedAt", settlement.reviewed_by_user_id AS "reviewedByUserId",
      settlement.reviewed_at AS "reviewedAt", settlement.confirmed_by_user_id AS "confirmedByUserId",
      settlement.confirmed_at AS "confirmedAt", settlement.rejected_by_user_id AS "rejectedByUserId",
      settlement.rejected_at AS "rejectedAt", settlement.cancelled_by_user_id AS "cancelledByUserId",
      settlement.cancelled_at AS "cancelledAt" FROM collector_settlements settlement
      WHERE settlement.id = $1${scope}`, params);
    if (!settlement) return null;
    const items = await executor.query(`SELECT id, settlement_id AS "settlementId", precollection_id AS "precollectionId",
      declared_amount::text AS "declaredAmount", confirmed_amount::text AS "confirmedAmount", payment_id AS "paymentId"
      FROM collector_settlement_items WHERE settlement_id = $1 ORDER BY created_at, id`, [id]);
    const actions = await executor.query(`SELECT id, action, actor_user_id AS "actorUserId", reason, created_at AS "createdAt"
      FROM collector_settlement_actions WHERE settlement_id = $1 ORDER BY created_at, id`, [id]);
    return { ...settlement, items, actions } as CollectorSettlementDetail;
  }

  private async replayAction(executor: Pick<EntityManager, 'query'>, settlementId: string, action: string,
    idempotencyKey: string, fingerprint: string, actorUserId: string, allowGlobal: boolean) {
    const [recorded] = await executor.query(`SELECT action.settlement_id AS "settlementId", action.action,
      action.actor_user_id AS "actorUserId", action.idempotency_fingerprint AS fingerprint,
      settlement.collector_user_id AS "collectorUserId"
      FROM collector_settlement_actions action JOIN collector_settlements settlement ON settlement.id = action.settlement_id
      WHERE action.idempotency_key = $1 FOR SHARE OF action, settlement`, [idempotencyKey]);
    if (!recorded) return null;
    if (recorded.settlementId !== settlementId || recorded.action !== action || recorded.actorUserId !== actorUserId
      || recorded.fingerprint !== fingerprint || (!allowGlobal && recorded.collectorUserId !== actorUserId)) {
      throw new CollectorSettlementConflictError('La clave de idempotencia fue utilizada con datos diferentes.', 'IDEMPOTENCY_KEY_REUSED');
    }
    return this.detailWith(executor, settlementId);
  }

  async create(command: CreateCollectorSettlementCommand, actorUserId: string, allowGlobal: boolean, fingerprint: string) {
    return this.source.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('collector-settlement-idempotency:' || $1))`, [command.idempotencyKey]);
      const [existing] = await manager.query(`SELECT id, idempotency_fingerprint AS fingerprint,
        created_by_user_id AS "createdByUserId" FROM collector_settlements WHERE idempotency_key = $1 FOR SHARE`, [command.idempotencyKey]);
      if (existing) {
        if (existing.fingerprint !== fingerprint || existing.createdByUserId !== actorUserId) throw new CollectorSettlementConflictError('La clave de idempotencia fue utilizada con datos diferentes.', 'IDEMPOTENCY_KEY_REUSED');
        return (await this.detailWith(manager, existing.id))!;
      }
      const actor = await this.assertActor(manager, actorUserId);
      let collectorId = actor.collectorId;
      let collectorUserId = actorUserId;
      if (command.collectorId) {
        if (!allowGlobal) throw new CollectorSettlementForbiddenError('Solo puedes crear liquidaciones propias.');
        const [collector] = await manager.query(`SELECT id, user_id AS "userId" FROM collectors
          WHERE id = $1 AND is_active = true FOR SHARE`, [command.collectorId]);
        if (!collector) throw new CollectorSettlementForbiddenError('El cobrador no está activo.');
        collectorId = collector.id; collectorUserId = collector.userId;
      }
      if (!collectorId) throw new CollectorSettlementForbiddenError('El usuario no tiene un perfil de cobrador activo.');
      const rows = await manager.query(`SELECT id, collector_id AS "collectorId", collector_user_id AS "collectorUserId",
        amount::text AS amount, status FROM collector_precollections WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [command.precollectionIds]) as Array<{ id: string; collectorId: string; collectorUserId: string; amount: string; status: string }>;
      if (rows.length !== command.precollectionIds.length || rows.some((row) => row.collectorId !== collectorId
        || row.collectorUserId !== collectorUserId || row.status !== 'RECORDED')) {
        throw new CollectorSettlementConflictError('Todos los cobros deben estar RECORDED y pertenecer al mismo cobrador.', 'PRECOLLECTION_NOT_AVAILABLE');
      }
      const total = money(rows.reduce((sum, row) => sum + cents(row.amount), 0n));
      const [created] = await manager.query(`INSERT INTO collector_settlements
        (collector_id, collector_user_id, status, total_declared, created_by_user_id, idempotency_key, idempotency_fingerprint)
        VALUES ($1,$2,'DRAFT',$3::numeric(18,2),$4,$5,$6) RETURNING id`,
      [collectorId, collectorUserId, total, actorUserId, command.idempotencyKey, fingerprint]);
      for (const row of rows) await manager.query(`INSERT INTO collector_settlement_items
        (settlement_id, precollection_id, declared_amount, active_reservation) VALUES ($1,$2,$3::numeric(18,2),true)`,
      [created.id, row.id, row.amount]);
      await manager.query(`UPDATE collector_precollections SET status = 'SUBMITTED', updated_at = now()
        WHERE id = ANY($1::uuid[]) AND status = 'RECORDED'`, [command.precollectionIds]);
      return (await this.detailWith(manager, created.id))!;
    });
  }

  async list(actorUserId?: string) {
    if (actorUserId) await this.assertActor(this.source, actorUserId);
    const params: unknown[] = [];
    const scope = actorUserId ? ` WHERE collector_user_id = $${params.push(actorUserId)}` : '';
    const rows = await this.source.query(`SELECT id FROM collector_settlements${scope} ORDER BY created_at DESC, id`, params);
    return Promise.all(rows.map((row: { id: string }) => this.detailWith(this.source, row.id))).then((items) => items.filter(Boolean) as CollectorSettlementDetail[]);
  }
  detail(id: string, actorUserId?: string) { return this.detailWith(this.source, id, actorUserId); }

  async transition(id: string, action: 'submit' | 'review' | 'reject' | 'cancel', reason: string | null,
    idempotencyKey: string, fingerprint: string, actorUserId: string, allowGlobal: boolean) {
    return this.source.transaction(async (manager) => {
      await this.assertActor(manager, actorUserId);
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('collector-settlement-action:' || $1))`, [idempotencyKey]);
      const actionName = action.toUpperCase();
      const replay = await this.replayAction(manager, id, actionName, idempotencyKey, fingerprint, actorUserId, allowGlobal);
      if (replay) return replay;
      const [row] = await manager.query(`SELECT id, status, collector_user_id AS "collectorUserId",
        last_action_idempotency_key AS "actionKey", last_action_fingerprint AS "actionFingerprint"
        FROM collector_settlements WHERE id = $1 FOR UPDATE`, [id]);
      if (!row) throw new CollectorSettlementNotFoundError('La liquidación no existe.');
      if (!allowGlobal && row.collectorUserId !== actorUserId) throw new CollectorSettlementForbiddenError('Solo puedes gestionar liquidaciones propias.');
      if (row.actionKey === idempotencyKey) {
        if (row.actionFingerprint !== fingerprint) throw new CollectorSettlementConflictError('La clave de idempotencia fue utilizada con datos diferentes.', 'IDEMPOTENCY_KEY_REUSED');
        return (await this.detailWith(manager, id))!;
      }
      const allowed: Record<typeof action, string[]> = { submit: ['DRAFT'], review: ['SUBMITTED'],
        reject: ['SUBMITTED', 'UNDER_REVIEW'], cancel: allowGlobal ? ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'] : ['DRAFT', 'SUBMITTED'] };
      if (!allowed[action].includes(row.status)) throw new CollectorSettlementConflictError('La liquidación no permite esta transición.', 'SETTLEMENT_STATE_INVALID');
      const target = { submit: 'SUBMITTED', review: 'UNDER_REVIEW', reject: 'REJECTED', cancel: 'CANCELLED' }[action];
      const actorColumn = { submit: 'submitted_by_user_id', review: 'reviewed_by_user_id', reject: 'rejected_by_user_id', cancel: 'cancelled_by_user_id' }[action];
      const atColumn = { submit: 'submitted_at', review: 'reviewed_at', reject: 'rejected_at', cancel: 'cancelled_at' }[action];
      if (action === 'reject' || action === 'cancel') {
        const items = await manager.query(`SELECT precollection_id AS "precollectionId" FROM collector_settlement_items
          WHERE settlement_id = $1 AND active_reservation = true ORDER BY precollection_id FOR UPDATE`, [id]);
        const ids = items.map((item: { precollectionId: string }) => item.precollectionId);
        if (ids.length) await manager.query(`UPDATE collector_precollections SET status = 'RECORDED', updated_at = now()
          WHERE id = ANY($1::uuid[]) AND status = 'SUBMITTED'`, [ids]);
        await manager.query(`UPDATE collector_settlement_items SET active_reservation = false WHERE settlement_id = $1`, [id]);
      }
      await manager.query(`INSERT INTO collector_settlement_actions
        (settlement_id,action,actor_user_id,reason,idempotency_key,idempotency_fingerprint)
        VALUES ($1,$2,$3,$4,$5,$6)`, [id, actionName, actorUserId, reason, idempotencyKey, fingerprint]);
      await manager.query(`UPDATE collector_settlements SET status = $1, ${actorColumn} = $2, ${atColumn} = now(),
        reason = $3, last_action_idempotency_key = $4, last_action_fingerprint = $5, updated_at = now() WHERE id = $6`,
      [target, actorUserId, reason, idempotencyKey, fingerprint, id]);
      return (await this.detailWith(manager, id))!;
    });
  }

  async confirm(id: string, command: ConfirmCollectorSettlementCommand, fingerprint: string, actorUserId: string) {
    return this.source.transaction(async (manager) => {
      await this.assertActor(manager, actorUserId);
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('collector-settlement-action:' || $1))`, [command.idempotencyKey]);
      const replay = await this.replayAction(manager, id, 'CONFIRM', command.idempotencyKey, fingerprint, actorUserId, true);
      if (replay) return replay;
      await manager.query(`SELECT pg_advisory_xact_lock_shared(hashtext('financial-closes-v2'))`);
      const [settlement] = await manager.query(`SELECT id, status, collector_id AS "collectorId",
        last_action_idempotency_key AS "actionKey", last_action_fingerprint AS "actionFingerprint"
        FROM collector_settlements WHERE id = $1 FOR UPDATE`, [id]);
      if (!settlement) throw new CollectorSettlementNotFoundError('La liquidación no existe.');
      if (settlement.status === 'CONFIRMED') {
        if (settlement.actionKey !== command.idempotencyKey || settlement.actionFingerprint !== fingerprint) {
          throw new CollectorSettlementConflictError('La liquidación ya fue confirmada con datos diferentes.', 'SETTLEMENT_ALREADY_CONFIRMED');
        }
        return (await this.detailWith(manager, id))!;
      }
      if (settlement.status !== 'UNDER_REVIEW') throw new CollectorSettlementConflictError('La liquidación debe estar en revisión.', 'SETTLEMENT_NOT_UNDER_REVIEW');
      const [opening] = await manager.query(`SELECT opening_date::text AS "openingDate" FROM financial_openings
        WHERE singleton_key = 'DEFAULT' FOR SHARE`);
      if (!opening) throw new CollectorSettlementConflictError('Debe realizar la apertura financiera antes de confirmar liquidaciones.', 'FINANCIAL_OPENING_REQUIRED');
      if (command.deliveryDate < opening.openingDate) {
        throw new CollectorSettlementConflictError('La fecha de entrega es anterior a la apertura financiera.', 'BEFORE_FINANCIAL_OPENING');
      }
      const [closed] = await manager.query(`SELECT to_date::text AS "toDate" FROM financial_closes
        WHERE confirmed_at IS NOT NULL ORDER BY sequence DESC LIMIT 1`);
      if (closed && command.deliveryDate <= closed.toDate) {
        throw new CollectorSettlementConflictError('La fecha de entrega pertenece a un período financiero cerrado.', 'CLOSED_FINANCIAL_PERIOD');
      }
      const items = await manager.query(`SELECT item.id, item.precollection_id AS "precollectionId", cp.loan_id AS "loanId",
        cp.collector_id AS "collectorId", cp.payment_method_id AS "paymentMethodId", cp.amount::text AS amount,
        cp.effective_date::text AS "effectiveDate", cp.custody_treatment AS "custodyTreatment", cp.status
        FROM collector_settlement_items item JOIN collector_precollections cp ON cp.id = item.precollection_id
        WHERE item.settlement_id = $1 AND item.active_reservation = true
        ORDER BY cp.loan_id, cp.effective_date, cp.id FOR UPDATE OF item, cp`, [id]);
      if (!items.length || items.some((item: { status: string; collectorId: string }) => item.status !== 'SUBMITTED' || item.collectorId !== settlement.collectorId)) {
        throw new CollectorSettlementConflictError('Los cobros reservados cambiaron y no pueden confirmarse.', 'SETTLEMENT_ITEMS_INVALID');
      }
      const loanIds = [...new Set(items.map((item: { loanId: string }) => item.loanId))].sort();
      await manager.query(`SELECT id FROM loans WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [loanIds]);
      const held = items.filter((item: { custodyTreatment: string }) => item.custodyTreatment === 'COLLECTOR_HELD')
        .reduce((sum: bigint, item: { amount: string }) => sum + cents(item.amount), 0n);
      if (cents(command.amountDelivered) > held) throw new CollectorSettlementConflictError('La entrega supera la custodia confirmada por esta liquidación.', 'DELIVERY_EXCEEDS_CONFIRMED_CUSTODY');
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('collector-custody:' || $1::text))`, [settlement.collectorId]);
      const precollectionIds = items.map((item: { precollectionId: string }) => item.precollectionId);
      const [balance] = await manager.query(`SELECT
        COALESCE((SELECT SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END)
          FROM collector_custody_entries WHERE collector_id = $1),0)::numeric(18,2)::text AS balance,
        COALESCE((SELECT SUM(amount) FROM collector_precollections WHERE collector_id = $1
          AND custody_treatment = 'COLLECTOR_HELD' AND status IN ('RECORDED','SUBMITTED')
          AND NOT (id = ANY($2::uuid[]))),0)::numeric(18,2)::text AS "reservedOther"`,
      [settlement.collectorId, precollectionIds]);
      if (cents(command.amountDelivered) > cents(balance.balance) - cents(balance.reservedOther)) {
        throw new CollectorSettlementConflictError('La entrega consumiría fondos reservados para otros cobros pendientes.', 'INSUFFICIENT_AVAILABLE_CUSTODY');
      }
      let total = 0n;
      for (const item of items) {
        const context = TrustedSettlementPaymentContext.forPrecollection(item.precollectionId, item.loanId, item.collectorId);
        const payment = await this.registrar.register(manager, { loanId: item.loanId, amount: item.amount,
          paymentDate: item.effectiveDate, methodId: item.paymentMethodId, collectorId: item.collectorId,
          idempotencyKey: context.paymentKey() }, actorUserId, context);
        await manager.query(`UPDATE collector_precollections SET status = 'SETTLED', updated_at = now() WHERE id = $1`, [item.precollectionId]);
        await manager.query(`UPDATE collector_settlement_items SET confirmed_amount = $1::numeric(18,2), payment_id = $2
          WHERE id = $3`, [item.amount, payment.id, item.id]);
        total += cents(item.amount);
      }
      if (cents(command.amountDelivered) > 0n) {
        const [method] = await manager.query(`SELECT id FROM payment_methods WHERE id = $1 AND is_active = true FOR SHARE`, [command.deliveryPaymentMethodId]);
        if (!method) throw new CollectorSettlementConflictError('La forma de entrega no está activa.', 'DELIVERY_METHOD_INACTIVE');
        await manager.query(`INSERT INTO collector_custody_entries
          (collector_id,direction,entry_type,amount,effective_date,payment_method_id,reference,notes,settlement_id,
           created_by_user_id,idempotency_key,idempotency_fingerprint)
          VALUES ($1,'DEBIT','REMITTANCE_TO_COMPANY',$2::numeric(18,2),$3,$4,$5,$6,$7,$8,$9,$10)`,
        [settlement.collectorId, command.amountDelivered, command.deliveryDate, command.deliveryPaymentMethodId,
          command.deliveryReference, command.deliveryNotes, id, actorUserId, `settlement:${id}:remittance`, fingerprint]);
      }
      const delivered = cents(command.amountDelivered);
      await manager.query(`UPDATE collector_settlement_items SET active_reservation = false WHERE settlement_id = $1`, [id]);
      await manager.query(`INSERT INTO collector_settlement_actions
        (settlement_id,action,actor_user_id,reason,idempotency_key,idempotency_fingerprint)
        VALUES ($1,'CONFIRM',$2,NULL,$3,$4)`, [id, actorUserId, command.idempotencyKey, fingerprint]);
      await manager.query(`UPDATE collector_settlements SET status = 'CONFIRMED', total_confirmed = $1::numeric(18,2),
        amount_delivered = $2::numeric(18,2), retained_amount = $3::numeric(18,2),
        difference_amount = total_declared - $1::numeric(18,2), delivery_date = $4,
        delivery_payment_method_id = $5, delivery_reference = $6, delivery_notes = $7,
        confirmed_by_user_id = $8, confirmed_at = now(), last_action_idempotency_key = $9,
        last_action_fingerprint = $10, updated_at = now() WHERE id = $11`,
      [money(total), command.amountDelivered, money(held - delivered), command.deliveryDate,
        command.deliveryPaymentMethodId, command.deliveryReference, command.deliveryNotes, actorUserId,
        command.idempotencyKey, fingerprint, id]);
      return (await this.detailWith(manager, id))!;
    });
  }
}
