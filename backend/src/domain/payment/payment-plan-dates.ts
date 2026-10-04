const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type PaymentPlanDateIssue = 'invalid' | 'before-anchor' | 'sunday' | 'duplicate' | 'order';

function dateOnly(value: string): Date | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]) ? date : null;
}

export function paymentPlanDateIssue(anchorDate: string, dates: string[], allowAnchor = false): PaymentPlanDateIssue | null {
  if (!dateOnly(anchorDate)) return 'invalid';
  const occupied = new Set<string>();
  let previous: string | null = null;
  for (const value of dates) {
    const parsed = typeof value === 'string' ? dateOnly(value) : null;
    if (!parsed) return 'invalid';
    if (allowAnchor ? value < anchorDate : value <= anchorDate) return 'before-anchor';
    if (parsed.getUTCDay() === 0) return 'sunday';
    if (occupied.has(value)) return 'duplicate';
    if (previous !== null && value <= previous) return 'order';
    occupied.add(value);
    previous = value;
  }
  return null;
}
