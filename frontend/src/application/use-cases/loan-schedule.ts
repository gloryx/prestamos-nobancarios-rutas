import type { LoanPlanEntry } from '../../domain/entities/loan';
import { parseMoneyCents } from '../../shared/utils/money';

export type ScheduleIntervalUnit = 'DAY' | 'WEEK' | 'DAY/15' | 'MONTH';

function toCents(value: string): bigint {
  const normalized = value.trim();
  const [whole, decimal = ''] = normalized.split('.');
  return BigInt(whole || '0') * 100n + BigInt(decimal.padEnd(2, '0').slice(0, 2));
}
function fromCents(value: bigint): string { return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`; }

type DateParts = { year: number; month: number; day: number };

function parseDateOnly(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function dateOnlyDayNumber(parts: DateParts): number {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return Math.trunc(date.getTime() / 86_400_000);
}

function formatRate(numerator: bigint, denominator: bigint): string {
  const scaled = (numerator * 100n + denominator / 2n) / denominator;
  const whole = scaled / 100n;
  const fraction = (scaled % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole},${fraction}` : whole.toString();
}

/** Calculates the exact-cent informational interest rate normalized to 30 calendar days. */
export function calculateInformationalRate30Days(
  principal: string,
  interestAmount: string,
  startDate: string,
  plan: LoanPlanEntry[],
): string | null {
  const principalCents = parseMoneyCents(principal);
  const interestCents = parseMoneyCents(interestAmount);
  const start = parseDateOnly(startDate);
  if (principalCents === null || principalCents <= 0n || interestCents === null || interestCents < 0n || !start || !Array.isArray(plan) || plan.length === 0) return null;

  const dueDates = plan.map((entry) => parseDateOnly(entry && typeof entry.dueDate === 'string' ? entry.dueDate : ''));
  if (dueDates.some((date) => date === null)) return null;
  const latestDueDate = dueDates.reduce((latest, date) => dateOnlyDayNumber(date!) > dateOnlyDayNumber(latest!) ? date : latest)!;
  const durationDays = dateOnlyDayNumber(latestDueDate) - dateOnlyDayNumber(start);
  if (durationDays <= 0) return null;
  if (interestCents === 0n) return '0%';
  return `${formatRate(interestCents * 3000n, principalCents * BigInt(durationDays))}%`;
}

export function addInterval(start: string, unit: ScheduleIntervalUnit, value: number): string {
  const [year, month, day] = start.split('-').map(Number);
  if (unit === 'MONTH') {
    const monthIndex = month - 1 + value;
    const targetYear = year + Math.floor(monthIndex / 12);
    const targetMonth = ((monthIndex % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return `${targetYear.toString().padStart(4, '0')}-${(targetMonth + 1).toString().padStart(2, '0')}-${Math.min(day, lastDay).toString().padStart(2, '0')}`;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + (unit === 'WEEK' ? value * 7 : unit === 'DAY/15' ? value * 15 : value));
  return date.toISOString().slice(0, 10);
}

export function automaticPlan(start: string, unit: ScheduleIntervalUnit, intervalValue: number, count: number, total: string): LoanPlanEntry[] {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(intervalValue) || intervalValue < 1) return [];
  const totalCents = toCents(total);
  const base = totalCents / BigInt(count);
  return Array.from({ length: count }, (_, index) => ({ sequence: index + 1, dueDate: addInterval(start, unit, intervalValue * (index + 1)), pendingAmount: fromCents(index === count - 1 ? totalCents - base * BigInt(count - 1) : base) }));
}
