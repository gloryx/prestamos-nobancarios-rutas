import { paymentDateOnlyKey } from './payment-date-only';

export type NumberedPlanEntry = {
  id: string;
  dueDate: string | Date;
  sequence: number;
  pendingAmount: string;
};

export type PlanPaymentEvidence = {
  planEntryId: string;
  amountApplied: string;
  pendingAfter?: string;
};

const cents = (value: string | undefined): bigint | null => {
  if (value === undefined) return null;
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};

export function numberCurrentPaymentPlan<T extends NumberedPlanEntry>(
  entries: readonly T[], applications: readonly PlanPaymentEvidence[],
): T[] {
  const paidEntryIds = new Set(applications.filter((application) => {
    const applied = cents(application.amountApplied);
    const pendingAfter = cents(application.pendingAfter);
    return applied !== null && applied > 0n && pendingAfter === 0n;
  }).map((application) => application.planEntryId));

  return [...entries]
    .filter((entry) => {
      const pending = cents(entry.pendingAmount);
      return pending !== null && (pending > 0n || paidEntryIds.has(entry.id));
    })
    .sort((left, right) => paymentDateOnlyKey(left.dueDate).localeCompare(paymentDateOnlyKey(right.dueDate))
      || left.sequence - right.sequence || left.id.localeCompare(right.id))
    .map((entry, index) => ({ ...entry, sequence: index + 1 }));
}

export function alignApplicationSequences<T extends { planEntryId: string; sequence: number }>(
  applications: readonly T[], entries: readonly NumberedPlanEntry[],
): T[] {
  const currentSequence = new Map(entries.map((entry) => [entry.id, entry.sequence]));
  return applications.map((application) => ({
    ...application,
    sequence: currentSequence.get(application.planEntryId) ?? application.sequence,
  }));
}
