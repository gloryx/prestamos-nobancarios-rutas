export type PendingPlanEntry = {
  id: string;
  dueDate: string;
  sequence: number;
  pendingAmount: string;
};

type PlanProposal = { dueDate: string; pendingAmount: string };

const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;

function cents(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function filterPositivePendingEntries<T extends { pendingAmount: string }>(entries: T[]): T[] {
  return entries.filter((entry) => cents(entry.pendingAmount) > 0n);
}

export function validatePlanCustomization(entries: PlanProposal[], loanStartDate: string, financialBalance: string): true {
  if (!entries.length || entries.some((entry) => entry.dueDate < loanStartDate)) throw new Error('plan-date-before-loan');
  if (entries.some((entry) => !MONEY.test(entry.pendingAmount) || cents(entry.pendingAmount) <= 0n)) throw new Error('plan-amount-invalid');
  if (entries.reduce((sum, entry) => sum + cents(entry.pendingAmount), 0n) !== cents(financialBalance)) throw new Error('plan-total-mismatch');
  return true;
}

export function reactivatedStatusAfterAnnulment(status: string, restoredBalance: string): 'ACTIVE' | 'CANCELLED' {
  return status === 'CANCELLED' && cents(restoredBalance) > 0n ? 'ACTIVE' : status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE';
}

export function buildPaymentContext(input: {
  summary: unknown;
  balances: unknown;
  combinedPlan: PendingPlanEntry[];
  lastValidPayment: unknown;
  refinanceEligibility: boolean;
  preferredMethod: unknown;
}) {
  const combinedPlan = filterPositivePendingEntries(input.combinedPlan)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.sequence - right.sequence || left.id.localeCompare(right.id));
  return {
    summary: input.summary,
    balances: input.balances,
    combinedPlan,
    firstOperationalRow: combinedPlan[0] ?? null,
    lastValidPayment: input.lastValidPayment,
    refinanceEligibility: input.refinanceEligibility,
    preferredMethod: input.preferredMethod,
  };
}
