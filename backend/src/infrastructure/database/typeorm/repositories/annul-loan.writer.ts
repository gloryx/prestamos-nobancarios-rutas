import type { DataSource, EntityManager } from 'typeorm';
import type { AnnulLoanWriter, AnnulLoanTransaction, AnnulmentEvent, AnnulmentLedger } from '../../../../application/loan/annul-loan.use-case';

const eventColumns = `id, loan_id AS "loanId", event_sequence AS "eventSequence", event_kind AS "eventKind",
  from_status AS "fromStatus", to_status AS "toStatus", changed_by_user_id AS "actorId", reason,
  disbursement_resolution AS "disbursementResolution", idempotency_fingerprint AS fingerprint,
  to_char(changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "annulledAt",
  to_char((changed_at AT TIME ZONE 'America/Costa_Rica')::date, 'YYYY-MM-DD') AS "annulledBusinessDate"`;

export class AnnulLoanTypeormWriter implements AnnulLoanWriter {
  constructor(private readonly source: DataSource) {}
  transaction<T>(run: (tx: AnnulLoanTransaction) => Promise<T>): Promise<T> {
    return this.source.transaction((manager: EntityManager) => run({
      executor: manager,
      lockLoan: async (id) => (await manager.query('SELECT id, status FROM loans WHERE id = $1 FOR UPDATE', [id]))[0],
      findByKey: async (key) => (await manager.query(`SELECT ${eventColumns} FROM loan_status_history WHERE idempotency_key = $1`, [key]))[0] as AnnulmentEvent | undefined,
      latestEvent: async (id) => (await manager.query(`SELECT ${eventColumns} FROM loan_status_history WHERE loan_id = $1 ORDER BY event_sequence DESC LIMIT 1`, [id]))[0] as AnnulmentEvent | undefined,
      hasValidPayment: async (id) => {
        const result = (await manager.query("SELECT EXISTS (SELECT 1 FROM payments WHERE loan_id = $1 AND status = 'VALID') AS present", [id]))[0]?.present;
        if (typeof result !== 'boolean') throw new Error('Valid payment guard is unavailable.');
        return result;
      },
      readLedger: async (id) => (await manager.query(`SELECT l.principal::text AS principal, l.interest_amount::text AS "interestAmount",
        l.total_amount::text AS "totalAmount", l.start_date::text AS "startDate",
        (SELECT COUNT(*)::int FROM payment_plan_entries WHERE loan_id = l.id) AS "planCount",
        (SELECT COALESCE(SUM(pending_amount),0)::text FROM payment_plan_entries WHERE loan_id = l.id) AS "pendingPlan",
        d.id AS "disbursementId", d.amount::text AS "disbursementAmount", d.disbursement_date::text AS "disbursementDate",
        d.payment_method_id AS "disbursementMethodId", original.id AS "originalId", original.amount::text AS "originalAmount",
        original.movement_date::text AS "originalDate", original.payment_method_id AS "originalMethodId",
        original.concept AS "originalConcept", original.direction AS "originalDirection", reversal.id AS "reversalId",
        reversal.amount::text AS "reversalAmount", reversal.movement_date::text AS "reversalDate",
        reversal.payment_method_id AS "reversalMethodId", reversal.concept AS "reversalConcept", reversal.direction AS "reversalDirection",
        reversal.created_by_user_id AS "reversalActorId", reversal.idempotency_key AS "reversalKey",
        reversal.idempotency_fingerprint AS "reversalFingerprint"
        FROM loans l LEFT JOIN loan_disbursements d ON d.loan_id = l.id
        LEFT JOIN cash_movements original ON original.loan_disbursement_id = d.id
        LEFT JOIN cash_movements reversal ON reversal.reversed_movement_id = original.id WHERE l.id = $1`, [id]))[0] as AnnulmentLedger | undefined,
      updateActiveLoan: async (id) => {
        const raw: unknown = await manager.query("UPDATE loans SET status = 'ANNULLED', updated_at = now() WHERE id = $1 AND status = 'ACTIVE' RETURNING id", [id]);
        return Array.isArray(raw) && Array.isArray(raw[0]) && raw[0].length === 1 && raw[0][0]?.id === id && raw[1] === 1;
      },
      insertEvent: async (id, sequence, actor, reason, resolution, key, fingerprint) =>
        (await manager.query(`INSERT INTO loan_status_history (loan_id, event_sequence, event_kind, from_status, to_status,
          changed_at, changed_by_user_id, reason, disbursement_resolution, idempotency_key, idempotency_fingerprint)
          VALUES ($1,$2,'TRANSITION','ACTIVE','ANNULLED',clock_timestamp(),$3,$4,$5,$6,$7)
          ON CONFLICT DO NOTHING RETURNING ${eventColumns}`, [id, sequence, actor, reason, resolution, key, fingerprint]))[0] as AnnulmentEvent | undefined,
      reverse: async (original, amount, date, method, actor, key, fingerprint) => {
        const rows: Array<{ id: string }> = await manager.query(`INSERT INTO cash_movements
          (direction, concept, amount, movement_date, payment_method_id, observations, reversed_movement_id,
          created_by_user_id, idempotency_key, idempotency_fingerprint)
          VALUES ('INFLOW','REVERSAL',$1::numeric(18,2),$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT DO NOTHING RETURNING id`, [amount, date, method, 'Anulación de desembolso de préstamo', original, actor, key, fingerprint]);
        return rows.length === 1;
      },
    }));
  }
}
