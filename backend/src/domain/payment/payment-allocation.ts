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

  const principalPending = ordered.reduce((sum, entry) => sum + cents(entry.principalPending), 0n);
  principalApplied = remainingAmount < principalPending ? remainingAmount : principalPending;
  interestApplied = remainingAmount - principalApplied;
  for (const entry of ordered) {
    if (remaining === 0n) break;
    const pendingBefore = cents(entry.principalPending) + cents(entry.interestPending);
    if (pendingBefore === 0n) continue;
    const amountApplied = remaining < pendingBefore ? remaining : pendingBefore;
    applications.push({
      planEntryId: entry.id,
      amountApplied: money(amountApplied),
      pendingBefore: money(pendingBefore),
      pendingAfter: money(pendingBefore - amountApplied),
      carriedForwardAmount: '0.00',
      carriedToPlanEntryId: null,
    });
    remaining -= amountApplied;
  }

  return { principalApplied: money(principalApplied), interestApplied: money(interestApplied), applications };
}
