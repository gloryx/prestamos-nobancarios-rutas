import type { DataSource, EntityManager } from 'typeorm';
import type { MarkUncollectibleWriter, MarkUncollectibleTransaction, UncollectibleEvent } from '../../../../application/loan/mark-uncollectible.use-case';

const eventColumns = `id, loan_id AS "loanId", event_sequence AS "eventSequence", event_kind AS "eventKind",
  from_status AS "fromStatus", to_status AS "toStatus", changed_at AS "changedAt",
  changed_by_user_id AS "changedByUserId", reason, idempotency_fingerprint AS "idempotencyFingerprint"`;

export class MarkUncollectibleTypeormWriter implements MarkUncollectibleWriter {
  constructor(private readonly source: DataSource) {}

  transaction<T>(run: (tx: MarkUncollectibleTransaction) => Promise<T>): Promise<T> {
    return this.source.transaction((manager: EntityManager) => run({
      executor: manager,
      lockLoan: async (id) => (await manager.query('SELECT id, status FROM loans WHERE id = $1 FOR UPDATE', [id]))[0],
      findByKey: async (key) => (await manager.query(`SELECT ${eventColumns} FROM loan_status_history WHERE idempotency_key = $1`, [key]))[0] as UncollectibleEvent | undefined,
      updateActiveLoan: async (id) => {
        const raw: unknown = await manager.query("UPDATE loans SET status = 'UNCOLLECTIBLE', updated_at = now() WHERE id = $1 AND status = 'ACTIVE' RETURNING id", [id]);
        return Array.isArray(raw) && Array.isArray(raw[0]) && raw[0].length === 1
          && raw[0][0]?.id === id && raw[1] === 1;
      },
      insertEvent: async (id, sequence, actor, reason, key, fingerprint) => {
        const rows: UncollectibleEvent[] = await manager.query(`INSERT INTO loan_status_history
          (loan_id, event_sequence, event_kind, from_status, to_status, changed_at, changed_by_user_id, reason, payment_id, payment_annulment_id, idempotency_key, idempotency_fingerprint)
          VALUES ($1,$2,'TRANSITION','ACTIVE','UNCOLLECTIBLE',clock_timestamp(),$3,$4,NULL,NULL,$5,$6)
          ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING ${eventColumns}`,
        [id, sequence, actor, reason, key, fingerprint]);
        return rows[0];
      },
    }));
  }
}
