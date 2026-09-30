import type { DataSource } from 'typeorm';
import type { CancelledLoansQuery, CancelledLoansReader, CancelledLoansResult, CancelledLoanSort } from '../../../../application/loan/cancelled-loans.use-case';

const SORT_COLUMNS: Record<CancelledLoanSort, string> = {
  loanNumber: 'f."loanNumber"', customer: 'LOWER(f."customerName")', startDate: 'f."startDate"',
  cancelledDate: 'f."cancelledDate"', principal: 'f.principal', recoveredInterest: 'f."recoveredInterest"', totalRecovered: 'f."totalRecovered"',
};

export class CancelledLoansTypeormReader implements CancelledLoansReader {
  constructor(private readonly dataSource: DataSource) {}

  async list(query: CancelledLoansQuery): Promise<CancelledLoansResult> {
    const params: unknown[] = [];
    const conditions = ["l.status = 'CANCELLED'"];
    if (query.search) {
      params.push(`%${query.search}%`);
      const p = `$${params.length}`;
      conditions.push(`(l.loan_number::text ILIKE ${p} OR c.identification ILIKE ${p} OR concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) ILIKE ${p} OR c.primary_phone ILIKE ${p} OR c.secondary_phone ILIKE ${p} OR EXISTS (SELECT 1 FROM customer_addresses ca WHERE ca.customer_id=c.id AND ca.exact_address ILIKE ${p}))`);
    }
    if (query.startDate) { params.push(query.startDate); conditions.push(`pa."cancelledDate" >= $${params.length}::date`); }
    if (query.endDate) { params.push(query.endDate); conditions.push(`pa."cancelledDate" <= $${params.length}::date`); }
    const sort = SORT_COLUMNS[query.sortBy ?? 'cancelledDate'];
    const direction = query.sortDirection === 'asc' ? 'ASC' : 'DESC';
    const ordering = `${sort} ${direction} NULLS LAST, f."loanNumber" DESC, f.id ASC`;
    params.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows: Array<{ items: CancelledLoansResult['items']; total: number; cancelledLoansCount: number; recoveredAmount: string; realizedProfit: string }> = await this.dataSource.query(`
      WITH payment_totals AS (
        SELECT p.loan_id, MAX(p.payment_date) AS "cancelledDate", SUM(p.amount) AS "totalRecovered", SUM(p.interest_applied) AS "recoveredInterest"
        FROM payments p WHERE p.status = 'VALID' GROUP BY p.loan_id
      ), filtered AS (
        SELECT l.id, l.loan_number AS "loanNumber", l.start_date AS "startDate", l.principal,
          concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) AS "customerName", c.identification,
          pa."cancelledDate", COALESCE(pa."totalRecovered", 0.00) AS "totalRecovered",
          COALESCE(pa."recoveredInterest", 0.00) AS "recoveredInterest"
        FROM loans l JOIN customers c ON c.id = l.customer_id
        LEFT JOIN payment_totals pa ON pa.loan_id = l.id
        WHERE ${conditions.join(' AND ')}
      ), totals AS (
        SELECT COUNT(DISTINCT id)::int AS "cancelledLoansCount",
          COALESCE(SUM("totalRecovered"), 0.00)::text AS "recoveredAmount",
          COALESCE(SUM("recoveredInterest"), 0.00)::text AS "realizedProfit" FROM filtered
      ), page_rows AS (
        SELECT f.*, row_number() OVER (ORDER BY ${ordering}) AS position
        FROM filtered f ORDER BY ${ordering} LIMIT $${params.length - 1} OFFSET $${params.length}
      )
      SELECT (SELECT COALESCE(json_agg(json_build_object(
        'id', r.id, 'loanNumber', r."loanNumber"::text, 'customerName', r."customerName",
        'identification', r.identification, 'startDate', r."startDate"::text,
        'cancelledDate', r."cancelledDate"::text, 'principal', r.principal::text,
        'recoveredInterest', r."recoveredInterest"::text, 'totalRecovered', r."totalRecovered"::text
      ) ORDER BY r.position), '[]'::json) FROM page_rows r) AS items,
      t."cancelledLoansCount" AS total, t."cancelledLoansCount", t."recoveredAmount", t."realizedProfit" FROM totals t
    `, params);
    const result = rows[0];
    return { items: result.items, total: result.total, page: query.page, pageSize: query.pageSize,
      summary: { cancelledLoansCount: result.cancelledLoansCount, recoveredAmount: result.recoveredAmount, realizedProfit: result.realizedProfit } };
  }
}
