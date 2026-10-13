import type { PaymentApplication } from './entities/payment';

type CurrentPlanEntry = { id: string; sequence: number; dueDate: string; pendingAmount: string };

const cents = (value: string | undefined): bigint | null => {
  if (!value || !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};

export function hasPaidPlanEvidence(planEntryId: string, applications: readonly PaymentApplication[]): boolean {
  return applications.some((application) => application.planEntryId === planEntryId
    && (cents(application.amountApplied) ?? 0n) > 0n && cents(application.pendingAfter) === 0n);
}

export function numberCurrentPaymentPlan<T extends CurrentPlanEntry>(
  entries: readonly T[], applications: readonly PaymentApplication[],
): T[] {
  return [...entries]
    .filter((entry) => (cents(entry.pendingAmount) ?? 0n) > 0n || hasPaidPlanEvidence(entry.id, applications))
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate)
      || left.sequence - right.sequence || left.id.localeCompare(right.id))
    .map((entry, index) => ({ ...entry, sequence: index + 1 }));
}
