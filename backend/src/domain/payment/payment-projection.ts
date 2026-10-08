import { paymentDateOnlyKey } from './payment-date-only';

export type ProjectionEntry = { id: string; dueDate: string | Date; sequence: number; pendingAmount: string };
export type ProjectionPayment = { id: string; paymentDate: string | Date; amount: string; status: 'VALID' | 'ANNULLED'; createdAt?: string | Date };
export type ProjectionApplication = {
  planEntryId: string;
  amountApplied: string;
  carriedForwardAmount: string;
  carriedToPlanEntryId: string | null;
  sourceDueDate: string | Date;
  createdAt: string | Date;
};
export type CollectionProjection = {
  overdueAmount: string;
  scheduledAmount: string;
  totalSuggestedAmount: string;
  operationalDate: string | null;
  operationalDateKind: 'SCHEDULED' | 'TODAY' | null;
};

const cents = (value: string): bigint => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};
const money = (value: bigint): string => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

export function buildCollectionProjection(entries: ProjectionEntry[], referenceDate: string, applications: ProjectionApplication[] = []): CollectionProjection {
  const ordered = [...entries].filter((entry) => cents(entry.pendingAmount) > 0n)
    .sort((left, right) => paymentDateOnlyKey(left.dueDate).localeCompare(paymentDateOnlyKey(right.dueDate)) || left.sequence - right.sequence || left.id.localeCompare(right.id));
  const entryIds = new Set(ordered.map((entry) => entry.id));
  const carried = new Map<string, bigint>();
  for (const application of [...applications].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))) {
    if (application.carriedToPlanEntryId && entryIds.has(application.carriedToPlanEntryId)
      && paymentDateOnlyKey(application.sourceDueDate) < referenceDate) {
      carried.set(application.carriedToPlanEntryId, (carried.get(application.carriedToPlanEntryId) ?? 0n) + cents(application.carriedForwardAmount));
    }
    if (entryIds.has(application.planEntryId)) {
      carried.set(application.planEntryId, ((carried.get(application.planEntryId) ?? 0n) - cents(application.amountApplied)) > 0n
        ? (carried.get(application.planEntryId) ?? 0n) - cents(application.amountApplied) : 0n);
    }
  }
  let overdue = 0n;
  for (const entry of ordered) {
    const pending = cents(entry.pendingAmount);
    if (paymentDateOnlyKey(entry.dueDate) < referenceDate) overdue += pending;
    else overdue += (carried.get(entry.id) ?? 0n) < pending ? (carried.get(entry.id) ?? 0n) : pending;
  }
  const scheduled = ordered.find((entry) => paymentDateOnlyKey(entry.dueDate) >= referenceDate);
  const scheduledPending = scheduled ? cents(scheduled.pendingAmount) : 0n;
  const scheduledCarry = scheduled ? ((carried.get(scheduled.id) ?? 0n) < scheduledPending ? (carried.get(scheduled.id) ?? 0n) : scheduledPending) : 0n;
  const scheduledAmount = scheduledPending - scheduledCarry;
  return {
    overdueAmount: money(overdue),
    scheduledAmount: money(scheduledAmount),
    totalSuggestedAmount: money(overdue + scheduledAmount),
    operationalDate: scheduled ? paymentDateOnlyKey(scheduled.dueDate) : overdue > 0n ? referenceDate : null,
    operationalDateKind: scheduled ? 'SCHEDULED' : overdue > 0n ? 'TODAY' : null,
  };
}

export function buildPaymentProjection(
  entries: ProjectionEntry[],
  payments: ProjectionPayment[],
  totalAmount?: string,
  interestAmount?: string,
  referenceDate?: string,
  applications: ProjectionApplication[] = [],
) {
  const combinedPlan = [...entries].sort((left, right) => paymentDateOnlyKey(left.dueDate).localeCompare(paymentDateOnlyKey(right.dueDate)) || left.sequence - right.sequence || left.id.localeCompare(right.id));
  const validPayments = payments.filter((payment): payment is ProjectionPayment & { status: 'VALID' } => payment.status === 'VALID');
  const lastValidPayment = [...validPayments].sort((left, right) => paymentDateOnlyKey(right.paymentDate).localeCompare(paymentDateOnlyKey(left.paymentDate))
    || String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')) || right.id.localeCompare(left.id))[0] ?? null;
  const paid = validPayments.reduce((sum, payment) => sum + cents(payment.amount), 0n);
  const pending = combinedPlan.reduce((sum, entry) => sum + cents(entry.pendingAmount), 0n);
  const reconciled = totalAmount === undefined || paid + pending === cents(totalAmount);
  return {
    combinedPlan,
    validPayments,
    lastValidPayment,
    collectionProjection: referenceDate ? buildCollectionProjection(combinedPlan, referenceDate, applications) : null,
    refinanceEligibility: totalAmount !== undefined && interestAmount !== undefined && paid >= cents(interestAmount) && reconciled && pending > 0n,
  };
}
