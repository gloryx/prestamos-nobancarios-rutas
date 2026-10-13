import type { DataSource, EntityManager } from 'typeorm';
import type { CollectorCustodyCommand, CollectorCustodyStore } from '../../../../application/collector-custody/collector-custody.ports';
import { CollectorCustodyConflictError, CollectorCustodyForbiddenError,
  CollectorCustodyNotFoundError } from '../../../../domain/collector-custody/collector-custody.errors';
import type { CollectorCustodyEntry, CollectorCustodySummary } from '../../../../domain/collector-custody/collector-custody.types';

const cents = (value: string) => { const negative = value.startsWith('-'); const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.'); const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); return negative ? -amount : amount; };
const money = (value: bigint) => { const negative = value < 0n; const absolute = negative ? -value : value; return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`; };
export class CollectorCustodyTypeOrmStore implements CollectorCustodyStore {
  constructor(private readonly source: DataSource) {}
  private async collector(executor: Pick<EntityManager, 'query'>, actorUserId: string, requested: string | undefined, allowGlobal: boolean) {
    const [actor] = await executor.query(`SELECT actor.id, collector.id AS "collectorId" FROM users actor
      LEFT JOIN collectors collector ON collector.user_id = actor.id AND collector.is_active = true
      WHERE actor.id = $1 AND actor.is_active = true`, [actorUserId]);
    if (!actor) throw new CollectorCustodyForbiddenError('El usuario autenticado no está activo.');
    const collectorId = requested && allowGlobal ? requested : actor.collectorId;
    if (!collectorId) throw new CollectorCustodyForbiddenError('No existe un perfil de cobrador activo.');
    const [target] = await executor.query(`SELECT id FROM collectors WHERE id = $1 AND is_active = true FOR SHARE`, [collectorId]);
    if (!target) throw new CollectorCustodyNotFoundError('El cobrador no existe o está inactivo.');
    return collectorId as string;
  }
  async summary(actorUserId: string, requested: string | undefined, allowGlobal: boolean): Promise<CollectorCustodySummary> {
    const collectorId = await this.collector(this.source, actorUserId, requested, allowGlobal);
    const [safe] = await this.source.query(`SELECT
      COALESCE((SELECT SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END)
        FROM collector_custody_entries WHERE collector_id = $1),0)::numeric(18,2)::text AS "declaredBalance",
      COALESCE((SELECT SUM(amount) FROM collector_precollections WHERE collector_id = $1
        AND custody_treatment = 'COLLECTOR_HELD' AND status IN ('RECORDED','SUBMITTED')),0)::numeric(18,2)::text AS "pendingAmount"`, [collectorId]);
    const declared = cents(safe.declaredBalance); const pending = cents(safe.pendingAmount);
    return { collectorId, declaredBalance: money(declared), confirmedBalance: money(declared - pending),
      pendingAmount: safe.pendingAmount, differenceAmount: safe.pendingAmount };
  }
  async history(actorUserId: string, requested: string | undefined, allowGlobal: boolean) {
    const collectorId = await this.collector(this.source, actorUserId, requested, allowGlobal);
    return this.source.query(`SELECT id, collector_id AS "collectorId", direction, entry_type AS "entryType", amount::text AS amount,
      effective_date::text AS "effectiveDate", payment_method_id AS "paymentMethodId", reference, reason, notes,
      precollection_id AS "precollectionId", settlement_id AS "settlementId", reversed_entry_id AS "reversedEntryId",
      created_by_user_id AS "createdByUserId", created_at AS "createdAt" FROM collector_custody_entries
      WHERE collector_id = $1 ORDER BY effective_date DESC, created_at DESC, id DESC`, [collectorId]) as Promise<CollectorCustodyEntry[]>;
  }
  async record(kind: 'remittance' | 'topup' | 'adjustment', command: CollectorCustodyCommand, fingerprint: string,
    actorUserId: string, allowGlobal: boolean) {
    return this.source.transaction(async (manager) => {
      const collectorId = await this.collector(manager, actorUserId, command.collectorId, allowGlobal);
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('collector-custody-idempotency:' || $1))`, [command.idempotencyKey]);
      const [existing] = await manager.query(`SELECT id, collector_id AS "collectorId", created_by_user_id AS "createdByUserId",
        idempotency_fingerprint AS fingerprint FROM collector_custody_entries
        WHERE idempotency_key = $1 FOR SHARE`, [command.idempotencyKey]);
      if (existing) {
        if (existing.fingerprint !== fingerprint || existing.collectorId !== collectorId || existing.createdByUserId !== actorUserId) {
          throw new CollectorCustodyConflictError('La clave de idempotencia fue utilizada con datos diferentes.', 'IDEMPOTENCY_KEY_REUSED');
        }
        const [entry] = await manager.query(`SELECT id, collector_id AS "collectorId", direction, entry_type AS "entryType",
          amount::text AS amount, effective_date::text AS "effectiveDate", payment_method_id AS "paymentMethodId",
          reference, reason, notes, precollection_id AS "precollectionId", settlement_id AS "settlementId",
          reversed_entry_id AS "reversedEntryId", created_by_user_id AS "createdByUserId", created_at AS "createdAt"
          FROM collector_custody_entries WHERE id = $1`, [existing.id]);
        return entry as CollectorCustodyEntry;
      }
      await manager.query(`SELECT pg_advisory_xact_lock_shared(hashtext('financial-closes-v2'))`);
      const [opening] = await manager.query(`SELECT opening_date::text AS "openingDate" FROM financial_openings
        WHERE singleton_key = 'DEFAULT' FOR SHARE`);
      if (!opening) throw new CollectorCustodyConflictError('Debe realizar la apertura financiera antes de registrar movimientos.', 'FINANCIAL_OPENING_REQUIRED');
      if (command.effectiveDate < opening.openingDate) throw new CollectorCustodyConflictError('La fecha es anterior a la apertura financiera.', 'BEFORE_FINANCIAL_OPENING');
      const [closed] = await manager.query(`SELECT to_date::text AS "toDate" FROM financial_closes
        WHERE confirmed_at IS NOT NULL ORDER BY sequence DESC LIMIT 1`);
      if (closed && command.effectiveDate <= closed.toDate) throw new CollectorCustodyConflictError('La fecha pertenece a un período financiero cerrado.', 'CLOSED_FINANCIAL_PERIOD');
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('collector-custody:' || $1::text))`, [collectorId]);
      const [method] = await manager.query(`SELECT id FROM payment_methods WHERE id = $1 AND is_active = true FOR SHARE`, [command.paymentMethodId]);
      if (!method) throw new CollectorCustodyConflictError('La forma de pago no está activa.', 'PAYMENT_METHOD_INACTIVE');
      const direction = kind === 'topup' ? 'CREDIT' : kind === 'remittance' ? 'DEBIT' : command.direction!;
      const entryType = kind === 'topup' ? 'COMPANY_TOP_UP' : kind === 'remittance' ? 'REMITTANCE_TO_COMPANY' : 'AUTHORIZED_ADJUSTMENT';
      if (direction === 'DEBIT') {
        const [balance] = await manager.query(`SELECT
          COALESCE((SELECT SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END)
            FROM collector_custody_entries WHERE collector_id = $1),0)::numeric(18,2)::text AS balance,
          COALESCE((SELECT SUM(amount) FROM collector_precollections WHERE collector_id = $1
            AND custody_treatment = 'COLLECTOR_HELD' AND status IN ('RECORDED','SUBMITTED')),0)::numeric(18,2)::text AS reserved`, [collectorId]);
        if (cents(command.amount) > cents(balance.balance) - cents(balance.reserved)) {
          throw new CollectorCustodyConflictError('Los fondos disponibles no cubren el movimiento sin consumir cobros pendientes.', 'INSUFFICIENT_AVAILABLE_CUSTODY');
        }
      }
      const [created] = await manager.query(`INSERT INTO collector_custody_entries
        (collector_id,direction,entry_type,amount,effective_date,payment_method_id,reference,reason,notes,
         created_by_user_id,idempotency_key,idempotency_fingerprint)
        VALUES ($1,$2,$3,$4::numeric(18,2),$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id, collector_id AS "collectorId", direction, entry_type AS "entryType", amount::text AS amount,
          effective_date::text AS "effectiveDate", payment_method_id AS "paymentMethodId", reference, reason, notes,
          precollection_id AS "precollectionId", settlement_id AS "settlementId", reversed_entry_id AS "reversedEntryId",
          created_by_user_id AS "createdByUserId", created_at AS "createdAt"`,
      [collectorId, direction, entryType, command.amount, command.effectiveDate, command.paymentMethodId,
        command.reference, command.reason, command.notes, actorUserId, command.idempotencyKey, fingerprint]);
      return created as CollectorCustodyEntry;
    });
  }
}
