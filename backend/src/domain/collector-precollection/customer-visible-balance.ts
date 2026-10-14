export type CustomerVisibleBalance = {
  before: string;
  after: string;
};

const cents = (value: string): bigint => {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -amount : amount;
};

const money = (value: bigint): string => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

export function calculateCustomerVisibleBalance(
  financialBalance: string,
  unappliedCollections: string,
  receivedAmount: string,
): CustomerVisibleBalance {
  const before = cents(financialBalance) - cents(unappliedCollections);
  const nonNegativeBefore = before > 0n ? before : 0n;
  const after = nonNegativeBefore - cents(receivedAmount);
  return { before: money(nonNegativeBefore), after: money(after > 0n ? after : 0n) };
}
