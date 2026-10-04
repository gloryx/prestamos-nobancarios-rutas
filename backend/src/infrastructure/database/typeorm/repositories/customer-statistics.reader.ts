import type { DataSource } from 'typeorm';
import type { CustomerStatisticsReader } from '../../../../application/customer/customer-statistics.use-case';
import type { CustomerStatisticsFacts } from '../../../../domain/customer/customer-statistics';

type StatisticsRow = Record<string, number | string>;

export const CUSTOMER_STATISTICS_SQL = `WITH loan_facts AS (
  SELECT l.customer_id,
    BOOL_OR(l.status = 'ACTIVE') AS "hasActiveDebt",
    BOOL_OR(l.status = 'UNCOLLECTIBLE') AS "hasUncollectibleDebt",
    BOOL_OR(l.status = 'CANCELLED') AS "hasCancelledLoans",
    BOOL_OR(l.status = 'ANNULLED') AS "hasAnnulledLoans",
    COUNT(*) FILTER (WHERE l.status <> 'ANNULLED')::int AS "validLoanCount"
  FROM loans l GROUP BY l.customer_id
), refinancing_customers AS (
  SELECT DISTINCT origin.customer_id
  FROM loan_refinancings refinancing
  JOIN loans origin ON origin.id = refinancing.origin_loan_id
), customer_facts AS (
  SELECT customer.id,
    EXTRACT(YEAR FROM customer.created_at AT TIME ZONE 'America/Costa_Rica')::int AS "createdYear",
    EXTRACT(MONTH FROM customer.created_at AT TIME ZONE 'America/Costa_Rica')::int AS "createdMonth",
    COALESCE(loans."hasActiveDebt", false) AS "hasActiveDebt",
    COALESCE(loans."hasUncollectibleDebt", false) AS "hasUncollectibleDebt",
    COALESCE(loans."hasCancelledLoans", false) AS "hasCancelledLoans",
    COALESCE(loans."hasAnnulledLoans", false) AS "hasAnnulledLoans",
    COALESCE(loans."validLoanCount", 0) AS "validLoanCount",
    refinanced.customer_id IS NOT NULL AS "hasRefinancingHistory"
  FROM customers customer
  LEFT JOIN loan_facts loans ON loans.customer_id = customer.id
  LEFT JOIN refinancing_customers refinanced ON refinanced.customer_id = customer.id
)
SELECT
  COUNT(*)::int AS "totalCustomers",
  COUNT(*) FILTER (WHERE "hasActiveDebt")::int AS "customersWithActiveDebt",
  COUNT(*) FILTER (WHERE "hasUncollectibleDebt")::int AS "customersWithUncollectibleDebt",
  COUNT(*) FILTER (WHERE "hasRefinancingHistory")::int AS "customersWithRefinancingHistory",
  COUNT(*) FILTER (WHERE "hasCancelledLoans")::int AS "customersWithCancelledLoans",
  COUNT(*) FILTER (WHERE "hasAnnulledLoans")::int AS "customersWithAnnulledLoans",
  COUNT(*) FILTER (WHERE "validLoanCount" > 1)::int AS "customersWithMultipleLoans",
  COALESCE(SUM("validLoanCount"), 0)::int AS "validLoanCount",
  COUNT(*) FILTER (WHERE "createdYear" = $1)::int AS "newCustomersInYear",
  COUNT(*) FILTER (WHERE "createdYear" = $1 AND "createdMonth" = $2)::int AS "newCustomersCurrentMonth",
  COUNT(*) FILTER (WHERE "hasActiveDebt")::int AS "activeDebt",
  COUNT(*) FILTER (WHERE NOT "hasActiveDebt" AND "hasUncollectibleDebt")::int AS "uncollectibleOnly",
  COUNT(*) FILTER (WHERE NOT "hasActiveDebt" AND NOT "hasUncollectibleDebt")::int AS "noCurrentDebt",
  ${Array.from({ length: 12 }, (_, index) => `COUNT(*) FILTER (WHERE "createdYear" = $1 AND "createdMonth" = ${index + 1})::int AS "month${index + 1}"`).join(',\n  ')}
FROM customer_facts`;

const count = (row: StatisticsRow, field: string): number => Number(row[field] ?? 0);

export class CustomerStatisticsTypeOrmReader implements CustomerStatisticsReader {
  constructor(private readonly source: DataSource) {}

  async read(year: number, currentMonth: number): Promise<CustomerStatisticsFacts> {
    const [row = {} as StatisticsRow] = await this.source.query(CUSTOMER_STATISTICS_SQL, [year, currentMonth]) as StatisticsRow[];
    return {
      totalCustomers: count(row, 'totalCustomers'),
      customersWithActiveDebt: count(row, 'customersWithActiveDebt'),
      customersWithUncollectibleDebt: count(row, 'customersWithUncollectibleDebt'),
      customersWithRefinancingHistory: count(row, 'customersWithRefinancingHistory'),
      customersWithCancelledLoans: count(row, 'customersWithCancelledLoans'),
      customersWithAnnulledLoans: count(row, 'customersWithAnnulledLoans'),
      customersWithMultipleLoans: count(row, 'customersWithMultipleLoans'),
      validLoanCount: count(row, 'validLoanCount'),
      newCustomersInYear: count(row, 'newCustomersInYear'),
      newCustomersCurrentMonth: count(row, 'newCustomersCurrentMonth'),
      currentSituation: {
        activeDebt: count(row, 'activeDebt'),
        uncollectibleOnly: count(row, 'uncollectibleOnly'),
        noCurrentDebt: count(row, 'noCurrentDebt'),
      },
      monthlyNewCustomers: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1, newCustomers: count(row, `month${index + 1}`),
      })),
    };
  }
}
