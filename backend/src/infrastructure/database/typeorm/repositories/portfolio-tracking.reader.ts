import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { PortfolioTrackingPosition, PortfolioTrackingQuery, PortfolioTrackingReader } from '../../../../application/payment/portfolio-tracking.use-case';

@Injectable()
export class PortfolioTrackingTypeormReader implements PortfolioTrackingReader {
  constructor(private readonly dataSource: DataSource) {}

  async locate(query: PortfolioTrackingQuery): Promise<PortfolioTrackingPosition | null> {
    const rows = await this.dataSource.query(`
      WITH plan_facts AS (
        SELECT e.loan_id,
          COALESCE(SUM(e.pending_amount) FILTER (WHERE e.pending_amount > 0), 0)::numeric(18,2) AS pending_total,
          MIN(e.due_date) FILTER (WHERE e.pending_amount > 0) AS first_pending_due_date,
          MAX(e.due_date) FILTER (WHERE e.pending_amount > 0) AS contractual_due_date
        FROM payment_plan_entries e
        GROUP BY e.loan_id
      ), classified AS (
        SELECT l.id AS loan_id, l.loan_number, l.status, l.start_date, pf.contractual_due_date,
          CASE
            WHEN COALESCE(pf.pending_total, 0) <= 0 OR pf.first_pending_due_date IS NULL THEN NULL
            WHEN pf.contractual_due_date < CURRENT_DATE THEN 'TERM_EXPIRED'
            WHEN pf.first_pending_due_date < CURRENT_DATE THEN 'OVERDUE'
            WHEN pf.first_pending_due_date = CURRENT_DATE THEN 'PENDING'
            ELSE 'ON_TRACK'
          END AS collection_status
        FROM loans l
        JOIN customers c ON c.id = l.customer_id
        LEFT JOIN plan_facts pf ON pf.loan_id = l.id
        WHERE l.status IN ('ACTIVE', 'UNCOLLECTIBLE')
          AND COALESCE(pf.pending_total, 0) > 0
          AND ($1 = '' OR l.loan_number::text ILIKE $5 OR c.identification ILIKE $5
          OR concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) ILIKE $5
          OR c.primary_phone ILIKE $5 OR COALESCE(c.secondary_phone, '') ILIKE $5)
          AND ($2 = 'ALL' OR l.status = $2)
      ), filtered AS (
        SELECT * FROM classified WHERE ($3 = 'ALL' OR collection_status = $3)
      ), ranked AS (
        SELECT *, row_number() OVER (ORDER BY loan_number DESC, loan_id)::int AS position,
          count(*) OVER ()::int AS total
        FROM filtered
      )
      SELECT loan_id AS "loanId", status, collection_status AS "collectionStatus",
        start_date::text AS "startDate", contractual_due_date::text AS "contractualDueDate", position, total
      FROM ranked
      WHERE position = LEAST($4, total)
    `, [query.search, query.status, query.collectionStatus, query.position, `%${query.search}%`]);
    return rows[0] ?? null;
  }
}
