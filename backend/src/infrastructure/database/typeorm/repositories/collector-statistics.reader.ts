import type { DataSource } from 'typeorm';
import type { CollectorStatisticsReader } from '../../../../application/collector/collector-statistics.use-case';
import type {
  CollectorPaymentMethodStatistics,
  CollectorStatisticsEvolution,
  CollectorStatisticsFacts,
  CollectorStatisticsPeriod,
  CollectorStatisticsRow,
  UnattributedPaymentStatistics,
} from '../../../../domain/collector/collector-statistics';

type StatisticsRow = Record<string, unknown>;

export const COLLECTOR_STATISTICS_SQL = `WITH period_payments AS (
  SELECT p.id, p.collector_id, p.method_id, p.amount, p.principal_applied,
    p.interest_applied, p.payment_date, p.status
  FROM payments p
  WHERE p.payment_date >= $1::date AND p.payment_date <= $2::date
), attributed_payments AS (
  SELECT payment.*
  FROM period_payments payment
  JOIN collectors collector ON collector.id = payment.collector_id
), collector_activity AS (
  SELECT payment.collector_id,
    COUNT(*) FILTER (WHERE payment.status = 'VALID')::int AS "validPaymentsCount",
    COALESCE(SUM(payment.amount) FILTER (WHERE payment.status = 'VALID'), 0.00)::numeric(38,2) AS "totalCollectedAmount",
    COALESCE(SUM(payment.principal_applied) FILTER (WHERE payment.status = 'VALID'), 0.00)::numeric(38,2) AS "principalAppliedAmount",
    COALESCE(SUM(payment.interest_applied) FILTER (WHERE payment.status = 'VALID'), 0.00)::numeric(38,2) AS "interestAppliedAmount",
    COALESCE(AVG(payment.amount) FILTER (WHERE payment.status = 'VALID'), 0.00)::numeric(38,2) AS "averageValidPaymentAmount",
    COUNT(*) FILTER (WHERE payment.status = 'ANNULLED')::int AS "annulledPaymentsCount",
    COALESCE(SUM(payment.amount) FILTER (WHERE payment.status = 'ANNULLED'), 0.00)::numeric(38,2) AS "annulledAmount"
  FROM attributed_payments payment
  GROUP BY payment.collector_id
), current_assignments AS (
  SELECT collector.id AS "collectorId",
    COUNT(DISTINCT assignment.route_id) FILTER (WHERE route.is_active)::int AS "currentActiveRoutes",
    COUNT(DISTINCT customer_assignment.customer_id)
      FILTER (WHERE route.is_active AND customer.is_active)::int AS "currentAssignedActiveCustomers"
  FROM collectors collector
  LEFT JOIN collector_route_assignments assignment
    ON assignment.collector_user_id = collector.user_id AND assignment.ended_at IS NULL
  LEFT JOIN routes route ON route.id = assignment.route_id
  LEFT JOIN customer_route_assignments customer_assignment
    ON customer_assignment.route_id = assignment.route_id AND customer_assignment.ended_at IS NULL
  LEFT JOIN customers customer ON customer.id = customer_assignment.customer_id
  GROUP BY collector.id
), collector_rows AS (
  SELECT collector.id AS "collectorId", collector.identification,
    concat_ws(' ', collector.first_name, collector.first_last_name, collector.second_last_name) AS "fullName",
    collector.is_active AS "isActive", collector.user_id IS NOT NULL AS "userLinked",
    COALESCE(activity."validPaymentsCount", 0)::int AS "validPaymentsCount",
    COALESCE(activity."totalCollectedAmount", 0.00)::numeric(38,2) AS "totalCollectedAmount",
    COALESCE(activity."principalAppliedAmount", 0.00)::numeric(38,2) AS "principalAppliedAmount",
    COALESCE(activity."interestAppliedAmount", 0.00)::numeric(38,2) AS "interestAppliedAmount",
    COALESCE(activity."averageValidPaymentAmount", 0.00)::numeric(38,2) AS "averageValidPaymentAmount",
    COALESCE(activity."annulledPaymentsCount", 0)::int AS "annulledPaymentsCount",
    COALESCE(activity."annulledAmount", 0.00)::numeric(38,2) AS "annulledAmount",
    COALESCE(assignments."currentActiveRoutes", 0)::int AS "currentActiveRoutes",
    COALESCE(assignments."currentAssignedActiveCustomers", 0)::int AS "currentAssignedActiveCustomers"
  FROM collectors collector
  LEFT JOIN collector_activity activity ON activity.collector_id = collector.id
  LEFT JOIN current_assignments assignments ON assignments."collectorId" = collector.id
), method_rows AS (
  SELECT method.id AS "paymentMethodId", method.name, method.is_active AS "currentlyActive",
    COUNT(*)::int AS "validPaymentsCount",
    SUM(payment.amount)::numeric(38,2) AS "totalCollectedAmount"
  FROM attributed_payments payment
  JOIN payment_methods method ON method.id = payment.method_id
  WHERE payment.status = 'VALID'
  GROUP BY method.id, method.name, method.is_active
), buckets AS (
  SELECT generate_series($1::date, $2::date,
    CASE WHEN $3::text = 'MONTH' THEN interval '1 month' ELSE interval '1 day' END)::date AS bucket
), evolution_facts AS (
  SELECT CASE WHEN $3::text = 'MONTH'
      THEN date_trunc('month', payment.payment_date)::date ELSE payment.payment_date END AS bucket,
    COUNT(*) FILTER (WHERE payment.status = 'VALID')::int AS "validPaymentsCount",
    COALESCE(SUM(payment.amount) FILTER (WHERE payment.status = 'VALID'), 0.00)::numeric(38,2) AS "totalCollectedAmount",
    COUNT(*) FILTER (WHERE payment.status = 'ANNULLED')::int AS "annulledPaymentsCount",
    COALESCE(SUM(payment.amount) FILTER (WHERE payment.status = 'ANNULLED'), 0.00)::numeric(38,2) AS "annulledAmount"
  FROM attributed_payments payment
  GROUP BY 1
), evolution_rows AS (
  SELECT CASE WHEN $3::text = 'MONTH' THEN to_char(bucket.bucket, 'YYYY-MM')
      ELSE to_char(bucket.bucket, 'YYYY-MM-DD') END AS period,
    COALESCE(facts."validPaymentsCount", 0)::int AS "validPaymentsCount",
    COALESCE(facts."totalCollectedAmount", 0.00)::numeric(38,2) AS "totalCollectedAmount",
    COALESCE(facts."annulledPaymentsCount", 0)::int AS "annulledPaymentsCount",
    COALESCE(facts."annulledAmount", 0.00)::numeric(38,2) AS "annulledAmount",
    bucket.bucket
  FROM buckets bucket LEFT JOIN evolution_facts facts ON facts.bucket = bucket.bucket
), unattributed AS (
  SELECT COUNT(*) FILTER (WHERE payment.status = 'VALID')::int AS "validPaymentsCount",
    COALESCE(SUM(payment.amount) FILTER (WHERE payment.status = 'VALID'), 0.00)::numeric(38,2)::text AS "totalCollectedAmount",
    COUNT(*) FILTER (WHERE payment.status = 'ANNULLED')::int AS "annulledPaymentsCount",
    COALESCE(SUM(payment.amount) FILTER (WHERE payment.status = 'ANNULLED'), 0.00)::numeric(38,2)::text AS "annulledAmount"
  FROM period_payments payment
  WHERE NOT EXISTS (SELECT 1 FROM collectors collector WHERE collector.id = payment.collector_id)
)
SELECT COUNT(*)::int AS "totalCollectors",
  COUNT(*) FILTER (WHERE "isActive")::int AS "activeCollectors",
  COUNT(*) FILTER (WHERE NOT "isActive")::int AS "inactiveCollectors",
  COUNT(*) FILTER (WHERE "validPaymentsCount" > 0)::int AS "collectorsWithValidPayments",
  COUNT(*) FILTER (WHERE "validPaymentsCount" = 0)::int AS "collectorsWithoutValidPayments",
  COUNT(*) FILTER (WHERE "isActive" AND "validPaymentsCount" = 0)::int AS "activeCollectorsWithoutValidPayments",
  COUNT(*) FILTER (WHERE "userLinked")::int AS "linkedCollectors",
  COUNT(*) FILTER (WHERE NOT "userLinked")::int AS "unlinkedCollectors",
  COALESCE(SUM("validPaymentsCount"), 0)::int AS "validPaymentsCount",
  COALESCE(SUM("totalCollectedAmount"), 0.00)::numeric(38,2)::text AS "totalCollectedAmount",
  COALESCE(SUM("principalAppliedAmount"), 0.00)::numeric(38,2)::text AS "principalAppliedAmount",
  COALESCE(SUM("interestAppliedAmount"), 0.00)::numeric(38,2)::text AS "interestAppliedAmount",
  CASE WHEN SUM("validPaymentsCount") > 0
    THEN (SUM("totalCollectedAmount") / SUM("validPaymentsCount"))::numeric(38,2)::text
    ELSE '0.00' END AS "averageValidPaymentAmount",
  COALESCE(SUM("annulledPaymentsCount"), 0)::int AS "annulledPaymentsCount",
  COALESCE(SUM("annulledAmount"), 0.00)::numeric(38,2)::text AS "annulledAmount",
  COALESCE(jsonb_agg(jsonb_build_object(
    'collectorId', "collectorId", 'identification', identification, 'fullName', "fullName",
    'isActive', "isActive", 'userLinked', "userLinked", 'validPaymentsCount', "validPaymentsCount",
    'totalCollectedAmount', "totalCollectedAmount"::text,
    'principalAppliedAmount', "principalAppliedAmount"::text,
    'interestAppliedAmount', "interestAppliedAmount"::text,
    'averageValidPaymentAmount', "averageValidPaymentAmount"::text,
    'annulledPaymentsCount', "annulledPaymentsCount", 'annulledAmount', "annulledAmount"::text,
    'currentActiveRoutes', "currentActiveRoutes",
    'currentAssignedActiveCustomers', "currentAssignedActiveCustomers"
  ) ORDER BY "totalCollectedAmount" DESC, lower("fullName"), "collectorId")
    FILTER (WHERE "collectorId" IS NOT NULL), '[]'::jsonb) AS "byCollector",
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'paymentMethodId', "paymentMethodId", 'name', name, 'currentlyActive', "currentlyActive",
    'validPaymentsCount', "validPaymentsCount", 'totalCollectedAmount', "totalCollectedAmount"::text
  ) ORDER BY "totalCollectedAmount" DESC, lower(name), "paymentMethodId"), '[]'::jsonb) FROM method_rows) AS "paymentMethods",
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'period', period, 'validPaymentsCount', "validPaymentsCount",
    'totalCollectedAmount', "totalCollectedAmount"::text,
    'annulledPaymentsCount', "annulledPaymentsCount", 'annulledAmount', "annulledAmount"::text
  ) ORDER BY bucket), '[]'::jsonb) FROM evolution_rows) AS evolution,
  (SELECT to_jsonb(unattributed) FROM unattributed) AS "unattributedPayments"
FROM collector_rows`;

const number = (row: StatisticsRow, field: string): number => Number(row[field] ?? 0);
const text = (row: StatisticsRow, field: string): string => String(row[field] ?? '0.00');

export class CollectorStatisticsTypeOrmReader implements CollectorStatisticsReader {
  constructor(private readonly source: DataSource) {}

  async read(period: CollectorStatisticsPeriod): Promise<CollectorStatisticsFacts> {
    const [row = {} as StatisticsRow] = await this.source.query(COLLECTOR_STATISTICS_SQL,
      [period.startDate, period.endDate, period.granularity]) as StatisticsRow[];
    return {
      summary: {
        totalCollectors: number(row, 'totalCollectors'),
        activeCollectors: number(row, 'activeCollectors'),
        inactiveCollectors: number(row, 'inactiveCollectors'),
        collectorsWithValidPayments: number(row, 'collectorsWithValidPayments'),
        collectorsWithoutValidPayments: number(row, 'collectorsWithoutValidPayments'),
        activeCollectorsWithoutValidPayments: number(row, 'activeCollectorsWithoutValidPayments'),
        linkedCollectors: number(row, 'linkedCollectors'),
        unlinkedCollectors: number(row, 'unlinkedCollectors'),
        validPaymentsCount: number(row, 'validPaymentsCount'),
        totalCollectedAmount: text(row, 'totalCollectedAmount'),
        principalAppliedAmount: text(row, 'principalAppliedAmount'),
        interestAppliedAmount: text(row, 'interestAppliedAmount'),
        averageValidPaymentAmount: text(row, 'averageValidPaymentAmount'),
        annulledPaymentsCount: number(row, 'annulledPaymentsCount'),
        annulledAmount: text(row, 'annulledAmount'),
      },
      byCollector: (row.byCollector ?? []) as CollectorStatisticsRow[],
      paymentMethods: (row.paymentMethods ?? []) as CollectorPaymentMethodStatistics[],
      evolution: (row.evolution ?? []) as CollectorStatisticsEvolution[],
      unattributedPayments: (row.unattributedPayments ?? {
        validPaymentsCount: 0, totalCollectedAmount: '0.00', annulledPaymentsCount: 0, annulledAmount: '0.00',
      }) as UnattributedPaymentStatistics,
    };
  }
}
