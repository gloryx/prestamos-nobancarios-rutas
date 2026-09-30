import type { LoanFinancialAmounts, ValidPaymentTotals, evaluateLoanFinancialIntegrity } from '../../domain/loan/loan-financial-integrity';

export interface LoanFinancialBatchQuery { query(sql: string, parameters: unknown[]): Promise<unknown[]> }

export type LoanFinancialBatchProjection = {
  loanId: string;
  financialSnapshot: LoanFinancialAmounts & { validTotals: ValidPaymentTotals; pendingPlanAmount: string };
  integrityResult: ReturnType<typeof evaluateLoanFinancialIntegrity>;
};

export interface LoanFinancialBatchReader {
  readLoanFinancialIntegrityBatch(executor: LoanFinancialBatchQuery, loanIds: readonly string[]): Promise<Map<string, LoanFinancialBatchProjection>>;
}
