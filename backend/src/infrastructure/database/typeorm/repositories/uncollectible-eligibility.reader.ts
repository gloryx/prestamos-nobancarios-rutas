import type { LoanFinancialTotalsQuery } from '../../../../application/loan/loan-financial-totals.reader';
import type { EligibilityLoan, FirstOperationalRow, UncollectibleEligibilityReader } from '../../../../application/loan/uncollectible-eligibility.use-case';

export class UncollectibleEligibilityTypeormReader implements UncollectibleEligibilityReader {
  async readLoan(executor: LoanFinancialTotalsQuery, loanId: string): Promise<EligibilityLoan | undefined> {
    const rows: unknown[] = await executor.query(`SELECT id, status, principal::text AS principal, interest_amount::text AS "interestAmount", total_amount::text AS "totalAmount" FROM loans WHERE id = $1`, [loanId]);
    return rows[0] as EligibilityLoan | undefined;
  }

  async readPendingPlanAmount(executor: LoanFinancialTotalsQuery, loanId: string): Promise<string | undefined> {
    const rows: unknown[] = await executor.query(`SELECT COALESCE(SUM(pending_amount), 0)::text AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0`, [loanId]);
    return (rows[0] as { pendingAmount?: string } | undefined)?.pendingAmount;
  }

  async readFirstOperationalRow(executor: LoanFinancialTotalsQuery, loanId: string): Promise<FirstOperationalRow | undefined> {
    const rows: unknown[] = await executor.query(`SELECT id, due_date::text AS "dueDate", pending_amount::text AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0 ORDER BY due_date ASC, sequence ASC, id ASC LIMIT 1`, [loanId]);
    return rows[0] as FirstOperationalRow | undefined;
  }
}
