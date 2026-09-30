import { paymentDateOnlyKey } from './payment-date-only';

export type ProjectionEntry = { id: string; dueDate: string | Date; sequence: number; pendingAmount: string };
export type ProjectionPayment = { id: string; paymentDate: string | Date; amount: string; status: 'VALID' | 'ANNULLED' };

const cents = (value: string): bigint => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};

export function buildPaymentProjection(
  entries: ProjectionEntry[],
  payments: ProjectionPayment[],
  totalAmount?: string,
  interestAmount?: string,
) {
  const combinedPlan = [...entries].sort((left, right) => paymentDateOnlyKey(left.dueDate).localeCompare(paymentDateOnlyKey(right.dueDate)) || left.sequence - right.sequence || left.id.localeCompare(right.id));
  const validPayments = payments.filter((payment): payment is ProjectionPayment & { status: 'VALID' } => payment.status === 'VALID');
  const lastValidPayment = [...validPayments].sort((left, right) => paymentDateOnlyKey(right.paymentDate).localeCompare(paymentDateOnlyKey(left.paymentDate)) || right.id.localeCompare(left.id))[0] ?? null;
  const paid = validPayments.reduce((sum, payment) => sum + cents(payment.amount), 0n);
  const pending = combinedPlan.reduce((sum, entry) => sum + cents(entry.pendingAmount), 0n);
  const reconciled = totalAmount === undefined || paid + pending === cents(totalAmount);
  return {
    combinedPlan,
    validPayments,
    lastValidPayment,
    refinanceEligibility: totalAmount !== undefined && interestAmount !== undefined && paid >= cents(interestAmount) && reconciled && pending > 0n,
  };
}
