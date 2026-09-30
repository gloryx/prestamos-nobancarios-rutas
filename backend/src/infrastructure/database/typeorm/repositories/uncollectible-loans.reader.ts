import type { DataSource } from 'typeorm';
import { assertCurrentDeclaration, type UncollectibleCandidate, type UncollectibleLoansQuery,
  type UncollectibleLoansReader, type UncollectibleSnapshot } from '../../../../application/loan/uncollectible-loans.use-case';
import { LoanFinancialBatchTypeormReader } from './loan-financial-batch.reader';

export class UncollectibleLoansTypeormReader implements UncollectibleLoansReader {
  constructor(private readonly dataSource: DataSource, private readonly batch = new LoanFinancialBatchTypeormReader()) {}

  read(query: UncollectibleLoansQuery): Promise<UncollectibleSnapshot> {
    const params: unknown[] = [];
    const where = ["l.status = 'UNCOLLECTIBLE'"];
    if (query.search) {
      params.push(`%${query.search}%`);
      const p = `$${params.length}`;
      where.push(`(l.loan_number::text ILIKE ${p} OR c.identification ILIKE ${p} OR concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) ILIKE ${p} OR c.primary_phone ILIKE ${p} OR c.secondary_phone ILIKE ${p})`);
    }
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const candidates: UncollectibleCandidate[] = await manager.query(`SELECT l.id AS "loanId", l.loan_number::text AS "loanNumber",
        c.id AS "customerId", c.identification, concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) AS "fullName",
        l.start_date::text AS "startDate", l.principal::text AS principal, l.interest_amount::text AS "interestAmount",
        l.total_amount::text AS "totalAmount", event.id AS "eventId", event.from_status AS "fromStatus", event.to_status AS "toStatus",
        to_char(event.changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "uncollectibleAt",
        to_char((event.changed_at AT TIME ZONE 'America/Costa_Rica')::date, 'YYYY-MM-DD') AS "uncollectibleBusinessDate",
        event.reason AS "uncollectibleReason", event.changed_by_user_id AS "changedByUserId"
        FROM loans l JOIN customers c ON c.id = l.customer_id
        LEFT JOIN LATERAL (SELECT h.id, h.from_status, h.to_status, h.changed_at, h.reason, h.changed_by_user_id
          FROM loan_status_history h WHERE h.loan_id = l.id AND h.event_kind = 'TRANSITION'
          ORDER BY h.event_sequence DESC LIMIT 1) event ON true
        WHERE ${where.join(' AND ')}`, params);
      // Audit every search-matching current loan before date bounds can hide inconsistent history.
      for (const row of candidates) assertCurrentDeclaration(row);
      const filtered = candidates.filter((row) => (!query.startDate || row.uncollectibleBusinessDate! >= query.startDate) &&
        (!query.endDate || row.uncollectibleBusinessDate! <= query.endDate));
      const financial = await this.batch.readLoanFinancialIntegrityBatch(manager, filtered.map((row) => row.loanId));
      return { candidates: filtered, financial };
    });
  }
}
