import type { DataSource, EntityManager } from 'typeorm';
import type { CustomerFinancialAnalysisReader, CustomerFinancialAnalysisSnapshot } from '../../../../application/customer/customer-financial-analysis.use-case';
import type { EconomicLoanFact, EconomicPaymentFact, EconomicRefinancingFact } from '../../../../domain/cash-movement/economic-principal-provenance';
import { MAX_ECONOMIC_PROVENANCE_LOANS, MAX_ECONOMIC_PROVENANCE_PAYMENTS,
  MAX_ECONOMIC_PROVENANCE_REFINANCINGS } from '../../../../domain/cash-movement/economic-principal-provenance';
import { loanStatusAtCutoffCtes } from './loan-status-at-cutoff.sql';

export class CustomerFinancialAnalysisTypeOrmReader implements CustomerFinancialAnalysisReader {
  constructor(private readonly source: DataSource) {}

  read(customerId: string, asOf: string): Promise<CustomerFinancialAnalysisSnapshot> {
    return this.source.transaction('REPEATABLE READ', (manager) => this.readSnapshot(manager, customerId, asOf));
  }

  private async readSnapshot(manager: EntityManager, customerId: string, asOf: string): Promise<CustomerFinancialAnalysisSnapshot> {
    const [customer] = await manager.query(`SELECT id, identification,
      concat_ws(' ', first_name, middle_name, first_last_name, second_last_name) AS "fullName"
      FROM customers WHERE id = $1`, [customerId]);
    if (!customer) return { customer: null, facts: { loans: [], refinancings: [], payments: [] } };
    const loans: EconomicLoanFact[] = await manager.query(`WITH ${loanStatusAtCutoffCtes('$2')}
      SELECT l.id AS "loanId", l.loan_number::text AS "loanNumber", l.customer_id AS "customerId",
      concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) AS "customerName",
      l.start_date::text AS "startDate", l.principal::text AS principal, l.interest_amount::text AS "interestAmount",
      l.total_amount::text AS "totalAmount", snapshot.status,
      CASE WHEN snapshot.status = 'CANCELLED' THEN snapshot.effective_date::text END AS "cancelledDate",
      CASE WHEN snapshot.status = 'ANNULLED' THEN snapshot.effective_date::text END AS "annulledDate",
      d.id AS "disbursementId", d.amount::text AS "disbursementAmount",
      d.disbursement_date::text AS "disbursementDate", d.payment_method_id AS "disbursementMethodId",
      cash.id AS "cashId", cash.amount::text AS "cashAmount", cash.movement_date::text AS "cashDate",
      cash.payment_method_id AS "cashMethodId", cash.direction AS "cashDirection", cash.concept AS "cashConcept",
      reversal.id AS "reversalId", reversal.amount::text AS "reversalAmount", reversal.movement_date::text AS "reversalDate",
      reversal.payment_method_id AS "reversalMethodId", reversal.direction AS "reversalDirection",
      reversal.concept AS "reversalConcept"
      FROM loans l JOIN customers c ON c.id = l.customer_id
      LEFT JOIN status_at_cutoff snapshot ON snapshot.loan_id = l.id
      LEFT JOIN loan_disbursements d ON d.loan_id = l.id
      LEFT JOIN cash_movements cash ON cash.loan_disbursement_id = d.id
      LEFT JOIN cash_movements reversal ON reversal.reversed_movement_id = cash.id AND reversal.movement_date <= $2::date
      WHERE l.customer_id = $1 AND l.start_date <= $2::date
      ORDER BY l.start_date, l.created_at, l.id LIMIT $3`, [customerId, asOf, MAX_ECONOMIC_PROVENANCE_LOANS + 1]);
    const refinancings: EconomicRefinancingFact[] = await manager.query(`SELECT r.id AS "refinancingId",
      r.origin_loan_id AS "originLoanId", r.new_loan_id AS "newLoanId", r.refinancing_date::text AS "refinancingDate",
      r.created_at::text AS "createdAt", r.outstanding_principal_transferred::text AS "outstandingPrincipalTransferred",
      r.capitalized_outstanding_interest::text AS "capitalizedOutstandingInterest",
      r.new_money_disbursed::text AS "newMoneyDisbursed", r.new_contractual_principal::text AS "newContractualPrincipal"
      FROM loan_refinancings r JOIN loans origin ON origin.id = r.origin_loan_id
      WHERE origin.customer_id = $1 AND r.refinancing_date <= $2::date
      ORDER BY r.refinancing_date, r.created_at, r.id LIMIT $3`,
    [customerId, asOf, MAX_ECONOMIC_PROVENANCE_REFINANCINGS + 1]);
    const payments: EconomicPaymentFact[] = await manager.query(`SELECT p.id AS "paymentId", p.loan_id AS "loanId",
      p.payment_date::text AS date, p.created_at::text AS "createdAt", p.amount::text AS amount,
      p.principal_applied::text AS "principalApplied", p.interest_applied::text AS "interestApplied",
      CASE WHEN annulment.id IS NOT NULL THEN 'ANNULLED' ELSE 'VALID' END AS status,
      p.method_id AS "methodId", cash.id AS "cashId", cash.amount::text AS "cashAmount",
      cash.movement_date::text AS "cashDate", cash.payment_method_id AS "cashMethodId",
      cash.direction AS "cashDirection", cash.concept AS "cashConcept", annulment.id AS "annulmentId",
      reversal.id AS "reversalId", reversal.amount::text AS "reversalAmount",
      reversal.movement_date::text AS "reversalDate", reversal.created_at::text AS "reversalCreatedAt",
      reversal.payment_method_id AS "reversalMethodId", reversal.direction AS "reversalDirection",
      reversal.concept AS "reversalConcept"
      FROM payments p JOIN loans l ON l.id = p.loan_id
      LEFT JOIN cash_movements cash ON cash.payment_id = p.id AND cash.concept = 'CUSTOMER_PAYMENT'
      LEFT JOIN payment_annulments annulment ON annulment.payment_id = p.id
        AND (annulment.annulment_type = 'DATA_CORRECTION' OR
          (annulment.annulment_type = 'CASH_REFUND'
            AND (annulment.annulled_at AT TIME ZONE 'America/Costa_Rica')::date <= $2::date))
      LEFT JOIN cash_movements reversal ON reversal.reversed_movement_id = cash.id AND reversal.movement_date <= $2::date
      WHERE l.customer_id = $1 AND p.payment_date <= $2::date
        AND annulment.annulment_type IS DISTINCT FROM 'DATA_CORRECTION'
      ORDER BY p.loan_id, p.payment_date, p.created_at, p.id LIMIT $3`,
    [customerId, asOf, MAX_ECONOMIC_PROVENANCE_PAYMENTS + 1]);
    return { customer, facts: { loans, refinancings, payments } };
  }
}
