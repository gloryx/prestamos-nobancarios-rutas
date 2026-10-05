import type { DataSource } from 'typeorm';
import type { CollectorPaymentsReportQuery, CollectorPaymentsReportReader, CollectorPaymentsReportResult }
  from '../../../../application/payment/collector-payments-report.use-case';

const collectorName = "concat_ws(' ', cl.first_name, cl.first_last_name, cl.second_last_name)";

export class CollectorPaymentsReportTypeormReader implements CollectorPaymentsReportReader {
  constructor(private readonly source: DataSource) {}

  async read(query: CollectorPaymentsReportQuery): Promise<CollectorPaymentsReportResult> {
    const params: unknown[] = [query.fromDate, query.toDate];
    const filters = ["p.status = 'VALID'", 'p.payment_date >= $1::date', 'p.payment_date <= $2::date'];
    if (query.collectorId) { params.push(query.collectorId); filters.push(`p.collector_id = $${params.length}::uuid`); }
    if (query.paymentMethodId) { params.push(query.paymentMethodId); filters.push(`p.method_id = $${params.length}::uuid`); }
    const from = `FROM payments p JOIN loans l ON l.id = p.loan_id JOIN collectors cl ON cl.id = p.collector_id
      WHERE ${filters.join(' AND ')}`;

    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const [summary]: CollectorPaymentsReportResult['summary'][] = await manager.query(`SELECT
        COUNT(*)::int AS "paymentsCount",
        COALESCE(SUM(p.amount), 0.00)::numeric(38,2)::text AS "totalReceived",
        COALESCE(SUM(p.principal_applied), 0.00)::numeric(38,2)::text AS "principalApplied",
        COALESCE(SUM(p.interest_applied), 0.00)::numeric(38,2)::text AS "interestApplied"
        ${from}`, params);
      const collectors: CollectorPaymentsReportResult['collectors'] = await manager.query(`WITH collector_totals AS (
        SELECT cl.id AS "collectorId", ${collectorName} AS "collectorName", cl.is_active AS "collectorActive",
          COUNT(*)::int AS "paymentsCount", COUNT(DISTINCT l.customer_id)::int AS "customersCount",
          COUNT(DISTINCT p.loan_id)::int AS "loansCount", SUM(p.amount) AS total_received,
          SUM(p.principal_applied) AS principal_applied, SUM(p.interest_applied) AS interest_applied
        ${from}
        GROUP BY cl.id, cl.first_name, cl.first_last_name, cl.second_last_name, cl.is_active
      ) SELECT "collectorId", "collectorName", "collectorActive", "paymentsCount", "customersCount", "loansCount",
        total_received::numeric(38,2)::text AS "totalReceived",
        principal_applied::numeric(38,2)::text AS "principalApplied",
        interest_applied::numeric(38,2)::text AS "interestApplied",
        ROUND(total_received / NULLIF("paymentsCount", 0), 2)::numeric(38,2)::text AS "averagePayment",
        CASE WHEN SUM(total_received) OVER () = 0 THEN 0.00
          ELSE ROUND(total_received * 100 / SUM(total_received) OVER (), 2) END::numeric(7,2)::text AS "participationPercentage"
      FROM collector_totals ORDER BY total_received DESC, lower("collectorName") ASC, "collectorId" ASC`, params);
      const paymentMethods: CollectorPaymentsReportResult['options']['paymentMethods'] = await manager.query(`
        SELECT pm.id, pm.name, pm.is_active AS active FROM payment_methods pm
        WHERE EXISTS (SELECT 1 FROM payments p WHERE p.method_id = pm.id)
        ORDER BY lower(pm.name), pm.id`);
      const collectorOptions: CollectorPaymentsReportResult['options']['collectors'] = await manager.query(`
        SELECT cl.id, ${collectorName} AS name, cl.is_active AS active FROM collectors cl
        WHERE EXISTS (SELECT 1 FROM payments p WHERE p.collector_id = cl.id)
        ORDER BY lower(${collectorName}), cl.id`);
      return { filters: query, summary, collectors, options: { collectors: collectorOptions, paymentMethods } };
    });
  }
}
