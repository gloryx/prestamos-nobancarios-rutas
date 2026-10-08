import type { DataSource, EntityManager } from 'typeorm';
import type { EconomicCapitalReader } from '../../../../application/cash-movement/economic-capital.use-case';
import type { EconomicProfitabilityReader, EconomicProfitabilitySnapshot } from '../../../../application/cash-movement/monthly-profitability.use-case';
import type { EconomicCapitalEvent, EconomicCapitalFacts } from '../../../../domain/cash-movement/economic-capital';
import { analyzeEconomicPrincipalProvenance, type EconomicLoanFact, type EconomicPaymentFact,
  type EconomicProvenanceFacts, type EconomicRefinancingFact, MAX_ECONOMIC_PROVENANCE_LOANS, MAX_ECONOMIC_PROVENANCE_PAYMENTS,
  MAX_ECONOMIC_PROVENANCE_REFINANCINGS } from '../../../../domain/cash-movement/economic-principal-provenance';
import { loanStatusAtCutoffCtes } from './loan-status-at-cutoff.sql';

function groupEvents(events: EconomicCapitalEvent[]): EconomicCapitalEvent[] {
  const grouped = new Map<string, { disbursed: bigint; recovered: bigint; adjustments: bigint }>();
  const cents = (value: string) => {
    const negative = value.startsWith('-');
    const [whole, decimal = ''] = (negative ? value.slice(1) : value).split('.');
    const result = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
    return negative ? -result : result;
  };
  const money = (value: bigint) => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100n}.${((value < 0n ? -value : value) % 100n).toString().padStart(2, '0')}`;
  for (const event of events) {
    const row = grouped.get(event.date) ?? { disbursed: 0n, recovered: 0n, adjustments: 0n };
    row.disbursed += cents(event.realDisbursements);
    row.recovered += cents(event.capitalRecovered);
    row.adjustments += cents(event.adjustments);
    grouped.set(event.date, row);
  }
  return [...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([date, row]) => ({ date,
    realDisbursements: money(row.disbursed), capitalRecovered: money(row.recovered), adjustments: money(row.adjustments) }));
}

export class EconomicCapitalTypeOrmReader implements EconomicCapitalReader, EconomicProfitabilityReader {
  constructor(private readonly source: DataSource) {}

  async readThrough(toDate: string): Promise<EconomicCapitalFacts> {
    return (await this.readProfitabilityThrough(toDate)).capitalFacts;
  }

  async readProfitabilityThrough(toDate: string): Promise<EconomicProfitabilitySnapshot> {
    return this.source.transaction('REPEATABLE READ', async (manager) => this.readSnapshot(manager, toDate));
  }

  async readSnapshot(manager: EntityManager, toDate: string): Promise<EconomicProfitabilitySnapshot> {
    return this.readDetailedSnapshot(manager, toDate);
  }

  async readDetailedSnapshot(manager: EntityManager, toDate: string): Promise<EconomicProfitabilitySnapshot & { economicFacts: EconomicProvenanceFacts }> {
    const [opening] = await manager.query(`SELECT opening_date::text AS date,
      initial_portfolio::numeric(38,2)::text AS "initialPortfolio"
      FROM financial_openings WHERE singleton_key = 'DEFAULT'`);
    if (!opening) return { capitalFacts: { opening: null, events: [], warnings: [] },
      provenance: { chains: [], events: [], gainEvents: [], warnings: [] }, loans: [], economicFacts: { loans: [], refinancings: [], payments: [] } };
    const loans: EconomicLoanFact[] = await manager.query(`WITH ${loanStatusAtCutoffCtes('$1')}
      SELECT l.id AS "loanId", l.loan_number::text AS "loanNumber",
      l.customer_id AS "customerId", concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) AS "customerName",
      l.start_date::text AS "startDate", l.principal::text AS principal, l.interest_amount::text AS "interestAmount",
       l.total_amount::text AS "totalAmount", snapshot.status,
      CASE WHEN snapshot.status = 'CANCELLED' THEN snapshot.effective_date::text END AS "cancelledDate",
      CASE WHEN snapshot.status = 'ANNULLED' THEN snapshot.effective_date::text END AS "annulledDate",
      d.id AS "disbursementId", d.amount::text AS "disbursementAmount", d.disbursement_date::text AS "disbursementDate",
      d.payment_method_id AS "disbursementMethodId", cash.id AS "cashId", cash.amount::text AS "cashAmount",
      cash.movement_date::text AS "cashDate", cash.payment_method_id AS "cashMethodId",
      cash.direction AS "cashDirection", cash.concept AS "cashConcept", reversal.id AS "reversalId",
      reversal.amount::text AS "reversalAmount", reversal.movement_date::text AS "reversalDate",
      reversal.payment_method_id AS "reversalMethodId", reversal.direction AS "reversalDirection",
      reversal.concept AS "reversalConcept"
      FROM loans l JOIN customers c ON c.id = l.customer_id
      LEFT JOIN status_at_cutoff snapshot ON snapshot.loan_id = l.id
      LEFT JOIN loan_disbursements d ON d.loan_id = l.id
      LEFT JOIN cash_movements cash ON cash.loan_disbursement_id = d.id
       LEFT JOIN cash_movements reversal ON reversal.reversed_movement_id = cash.id AND reversal.movement_date <= $1::date
      WHERE l.start_date <= $1::date ORDER BY l.start_date, l.created_at, l.id LIMIT $2`, [toDate, MAX_ECONOMIC_PROVENANCE_LOANS + 1]);
    const refinancings: EconomicRefinancingFact[] = await manager.query(`SELECT id AS "refinancingId",
      origin_loan_id AS "originLoanId", new_loan_id AS "newLoanId", refinancing_date::text AS "refinancingDate",
      created_at::text AS "createdAt",
      outstanding_principal_transferred::text AS "outstandingPrincipalTransferred",
      capitalized_outstanding_interest::text AS "capitalizedOutstandingInterest",
      new_money_disbursed::text AS "newMoneyDisbursed", new_contractual_principal::text AS "newContractualPrincipal"
      FROM loan_refinancings WHERE refinancing_date <= $1::date ORDER BY refinancing_date, created_at, id LIMIT $2`,
    [toDate, MAX_ECONOMIC_PROVENANCE_REFINANCINGS + 1]);
    const payments: EconomicPaymentFact[] = await manager.query(`SELECT p.id AS "paymentId", p.loan_id AS "loanId",
      p.payment_date::text AS date, p.created_at::text AS "createdAt", p.amount::text AS amount,
      p.principal_applied::text AS "principalApplied", p.interest_applied::text AS "interestApplied",
       CASE WHEN annulment.id IS NULL THEN 'VALID' ELSE 'ANNULLED' END AS status,
       p.method_id AS "methodId", cash.id AS "cashId", cash.amount::text AS "cashAmount",
      cash.movement_date::text AS "cashDate", cash.payment_method_id AS "cashMethodId",
      cash.direction AS "cashDirection", cash.concept AS "cashConcept", annulment.id AS "annulmentId",
      reversal.id AS "reversalId", reversal.amount::text AS "reversalAmount",
      reversal.movement_date::text AS "reversalDate", reversal.created_at::text AS "reversalCreatedAt",
      reversal.payment_method_id AS "reversalMethodId", reversal.direction AS "reversalDirection",
      reversal.concept AS "reversalConcept"
      FROM payments p LEFT JOIN cash_movements cash ON cash.payment_id = p.id AND cash.concept = 'CUSTOMER_PAYMENT'
       LEFT JOIN payment_annulments annulment ON annulment.payment_id = p.id
         AND (annulment.annulment_type = 'DATA_CORRECTION' OR
           (annulment.annulment_type = 'CASH_REFUND'
             AND (annulment.annulled_at AT TIME ZONE 'America/Costa_Rica')::date <= $1::date))
       LEFT JOIN cash_movements reversal ON reversal.reversed_movement_id = cash.id AND reversal.movement_date <= $1::date
      WHERE p.payment_date <= $1::date
        AND annulment.annulment_type IS DISTINCT FROM 'DATA_CORRECTION'
      ORDER BY p.loan_id, p.payment_date, p.created_at, p.id LIMIT $2`,
    [toDate, MAX_ECONOMIC_PROVENANCE_PAYMENTS + 1]);
    const analysis = analyzeEconomicPrincipalProvenance({ loans, refinancings, payments }, toDate);
    return { capitalFacts: { opening, events: groupEvents(analysis.events), warnings: analysis.warnings },
      provenance: analysis, loans, economicFacts: { loans, refinancings, payments } };
  }
}
