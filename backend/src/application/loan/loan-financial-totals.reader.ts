import type { ValidPaymentTotals } from '../../domain/loan/loan-financial-integrity';

export interface LoanFinancialTotalsQuery { query(sql: string, parameters: unknown[]): Promise<ValidPaymentTotals[]> }
export interface LoanFinancialTotalsReader { readValidTotals(executor: LoanFinancialTotalsQuery, loanId: string): Promise<ValidPaymentTotals | undefined> }
export const LOAN_FINANCIAL_TOTALS_READER = Symbol('LOAN_FINANCIAL_TOTALS_READER');
