import { cents, evaluateLoanFinancialIntegrity, type LoanFinancialAmounts, type ValidPaymentTotals } from '../loan/loan-financial-integrity';

export type RefinancingPlanRow = { id: string; sequence: number; dueDate: string; pendingAmount: string };
export type RefinancingSnapshot = LoanFinancialAmounts & {
  id: string; loanNumber: string; customerId: string; customerName: string; identification: string;
  status: string; startDate: string; lastValidPaymentDate: string | null;
  totals: ValidPaymentTotals; plan: RefinancingPlanRow[];
};

export const money = (value: bigint): string => {
  const amount = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
};

export function evaluateRefinancing(snapshot: RefinancingSnapshot) {
  const pending = snapshot.plan.reduce((sum, row) => sum + cents(row.pendingAmount), 0n);
  const integrity = evaluateLoanFinancialIntegrity(snapshot, snapshot.totals, pending);
  const minimumRequiredPayment = cents(snapshot.interestAmount);
  const reasons: string[] = [];
  if (snapshot.status !== 'ACTIVE') reasons.push('LOAN_NOT_ACTIVE');
  if (!integrity.valid) reasons.push('FINANCIAL_INTEGRITY_ERROR');
  if (integrity.financialBalance <= 0n || integrity.outstandingPrincipal + integrity.outstandingInterest <= 0n) reasons.push('NO_OUTSTANDING_BALANCE');
  if (integrity.validPaidAmount < minimumRequiredPayment) reasons.push('MINIMUM_PAYMENT_NOT_MET');
  return { integrity, minimumRequiredPayment, reasons, eligible: reasons.length === 0 };
}

export function refinancingAmounts(outstandingPrincipal: bigint, outstandingInterest: bigint, newMoney: bigint, newInterest: bigint) {
  const principal = outstandingPrincipal + outstandingInterest + newMoney;
  return { outstandingPrincipalTransferred: money(outstandingPrincipal), capitalizedOutstandingInterest: money(outstandingInterest),
    newMoneyDisbursed: money(newMoney), newInterestAmount: money(newInterest), newContractualPrincipal: money(principal),
    newContractualTotal: money(principal + newInterest) };
}
