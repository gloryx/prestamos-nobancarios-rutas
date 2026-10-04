const MONTH = /^([1-9]\d{3})-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^(?:0|[1-9]\d{0,35})(?:\.\d{1,2})?$/;

export type EconomicCapitalEvent = {
  date: string;
  realDisbursements: string;
  capitalRecovered: string;
  adjustments: string;
};

export type EconomicCapitalFacts = {
  opening: { date: string; initialPortfolio: string } | null;
  events: EconomicCapitalEvent[];
  warnings: string[];
};

export type DailyEconomicCapital = {
  date: string;
  openingBalance: string;
  realDisbursements: string;
  capitalRecovered: string;
  adjustments: string;
  closingBalance: string;
};

export type EconomicCapitalResult = {
  period: string;
  fromDate: string;
  toDate: string;
  calendarDays: number;
  openingEconomicBalance: string | null;
  realCapitalDisbursed: string | null;
  recoveredCapital: string | null;
  periodAdjustments: string | null;
  averageWorkingCapital: string | null;
  capitalRotation: string | null;
  closingEconomicBalance: string | null;
  dataStatus: 'COMPLETE' | 'WARNING' | 'INCONSISTENT' | 'UNAVAILABLE';
  warnings: string[];
  daily: DailyEconomicCapital[];
};

export class EconomicCapitalValidationError extends Error {}
export class EconomicCapitalDataError extends Error {}

const cents = (value: string): bigint => {
  if (!MONEY.test(value)) throw new EconomicCapitalDataError('Los hechos financieros contienen un monto inválido.');
  const [whole, decimals = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(decimals.padEnd(2, '0'));
};

const signedCents = (value: string): bigint => value.startsWith('-') ? -cents(value.slice(1)) : cents(value);
const money = (value: bigint): string => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100n}.${((value < 0n ? -value : value) % 100n).toString().padStart(2, '0')}`;
const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const dateKey = (value: Date): string => value.toISOString().slice(0, 10);
const validDate = (value: string): boolean => DATE.test(value) && dateKey(date(value)) === value;
const addDay = (value: string): string => dateKey(new Date(date(value).getTime() + 86_400_000));
const costaRicaDate = (): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export function economicCapitalPeriod(period: string): { fromDate: string; toDate: string; calendarDays: number } {
  const match = MONTH.exec(period);
  if (!match) throw new EconomicCapitalValidationError('El período debe tener formato YYYY-MM.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const calendarDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { fromDate: `${period}-01`, toDate: `${period}-${calendarDays.toString().padStart(2, '0')}`, calendarDays };
}

function roundedDivision(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

function ratio(numerator: bigint, closingSum: bigint, days: number): string | null {
  if (closingSum <= 0n) return null;
  const scaled = roundedDivision(numerator * BigInt(days) * 10_000n, closingSum);
  return `${scaled / 10_000n}.${(scaled % 10_000n).toString().padStart(4, '0')}`;
}

export function calculateEconomicCapital(period: string, facts: EconomicCapitalFacts, currentDate = costaRicaDate()): EconomicCapitalResult {
  const range = economicCapitalPeriod(period);
  const unavailable = (warning: string): EconomicCapitalResult => ({ period, ...range, openingEconomicBalance: null,
    realCapitalDisbursed: null, recoveredCapital: null, periodAdjustments: null, averageWorkingCapital: null, capitalRotation: null,
    closingEconomicBalance: null, dataStatus: 'UNAVAILABLE', warnings: [...facts.warnings, warning], daily: [] });
  if (!facts.opening) return unavailable('No existe una apertura financiera que establezca el saldo económico inicial.');
  if (!validDate(facts.opening.date) || !MONEY.test(facts.opening.initialPortfolio)) return unavailable('La apertura financiera no contiene datos válidos.');
  if (range.fromDate < facts.opening.date) return unavailable('El período comienza antes de la apertura financiera y no puede reconstruirse sin inferencias.');

  const grouped = new Map<string, { disbursements: bigint; recovered: bigint; adjustments: bigint }>();
  for (const event of facts.events) {
    if (!validDate(event.date)) throw new EconomicCapitalDataError('Los hechos financieros contienen una fecha inválida.');
    const current = grouped.get(event.date) ?? { disbursements: 0n, recovered: 0n, adjustments: 0n };
    current.disbursements += cents(event.realDisbursements);
    current.recovered += cents(event.capitalRecovered);
    current.adjustments += signedCents(event.adjustments);
    grouped.set(event.date, current);
  }

  let balance = cents(facts.opening.initialPortfolio);
  for (const [eventDate, event] of grouped) {
    if (eventDate >= facts.opening.date && eventDate < range.fromDate)
      balance += event.disbursements - event.recovered + event.adjustments;
  }
  const openingEconomicBalance = balance;
  let periodDisbursements = 0n;
  let periodRecovered = 0n;
  let periodAdjustments = 0n;
  let closingSum = 0n;
  let inconsistent = balance < 0n;
  const daily: DailyEconomicCapital[] = [];
  for (let currentDate = range.fromDate; currentDate <= range.toDate; currentDate = addDay(currentDate)) {
    const event = grouped.get(currentDate) ?? { disbursements: 0n, recovered: 0n, adjustments: 0n };
    const openingBalance = balance;
    balance = openingBalance + event.disbursements - event.recovered + event.adjustments;
    if (balance < 0n) inconsistent = true;
    periodDisbursements += event.disbursements;
    periodRecovered += event.recovered;
    periodAdjustments += event.adjustments;
    closingSum += balance;
    daily.push({ date: currentDate, openingBalance: money(openingBalance), realDisbursements: money(event.disbursements),
      capitalRecovered: money(event.recovered), adjustments: money(event.adjustments), closingBalance: money(balance) });
  }
  const average = roundedDivision(closingSum, BigInt(range.calendarDays));
  const warnings = [...facts.warnings];
  const integrityIssues = warnings.length > 0;
  if (inconsistent) warnings.push('El saldo económico resulta negativo; existen hechos incompletos o inconsistentes.');
  if (range.toDate > currentDate) warnings.push('El período no ha terminado; el resultado es provisional y puede cambiar con nuevos hechos económicos.');
  const dataStatus = inconsistent || integrityIssues ? 'INCONSISTENT' : warnings.length ? 'WARNING' : 'COMPLETE';
  return { period, ...range, openingEconomicBalance: money(openingEconomicBalance),
    realCapitalDisbursed: money(periodDisbursements), recoveredCapital: money(periodRecovered), periodAdjustments: money(periodAdjustments),
    averageWorkingCapital: money(average), capitalRotation: dataStatus === 'INCONSISTENT' ? null : ratio(periodDisbursements, closingSum, range.calendarDays),
    closingEconomicBalance: money(balance), dataStatus, warnings, daily };
}
