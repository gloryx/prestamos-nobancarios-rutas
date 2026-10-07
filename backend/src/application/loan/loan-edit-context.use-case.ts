import { cents, evaluateLoanFinancialIntegrity, type LoanFinancialAmounts, type ValidPaymentTotals } from '../../domain/loan/loan-financial-integrity';
import type { LoanEditBaseline } from '../../domain/loan/loan-edit.types';
import { LoanEditInputError, normalizeLoanEditSnapshot, type LoanEditCurrentSnapshot } from './loan-edit.command';

export type LoanEditOption = Readonly<{ id: string; name: string; active: boolean }>;
export type LoanEditFrequencyOption = LoanEditOption & Readonly<{
  intervalUnit: 'DAY' | 'WEEK' | 'DAY/15' | 'MONTH'; intervalValue: number;
}>;
export type LoanEditContextLoan = LoanFinancialAmounts & Readonly<{
  id: string; loanNumber: string; status: string; startDate: string;
  customer: Readonly<{ id: string; identification: string; fullName: string }>;
  paymentFrequencyId: string; paymentFrequencyName: string;
  preferredPaymentMethodId: string; preferredPaymentMethodName: string; observations: string | null;
}>;
export type LoanEditContextSnapshot = Readonly<{
  loan: LoanEditContextLoan;
  plan: LoanEditCurrentSnapshot['plan'];
  totals: ValidPaymentTotals | undefined;
  paymentFrequencyOptions: readonly LoanEditFrequencyOption[];
  preferredPaymentMethodOptions: readonly LoanEditOption[];
  protectedPlanEntryIds: readonly string[];
}>;
export interface LoanEditContextReader { read(id: string): Promise<LoanEditContextSnapshot | undefined> }
export const LOAN_EDIT_CONTEXT_READER = Symbol('LOAN_EDIT_CONTEXT_READER');
export class LoanEditContextNotFoundError extends Error {}
export class LoanEditContextConflictError extends Error {}

const money = (amount: bigint): string => `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
const isMoney = (value: unknown): value is string => typeof value === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(value);
const corrupt = () => new LoanEditContextConflictError('The loan edit snapshot does not reconcile.');

export class GetLoanEditContextUseCase {
  constructor(private readonly reader: LoanEditContextReader) {}

  async execute(id: string): Promise<{ loan: LoanEditContextLoan; baseline: LoanEditBaseline;
    paymentFrequencyOptions: readonly LoanEditFrequencyOption[]; preferredPaymentMethodOptions: readonly LoanEditOption[];
    protectedPlanEntryIds: readonly string[] }> {
    const snapshot = await this.reader.read(id);
    if (!snapshot) throw new LoanEditContextNotFoundError('The loan does not exist.');
    const { loan, plan, totals, paymentFrequencyOptions, preferredPaymentMethodOptions, protectedPlanEntryIds } = snapshot;
    if (loan.status !== 'ACTIVE') throw new LoanEditContextConflictError('Only active loans can be edited.');
    if (!Array.isArray(plan) || !totals || ![loan.principal, loan.interestAmount, loan.totalAmount,
      totals.paidAmount, totals.paidPrincipal, totals.paidInterest].every(isMoney) ||
      !Number.isSafeInteger(totals.invalidCount) || totals.invalidCount < 0 ||
      plan.some((row) => !isMoney(row.pendingAmount) || cents(row.pendingAmount) < 0n) ||
      !paymentFrequencyOptions.some((option) => option.id === loan.paymentFrequencyId) ||
      !preferredPaymentMethodOptions.some((option) => option.id === loan.preferredPaymentMethodId)) throw corrupt();
    try {
      const normalized = normalizeLoanEditSnapshot({ interestAmount: loan.interestAmount,
        paymentFrequencyId: loan.paymentFrequencyId, preferredPaymentMethodId: loan.preferredPaymentMethodId,
        observations: loan.observations, financialBalance: '0', plan });
      const pending = normalized.plan.reduce((sum, row) => sum + row.pendingAmount, 0n);
      const integrity = evaluateLoanFinancialIntegrity(loan, totals, pending);
      if (!integrity.valid) throw corrupt();
      return {
        loan: { ...loan, principal: money(cents(loan.principal)), interestAmount: money(normalized.interestAmount),
          totalAmount: money(cents(loan.totalAmount)), startDate: loan.startDate, observations: normalized.observations },
        baseline: { interestAmount: money(normalized.interestAmount), paymentFrequencyId: normalized.paymentFrequencyId,
          preferredPaymentMethodId: normalized.preferredPaymentMethodId, observations: normalized.observations,
          financialBalance: money(integrity.financialBalance),
          plan: normalized.plan.map((row) => ({ id: row.id, dueDate: row.dueDate, pendingAmount: money(row.pendingAmount) })) },
        paymentFrequencyOptions, preferredPaymentMethodOptions, protectedPlanEntryIds,
      };
    } catch (error) {
      if (error instanceof LoanEditInputError || error instanceof RangeError || error instanceof SyntaxError) throw corrupt();
      throw error;
    }
  }
}
