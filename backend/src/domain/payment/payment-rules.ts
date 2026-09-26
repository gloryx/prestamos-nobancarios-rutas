import { createHash } from 'crypto';

type PaymentFact = {
  id: string;
  status: 'VALID' | 'ANNULLED';
  paymentDate: string;
  createdAt: string;
};

const cents = (value: string): bigint => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};

const money = (value: bigint): string => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

export function assertPaymentDate(openingDate: string, loanStartDate: string, paymentDate: string, currentDate: string): void {
  if (paymentDate < openingDate) throw new Error('payment-date-before-opening');
  if (paymentDate < loanStartDate) throw new Error('payment-date-before-loan');
  if (paymentDate > currentDate) throw new Error('payment-date-in-future');
}

export function calculatePaymentBalances(
  totalAmount: string,
  paidAmount: string,
  principal: string,
  paidPrincipal: string,
  realizedInterest: string,
  pendingAmount: string,
) {
  const financialBalance = cents(totalAmount) - cents(paidAmount);
  const outstandingPrincipal = cents(principal) - cents(paidPrincipal);
  const equationHolds = cents(paidAmount) + cents(pendingAmount) === cents(totalAmount);
  return {
    financialBalance: money(financialBalance),
    outstandingPrincipal: money(outstandingPrincipal),
    realizedInterest: money(cents(realizedInterest)),
    equationHolds,
  };
}

export function isLastValidPayment(paymentId: string, payments: PaymentFact[]): boolean {
  const valid = payments
    .filter((payment) => payment.status === 'VALID')
    .sort((left, right) => right.paymentDate.localeCompare(left.paymentDate)
      || right.createdAt.localeCompare(left.createdAt)
      || right.id.localeCompare(left.id));
  return valid[0]?.id === paymentId;
}

export function paymentFingerprint(input: Record<string, string | undefined>): string {
  const canonical = Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
