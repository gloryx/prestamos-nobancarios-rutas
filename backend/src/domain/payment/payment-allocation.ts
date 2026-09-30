import { paymentDateOnlyKey } from './payment-date-only';

export type PaymentAllocationEntry = {
  id: string;
  dueDate: string | Date;
  sequence: number;
  principalPending: string;
  interestPending: string;
};

export type PaymentApplicationResult = {
  planEntryId: string;
  amountApplied: string;
  pendingBefore: string;
  pendingAfter: string;
  carriedForwardAmount: string;
  carriedToPlanEntryId: string | null;
};

export type PaymentAllocationResult = {
  principalApplied: string;
  interestApplied: string;
  applications: PaymentApplicationResult[];
};

const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;

function cents(value: string): bigint {
  if (!MONEY.test(value)) throw new Error('invalid-money');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function money(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

export function allocatePayment(amount: string, entries: PaymentAllocationEntry[]): PaymentAllocationResult {
  const remainingAmount = cents(amount);
  if (remainingAmount <= 0n) throw new Error('amount-must-be-positive');

  const ordered = [...entries].sort((a, b) => paymentDateOnlyKey(a.dueDate).localeCompare(paymentDateOnlyKey(b.dueDate)) || a.sequence - b.sequence || a.id.localeCompare(b.id));
  const totalPending = ordered.reduce((sum, entry) => sum + cents(entry.principalPending) + cents(entry.interestPending), 0n);
  if (remainingAmount > totalPending) throw new Error('over-limit');

  let remaining = remainingAmount;
  let principalApplied = 0n;
  let interestApplied = 0n;
  const applications: PaymentApplicationResult[] = [];

  const firstPositive = ordered.find((entry) => cents(entry.principalPending) + cents(entry.interestPending) > 0n);
  if (firstPositive && remainingAmount >= cents(firstPositive.principalPending) + cents(firstPositive.interestPending)) {
    const principalPending = ordered.reduce((sum, entry) => sum + cents(entry.principalPending), 0n);
    principalApplied = remainingAmount < principalPending ? remainingAmount : principalPending;
    interestApplied = remainingAmount - principalApplied;
    for (const entry of ordered) {
      if (remaining === 0n) break;
      const pendingBefore = cents(entry.principalPending) + cents(entry.interestPending);
      if (pendingBefore === 0n) continue;
      const amountApplied = remaining < pendingBefore ? remaining : pendingBefore;
      applications.push({
        planEntryId: entry.id, amountApplied: money(amountApplied), pendingBefore: money(pendingBefore),
        pendingAfter: money(pendingBefore - amountApplied), carriedForwardAmount: '0.00', carriedToPlanEntryId: null,
      });
      remaining -= amountApplied;
    }
    return { principalApplied: money(principalApplied), interestApplied: money(interestApplied), applications };
  }

  if (firstPositive) {
    const next = ordered.slice(ordered.indexOf(firstPositive) + 1).find((entry) => cents(entry.principalPending) + cents(entry.interestPending) > 0n);
    if (next) {
      const firstPending = cents(firstPositive.principalPending) + cents(firstPositive.interestPending);
      const nextPending = cents(next.principalPending) + cents(next.interestPending);
      const carry = firstPending - remainingAmount;
      const principalPending = ordered.reduce((sum, entry) => sum + cents(entry.principalPending), 0n);
      principalApplied = remainingAmount < principalPending ? remainingAmount : principalPending;
      interestApplied = remainingAmount - principalApplied;
      return { principalApplied: money(principalApplied), interestApplied: money(interestApplied), applications: [
        { planEntryId: firstPositive.id, amountApplied: money(remainingAmount), pendingBefore: money(firstPending), pendingAfter: '0.00', carriedForwardAmount: money(carry), carriedToPlanEntryId: next.id },
        { planEntryId: next.id, amountApplied: '0.00', pendingBefore: money(nextPending), pendingAfter: money(nextPending + carry), carriedForwardAmount: '0.00', carriedToPlanEntryId: null },
      ] };
    }
  }

  const appliedPrincipal = new Map<string, bigint>();
  const appliedInterest = new Map<string, bigint>();
  for (const entry of ordered) {
    if (remaining === 0n) break;
    const available = cents(entry.principalPending);
    const applied = available < remaining ? available : remaining;
    appliedPrincipal.set(entry.id, applied);
    principalApplied += applied;
    remaining -= applied;
  }
  for (const entry of ordered) {
    if (remaining === 0n) break;
    const available = cents(entry.interestPending);
    const applied = available < remaining ? available : remaining;
    appliedInterest.set(entry.id, applied);
    interestApplied += applied;
    remaining -= applied;
  }
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index];
    const principal = cents(entry.principalPending);
    const interest = cents(entry.interestPending);
    const pendingBefore = principal + interest;
    const appliedToPrincipal = appliedPrincipal.get(entry.id) ?? 0n;
    const appliedToInterest = appliedInterest.get(entry.id) ?? 0n;
    const amountApplied = appliedToPrincipal + appliedToInterest;
    const pendingAfter = pendingBefore - amountApplied;
    const carriedForward = pendingAfter === 0n ? remaining : 0n;
    applications.push({
      planEntryId: entry.id,
      amountApplied: money(amountApplied),
      pendingBefore: money(pendingBefore),
      pendingAfter: money(pendingAfter),
      carriedForwardAmount: money(carriedForward),
      carriedToPlanEntryId: carriedForward > 0n ? ordered[index + 1]?.id ?? null : null,
    });
  }

  return { principalApplied: money(principalApplied), interestApplied: money(interestApplied), applications };
}
