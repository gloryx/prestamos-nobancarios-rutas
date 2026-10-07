import type { DataSource } from 'typeorm';
import { CollectorFinancialSummaryIntegrityError, type CollectorFinancialSummary, type CollectorFinancialSummaryReader } from '../../../../application/collector/collector-financial-summary.use-case';

type SummaryRow = CollectorFinancialSummary & { integrityFailures: number };

export class CollectorFinancialSummaryTypeormReader implements CollectorFinancialSummaryReader {
  constructor(private readonly source: DataSource) {}

  async read(collectorUserId: string): Promise<CollectorFinancialSummary | null> {
    const rows = await this.source.query(`
      WITH collector_scope AS MATERIALIZED (
        SELECT DISTINCT cl.id AS collector_id
        FROM users u
        JOIN roles role ON role.id=u.role_id AND role.is_active=true AND role.code='COLLECTOR'
        JOIN collectors cl ON cl.user_id=u.id AND cl.is_active=true
        WHERE u.id=$1::uuid AND u.is_active=true
      ), assigned_customers AS MATERIALIZED (
        SELECT DISTINCT c.id
        FROM collector_scope cs
        JOIN collector_route_assignments cra ON cra.collector_user_id=$1::uuid AND cra.ended_at IS NULL
        JOIN routes r ON r.id=cra.route_id AND r.is_active=true
        JOIN customer_route_assignments ca ON ca.route_id=r.id AND ca.ended_at IS NULL
        JOIN customers c ON c.id=ca.customer_id AND c.is_active=true
      ), active_loans AS MATERIALIZED (
        SELECT l.id,l.customer_id,l.principal,l.interest_amount,l.total_amount
        FROM loans l JOIN assigned_customers c ON c.id=l.customer_id
        WHERE l.status='ACTIVE'
      ), payment_totals AS MATERIALIZED (
        SELECT p.loan_id,COALESCE(SUM(p.amount),0) AS paid_amount,
          COALESCE(SUM(p.principal_applied),0) AS paid_principal,COALESCE(SUM(p.interest_applied),0) AS paid_interest,
          COUNT(*) FILTER (WHERE p.amount<=0 OR p.principal_applied<0 OR p.interest_applied<0
            OR p.amount<>p.principal_applied+p.interest_applied)::int AS invalid_count
        FROM payments p JOIN active_loans l ON l.id=p.loan_id WHERE p.status='VALID' GROUP BY p.loan_id
      ), plan_totals AS MATERIALIZED (
        SELECT e.loan_id,COALESCE(SUM(e.pending_amount) FILTER (WHERE e.pending_amount>0),0) AS pending_amount
        FROM payment_plan_entries e JOIN active_loans l ON l.id=e.loan_id GROUP BY e.loan_id
      ), financials AS MATERIALIZED (
        SELECT l.id,l.principal,(l.total_amount-COALESCE(p.paid_amount,0)) AS balance,
          COALESCE(p.paid_interest,0) AS realized_gain,
          CASE WHEN COALESCE(p.invalid_count,0)>0 OR l.total_amount-COALESCE(p.paid_amount,0)<0
            OR l.principal-COALESCE(p.paid_principal,0)<0 OR l.interest_amount-COALESCE(p.paid_interest,0)<0
            OR l.total_amount-COALESCE(p.paid_amount,0)<>l.principal-COALESCE(p.paid_principal,0)+l.interest_amount-COALESCE(p.paid_interest,0)
            OR l.total_amount-COALESCE(p.paid_amount,0)<>COALESCE(plan.pending_amount,0) THEN 1 ELSE 0 END AS integrity_failure
        FROM active_loans l LEFT JOIN payment_totals p ON p.loan_id=l.id LEFT JOIN plan_totals plan ON plan.loan_id=l.id
      ), portfolio AS (
        SELECT COALESCE(SUM(principal),0)::numeric(38,2)::text AS total_placed,
          COALESCE(SUM(balance),0)::numeric(38,2)::text AS total_outstanding,
          COALESCE(SUM(realized_gain),0)::numeric(38,2)::text AS realized_gain,
          COUNT(*)::int AS active_loans_count,
          COALESCE(SUM(integrity_failure),0)::int AS integrity_failures
        FROM financials
      )
      SELECT portfolio.total_placed AS "totalPlaced",portfolio.total_outstanding AS "totalOutstanding",
        portfolio.realized_gain AS "realizedGain",portfolio.active_loans_count AS "activeLoansCount",
        portfolio.integrity_failures AS "integrityFailures"
      FROM collector_scope CROSS JOIN portfolio`, [collectorUserId]) as SummaryRow[];
    const row = rows[0];
    if (!row) return null;
    if (Number(row.integrityFailures) > 0) throw new CollectorFinancialSummaryIntegrityError('La cartera activa asignada no supera la validación de integridad financiera.');
    return {
      totalPlaced: row.totalPlaced,
      totalOutstanding: row.totalOutstanding,
      realizedGain: row.realizedGain,
      activeLoansCount: Number(row.activeLoansCount),
    };
  }
}
