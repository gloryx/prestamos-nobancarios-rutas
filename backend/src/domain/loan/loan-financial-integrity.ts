export type LoanFinancialAmounts = { principal: string; interestAmount: string; totalAmount: string };
export type ValidPaymentTotals = { paidAmount: string; paidPrincipal: string; paidInterest: string; invalidCount: number };

export const cents = (value: string): bigint => {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -amount : amount;
};

export function evaluateLoanFinancialIntegrity(loan: LoanFinancialAmounts, totals: ValidPaymentTotals, pendingPlanAmount: bigint) {
  const principal = cents(loan.principal); const interest = cents(loan.interestAmount); const total = cents(loan.totalAmount);
  const validPaidAmount = cents(totals.paidAmount); const validPrincipalApplied = cents(totals.paidPrincipal); const validInterestApplied = cents(totals.paidInterest);
  const outstandingPrincipal = principal - validPrincipalApplied; const outstandingInterest = interest - validInterestApplied; const financialBalance = total - validPaidAmount;
  const valid = !(principal <= 0n || interest < 0n || total !== principal + interest || totals.invalidCount !== 0
    || validPaidAmount < 0n || validPrincipalApplied < 0n || validInterestApplied < 0n || validPaidAmount !== validPrincipalApplied + validInterestApplied
    || outstandingPrincipal < 0n || outstandingInterest < 0n || financialBalance < 0n
    || financialBalance !== outstandingPrincipal + outstandingInterest || pendingPlanAmount < 0n || validPaidAmount + pendingPlanAmount !== total);
  return { valid, validPaidAmount, validPrincipalApplied, validInterestApplied, pendingPlanAmount, financialBalance, outstandingPrincipal, outstandingInterest };
}
