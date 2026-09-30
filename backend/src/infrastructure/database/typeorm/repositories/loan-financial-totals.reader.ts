import type { LoanFinancialTotalsQuery, LoanFinancialTotalsReader } from '../../../../application/loan/loan-financial-totals.reader';

export const VALID_PAYMENT_TOTALS_SELECT = `COALESCE(SUM(amount), 0)::text AS "paidAmount", COALESCE(SUM(principal_applied), 0)::text AS "paidPrincipal", COALESCE(SUM(interest_applied), 0)::text AS "paidInterest", COUNT(*) FILTER (WHERE amount <= 0 OR principal_applied < 0 OR interest_applied < 0 OR amount <> principal_applied + interest_applied)::int AS "invalidCount"`;

export class LoanFinancialTotalsTypeormReader implements LoanFinancialTotalsReader {
  async readValidTotals(executor: LoanFinancialTotalsQuery, loanId: string) {
    const rows = await executor.query(`SELECT ${VALID_PAYMENT_TOTALS_SELECT} FROM payments WHERE loan_id = $1 AND status = 'VALID'`, [loanId]);
    return rows[0];
  }
}
