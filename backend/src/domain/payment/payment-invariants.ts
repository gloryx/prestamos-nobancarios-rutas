import { paymentDateOnlyKey } from './payment-date-only';

export type PendingPlanEntry = {
  id: string;
  dueDate: string | Date;
  sequence: number;
  pendingAmount: string;
};

export type PlanBaseline = Readonly<{ financialBalance: string; entries: ReadonlyArray<Readonly<{ id: string; dueDate: string; pendingAmount: string }>> }>;

type PlanProposal = { dueDate: string; pendingAmount: string };

const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function cents(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function filterPositivePendingEntries<T extends { pendingAmount: string }>(entries: T[]): T[] {
  return entries.filter((entry) => cents(entry.pendingAmount) > 0n);
}

export function validatePlanCustomization(entries: PlanProposal[], loanStartDate: string, financialBalance: string): true {
  if (!entries.length || entries.some((entry) => typeof entry.dueDate !== 'string' || !DATE.test(entry.dueDate)
    || !Number.isFinite(new Date(`${entry.dueDate}T00:00:00Z`).getTime())
    || new Date(`${entry.dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== entry.dueDate
    || entry.dueDate < loanStartDate)) throw new Error('plan-date-before-loan');
  if (entries.some((entry) => typeof entry.pendingAmount !== 'string' || !MONEY.test(entry.pendingAmount) || cents(entry.pendingAmount) <= 0n)) throw new Error('plan-amount-invalid');
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
  validPayments: Array<{ id: string; paymentDate: string | Date; amount: string; status: 'VALID' }>;
  lastValidPayment: unknown;
  refinanceEligibility: boolean;
  preferredMethod: unknown;
}) {
  const combinedPlan = filterPositivePendingEntries(input.combinedPlan)
    .sort((left, right) => paymentDateOnlyKey(left.dueDate).localeCompare(paymentDateOnlyKey(right.dueDate)) || left.sequence - right.sequence || left.id.localeCompare(right.id));
  return {
    summary: input.summary,
    balances: input.balances,
    combinedPlan,
    validPayments: input.validPayments,
    firstOperationalRow: combinedPlan[0] ?? null,
    lastValidPayment: input.lastValidPayment,
    refinanceEligibility: input.refinanceEligibility,
    preferredMethod: input.preferredMethod,
  };
}
