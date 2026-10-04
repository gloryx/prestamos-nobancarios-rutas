import type { DataSource } from 'typeorm';
import type { AnnulledLoanRow, AnnulledLoansReader } from '../../../../application/loan/annulled-loans.use-case';

export class AnnulledLoansTypeormReader implements AnnulledLoansReader {
  constructor(private readonly source: DataSource) {}
  async read(kind: 'annullable' | 'annulled', search?: string): Promise<AnnulledLoanRow[]> {
    const params: unknown[] = [];
    const where = [`l.status = '${kind === 'annulled' ? 'ANNULLED' : 'ACTIVE'}'`];
    if (kind === 'annullable') where.push("NOT EXISTS (SELECT 1 FROM payments p WHERE p.loan_id = l.id AND p.status = 'VALID')", "NOT EXISTS (SELECT 1 FROM loan_refinancings r WHERE r.new_loan_id = l.id)");
    if (search) {
      params.push(`%${search}%`);
      const p = `$${params.length}`;
      where.push(`(l.loan_number::text ILIKE ${p} OR c.identification ILIKE ${p} OR
        concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) ILIKE ${p} OR
        c.primary_phone ILIKE ${p} OR c.secondary_phone ILIKE ${p})`);
    }
    return this.source.transaction('REPEATABLE READ', (manager) => manager.query(`SELECT
      l.id AS "loanId", l.loan_number::text AS "loanNumber", c.id AS "customerId", c.identification,
      concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) AS "fullName",
      l.start_date::text AS "startDate", l.principal::text AS principal,
      l.interest_amount::text AS "interestAmount", l.total_amount::text AS "totalAmount",
      d.id AS "disbursementId", d.amount::text AS "disbursementAmount",
      d.disbursement_date::text AS "disbursementDate", d.payment_method_id AS "disbursementMethodId",
      original.id AS "cashId", original.amount::text AS "cashAmount", original.movement_date::text AS "cashDate",
      original.payment_method_id AS "cashMethodId", original.direction AS "cashDirection", original.concept AS "cashConcept",
      reversal.id AS "reversalId", reversal.amount::text AS "reversalAmount", reversal.movement_date::text AS "reversalDate",
      reversal.payment_method_id AS "reversalMethodId", reversal.direction AS "reversalDirection", reversal.concept AS "reversalConcept",
      reversal.created_by_user_id AS "reversalActorId", reversal.idempotency_key AS "reversalKey",
      reversal.idempotency_fingerprint AS "reversalFingerprint",
      event.id AS "eventId", event.event_sequence AS "eventSequence", event.event_kind AS "eventKind",
      event.from_status AS "fromStatus", event.to_status AS "toStatus",
      to_char(event.changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "annulledAt",
      to_char((event.changed_at AT TIME ZONE 'America/Costa_Rica')::date, 'YYYY-MM-DD') AS "annulledBusinessDate",
      event.reason, event.changed_by_user_id AS "actorId", event.disbursement_resolution AS "disbursementResolution",
      event.idempotency_fingerprint AS "eventFingerprint"
      FROM loans l JOIN customers c ON c.id = l.customer_id
      LEFT JOIN loan_disbursements d ON d.loan_id = l.id
      LEFT JOIN cash_movements original ON original.loan_disbursement_id = d.id
      LEFT JOIN cash_movements reversal ON reversal.reversed_movement_id = original.id
      LEFT JOIN LATERAL (SELECT h.* FROM loan_status_history h WHERE h.loan_id = l.id
        ORDER BY h.event_sequence DESC LIMIT 1) event ON true
      WHERE ${where.join(' AND ')}`, params));
  }
}
