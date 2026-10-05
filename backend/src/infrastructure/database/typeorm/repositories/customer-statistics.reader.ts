import type { DataSource } from 'typeorm';
import type { CustomerStatisticsReader } from '../../../../application/customer/customer-statistics.use-case';
import type { CustomerCountRankingItem, CustomerMonetaryRankingItem, CustomerStatisticsFacts } from '../../../../domain/customer/customer-statistics';

type StatisticsRow = Record<string, unknown>;

const rankingSql = (field: string, alias: string, monetary = true): string => `(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'customerId', id, 'fullName', "fullName", 'value', ${monetary ? `${field}::text` : field}) ORDER BY ${field} DESC, "fullName", id), '[]'::jsonb)
  FROM (SELECT id, "fullName", ${field} FROM customer_facts WHERE ${field} > 0
    ORDER BY ${field} DESC, "fullName", id LIMIT $3) ranked) AS "${alias}"`;

export const CUSTOMER_STATISTICS_SQL = `WITH valid_payments_by_loan AS (
  SELECT loan_id,
    COALESCE(SUM(amount), 0)::numeric(38,2) AS "paidAmount",
    COALESCE(SUM(principal_applied), 0)::numeric(38,2) AS "paidPrincipal",
    COALESCE(SUM(interest_applied), 0)::numeric(38,2) AS "paidInterest"
  FROM payments WHERE status = 'VALID' GROUP BY loan_id
), loan_facts AS (
  SELECT l.customer_id,
    BOOL_OR(l.status = 'ACTIVE') AS "hasActiveDebt",
    BOOL_OR(l.status = 'UNCOLLECTIBLE') AS "hasUncollectibleDebt",
    BOOL_OR(l.status = 'CANCELLED') AS "hasCancelledLoans",
    BOOL_OR(l.status = 'ANNULLED') AS "hasAnnulledLoans",
    COUNT(*) FILTER (WHERE l.status <> 'ANNULLED')::int AS "validLoanCount",
    COALESCE(SUM(payment."paidInterest"), 0)::numeric(38,2) AS "realizedGain",
    COALESCE(SUM(payment."paidPrincipal"), 0)::numeric(38,2) AS "recoveredPrincipal",
    COALESCE(SUM(l.total_amount - COALESCE(payment."paidAmount", 0)) FILTER (WHERE l.status = 'ACTIVE'), 0)::numeric(38,2) AS "currentBalance"
  FROM loans l LEFT JOIN valid_payments_by_loan payment ON payment.loan_id = l.id GROUP BY l.customer_id
), disbursement_facts AS (
  SELECT l.customer_id, COALESCE(SUM(disbursement.amount), 0)::numeric(38,2) AS "capitalDisbursed"
  FROM loan_disbursements disbursement JOIN loans l ON l.id = disbursement.loan_id
  WHERE l.status <> 'ANNULLED' GROUP BY l.customer_id
), refinancing_customers AS (
  SELECT DISTINCT origin.customer_id
  FROM loan_refinancings refinancing
  JOIN loans origin ON origin.id = refinancing.origin_loan_id
), customer_facts AS (
  SELECT customer.id,
    CONCAT_WS(' ', customer.first_name, customer.middle_name, customer.first_last_name, customer.second_last_name) AS "fullName",
    EXTRACT(YEAR FROM customer.created_at AT TIME ZONE 'America/Costa_Rica')::int AS "createdYear",
    EXTRACT(MONTH FROM customer.created_at AT TIME ZONE 'America/Costa_Rica')::int AS "createdMonth",
    COALESCE(loans."hasActiveDebt", false) AS "hasActiveDebt",
    COALESCE(loans."hasUncollectibleDebt", false) AS "hasUncollectibleDebt",
    COALESCE(loans."hasCancelledLoans", false) AS "hasCancelledLoans",
    COALESCE(loans."hasAnnulledLoans", false) AS "hasAnnulledLoans",
    COALESCE(loans."validLoanCount", 0) AS "validLoanCount",
    COALESCE(disbursements."capitalDisbursed", 0)::numeric(38,2) AS "capitalDisbursed",
    COALESCE(loans."realizedGain", 0)::numeric(38,2) AS "realizedGain",
    COALESCE(loans."recoveredPrincipal", 0)::numeric(38,2) AS "recoveredPrincipal",
    COALESCE(loans."currentBalance", 0)::numeric(38,2) AS "currentBalance",
    refinanced.customer_id IS NOT NULL AS "hasRefinancingHistory"
  FROM customers customer
  LEFT JOIN loan_facts loans ON loans.customer_id = customer.id
  LEFT JOIN disbursement_facts disbursements ON disbursements.customer_id = customer.id
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
  ${Array.from({ length: 12 }, (_, index) => `COUNT(*) FILTER (WHERE "createdYear" = $1 AND "createdMonth" = ${index + 1})::int AS "month${index + 1}"`).join(',\n  ')},
  ${rankingSql('"capitalDisbursed"', 'capitalDisbursed')},
  ${rankingSql('"validLoanCount"', 'loansPlaced', false)},
  ${rankingSql('"realizedGain"', 'realizedGain')},
  ${rankingSql('"recoveredPrincipal"', 'recoveredPrincipal')},
  ${rankingSql('"currentBalance"', 'currentBalance')}
FROM customer_facts`;

const count = (row: StatisticsRow, field: string): number => Number(row[field] ?? 0);
const monetaryRanking = (row: StatisticsRow, field: string): CustomerMonetaryRankingItem[] => Array.isArray(row[field])
  ? (row[field] as Array<Record<string, unknown>>).map((item) => ({ customerId: String(item.customerId), fullName: String(item.fullName), value: String(item.value) })) : [];
const countRanking = (row: StatisticsRow, field: string): CustomerCountRankingItem[] => Array.isArray(row[field])
  ? (row[field] as Array<Record<string, unknown>>).map((item) => ({ customerId: String(item.customerId), fullName: String(item.fullName), value: Number(item.value) })) : [];

export class CustomerStatisticsTypeOrmReader implements CustomerStatisticsReader {
  constructor(private readonly source: DataSource) {}

  async read(year: number, currentMonth: number, limit: number): Promise<CustomerStatisticsFacts> {
    const [row = {} as StatisticsRow] = await this.source.query(CUSTOMER_STATISTICS_SQL, [year, currentMonth, limit]) as StatisticsRow[];
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
      topCustomers: {
        capitalDisbursed: monetaryRanking(row, 'capitalDisbursed'),
        loansPlaced: countRanking(row, 'loansPlaced'),
        realizedGain: monetaryRanking(row, 'realizedGain'),
        recoveredPrincipal: monetaryRanking(row, 'recoveredPrincipal'),
        currentBalance: monetaryRanking(row, 'currentBalance'),
      },
    };
  }
}
