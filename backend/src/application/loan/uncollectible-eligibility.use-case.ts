import { evaluateLoanFinancialIntegrity, type LoanFinancialAmounts, type ValidPaymentTotals } from '../../domain/loan/loan-financial-integrity';
import type { LoanStatus } from '../../domain/loan/loan.types';
import type { LoanFinancialTotalsQuery, LoanFinancialTotalsReader } from './loan-financial-totals.reader';

export type EligibilityLoan = LoanFinancialAmounts & { id: string; status: LoanStatus };
export type FirstOperationalRow = { id: string; dueDate: string; pendingAmount: string };
export interface UncollectibleEligibilityReader {
  readLoan(executor: LoanFinancialTotalsQuery, loanId: string): Promise<EligibilityLoan | undefined>;
  readPendingPlanAmount(executor: LoanFinancialTotalsQuery, loanId: string): Promise<string | undefined>;
  readFirstOperationalRow(executor: LoanFinancialTotalsQuery, loanId: string): Promise<FirstOperationalRow | undefined>;
}
export const UNCOLLECTIBLE_ELIGIBILITY_READER = Symbol('UNCOLLECTIBLE_ELIGIBILITY_READER');

export type UncollectibleBlockingReason = 'LOAN_NOT_ACTIVE' | 'NO_OUTSTANDING_BALANCE' | 'NO_OPERATIONAL_OBLIGATION'
  | 'FINANCIAL_INTEGRITY_ERROR' | 'LOAN_NOT_OVERDUE' | null;
export type UncollectibleEligibility = {
  loanId: string;
  status: LoanStatus;
  financialBalance: bigint;
  pendingPlanAmount: bigint;
  firstOperationalRow: FirstOperationalRow | null;
  isOverdue: boolean;
  isFinanciallyValid: boolean;
  canMarkUncollectible: boolean;
  blockingReason: UncollectibleBlockingReason;
};

export class UncollectibleEligibilityReadError extends Error {}

async function read<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (cause) { throw new UncollectibleEligibilityReadError('Loan eligibility read failed.', { cause }); }
}

const isMoney = (value: unknown): value is string => typeof value === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(value);
const isTotals = (value: ValidPaymentTotals | undefined): value is ValidPaymentTotals => !!value &&
  isMoney(value.paidAmount) && isMoney(value.paidPrincipal) && isMoney(value.paidInterest) &&
  Number.isSafeInteger(value.invalidCount) && value.invalidCount >= 0;

function cents(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -amount : amount;
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function evaluateUncollectibleEligibilityFromSnapshot(loanId: string, status: LoanStatus,
  pendingPlanAmount: bigint, firstOperationalRow: FirstOperationalRow | null,
  integrity: ReturnType<typeof evaluateLoanFinancialIntegrity>, today: string): UncollectibleEligibility {
  const isOverdue = firstOperationalRow !== null && firstOperationalRow.dueDate < today;
  const blockingReason: UncollectibleBlockingReason = status !== 'ACTIVE' ? 'LOAN_NOT_ACTIVE'
    : integrity.financialBalance <= 0n ? 'NO_OUTSTANDING_BALANCE'
    : !firstOperationalRow ? 'NO_OPERATIONAL_OBLIGATION'
    : !integrity.valid ? 'FINANCIAL_INTEGRITY_ERROR'
    : !isOverdue ? 'LOAN_NOT_OVERDUE' : null;
  return { loanId, status, financialBalance: integrity.financialBalance, pendingPlanAmount,
    firstOperationalRow, isOverdue, isFinanciallyValid: integrity.valid,
    canMarkUncollectible: blockingReason === null, blockingReason };
}

export class EvaluateUncollectibleEligibilityUseCase {
  constructor(private readonly totalsReader: LoanFinancialTotalsReader, private readonly reader: UncollectibleEligibilityReader) {}

  async evaluate(executor: LoanFinancialTotalsQuery, loanId: string, today: string): Promise<UncollectibleEligibility> {
    if (!isDateOnly(today)) throw new UncollectibleEligibilityReadError('Invalid evaluation date.');
    const loan = await read(() => this.reader.readLoan(executor, loanId));
    if (!loan || typeof loan.id !== 'string' || !loan.id || typeof loanId !== 'string' || !loanId ||
      loan.id.toLowerCase() !== loanId.toLowerCase() || !['ACTIVE', 'CANCELLED', 'REFINANCED', 'UNCOLLECTIBLE', 'ANNULLED'].includes(loan.status) ||
      !isMoney(loan.principal) || !isMoney(loan.interestAmount) || !isMoney(loan.totalAmount)) {
      throw new UncollectibleEligibilityReadError('Loan financial data is unavailable.');
    }
    const totals = await read(() => this.totalsReader.readValidTotals(executor, loanId));
    if (!isTotals(totals)) throw new UncollectibleEligibilityReadError('Valid payment totals are unavailable.');
    const pending = await read(() => this.reader.readPendingPlanAmount(executor, loanId));
    if (!isMoney(pending)) throw new UncollectibleEligibilityReadError('Pending plan total is unavailable.');
    const first = await read(() => this.reader.readFirstOperationalRow(executor, loanId));
    if (first && (typeof first.id !== 'string' || !first.id || !isDateOnly(first.dueDate) ||
      !isMoney(first.pendingAmount) || cents(first.pendingAmount) <= 0n)) {
      throw new UncollectibleEligibilityReadError('First operational plan row is unavailable.');
    }

    const pendingPlanAmount = cents(pending);
    const integrity = evaluateLoanFinancialIntegrity(loan, totals, pendingPlanAmount);
    return evaluateUncollectibleEligibilityFromSnapshot(loan.id, loan.status, pendingPlanAmount, first ?? null, integrity, today);
  }
}
