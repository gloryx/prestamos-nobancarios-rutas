import type { EconomicCapitalResult } from './economic-capital';
import type { EconomicLoanFact, EconomicProvenanceResult } from './economic-principal-provenance';

const MONEY = /^-?(?:0|[1-9]\d{0,35})(?:\.\d{1,2})?$/;

const cents = (value: string): bigint => {
  if (!MONEY.test(value)) throw new Error('Monthly profitability contains invalid money.');
  const negative = value.startsWith('-');
  const [whole, decimal = ''] = (negative ? value.slice(1) : value).split('.');
  const amount = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
  return negative ? -amount : amount;
};
const money = (value: bigint): string => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100n}.${((value < 0n ? -value : value) % 100n).toString().padStart(2, '0')}`;
const roundedDivision = (numerator: bigint, denominator: bigint): bigint => {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
};
const ratio = (numerator: bigint, denominator: bigint): string | null => {
  if (denominator <= 0n) return null;
  const scaled = roundedDivision(numerator * 10_000n, denominator);
  return `${scaled < 0n ? '-' : ''}${(scaled < 0n ? -scaled : scaled) / 10_000n}.${((scaled < 0n ? -scaled : scaled) % 10_000n).toString().padStart(4, '0')}`;
};

export type NormalProfitabilityRow = {
  loanId: string; loanNumber: string; customerId: string; customerName: string; status: string;
  realizedInterestInPeriod: string; paymentCountContributing: number;
};

export type RefinancingProfitabilityRow = {
  rootLoanId: string; terminalLoanId: string; loanIds: string[]; refinancingIds: string[];
  customer: { id: string; name: string }; chainStatus: string;
  regularInterestRealizedInPeriod: string; capitalizedYieldRecoveredInPeriod: string;
  economicGainInPeriod: string; capitalizedYieldPendingAtEnd: string; paymentCountContributing: number;
};

export type ProfitabilityPaymentRow = {
  eventType: 'PAYMENT' | 'REVERSAL'; source: 'NORMAL' | 'REFINANCING'; rootLoanId: string | null;
  paymentId: string; loanId: string; loanNumber: string; customerId: string; customerName: string;
  paymentDate: string; paymentAmount: string;
  principalAppliedContractual: string; economicPrincipalRecovered: string;
  capitalizedYieldRecovered: string; interestApplied: string; economicGainContribution: string;
};

export type MonthlyProfitabilityResult = {
  period: string; fromDate: string; toDate: string; calendarDays: number;
  gain: { total: string; normal: string; refinancings: string;
    refinancingRegularInterest: string; recoveredCapitalizedYield: string };
  capital: { openingEconomicBalance: string | null; realDisbursedInPeriod: string | null;
    economicRecoveredInPeriod: string | null; adjustmentsInPeriod: string | null; closingEconomicBalance: string | null;
    capitalDays: string | null; averageWorkingCapital: string | null };
  indicators: { periodProfitability: string | null; equivalentThirtyDayRate: string | null; capitalRotation: string | null };
  integrity: { status: EconomicCapitalResult['dataStatus']; warnings: string[] };
  normal: NormalProfitabilityRow[];
  refinancings: RefinancingProfitabilityRow[];
  payments: ProfitabilityPaymentRow[];
};

export function calculateMonthlyProfitability(period: string, capital: EconomicCapitalResult,
  provenance: EconomicProvenanceResult, loans: EconomicLoanFact[]): MonthlyProfitabilityResult {
  const loanById = new Map(loans.map((loan) => [loan.loanId, loan]));
  const chainByLoan = new Map<string, EconomicProvenanceResult['chains'][number]>();
  const chainByRoot = new Map<string, EconomicProvenanceResult['chains'][number]>();
  for (const chain of provenance.chains.filter((item) => item.loanIds.length > 1)) {
    chainByRoot.set(chain.rootLoanId, chain);
    for (const loanId of chain.loanIds) chainByLoan.set(loanId, chain);
  }
  const events = provenance.gainEvents.filter((event) => event.date >= capital.fromDate && event.date <= capital.toDate);
  const normalRows = new Map<string, { total: bigint; paymentIds: Set<string> }>();
  const chainRows = new Map<string, { regular: bigint; capitalized: bigint; paymentIds: Set<string> }>();
  const payments: ProfitabilityPaymentRow[] = [];
  let normal = 0n;
  let refinancingRegular = 0n;
  let capitalizedYield = 0n;
  for (const event of events) {
    const chain = chainByLoan.get(event.loanId);
    const interest = cents(event.interestApplied);
    const capitalized = cents(event.capitalizedYieldRecovered);
    const gain = chain ? interest + capitalized : interest;
    if (chain) {
      refinancingRegular += interest;
      capitalizedYield += capitalized;
      if (gain !== 0n) {
        const row = chainRows.get(chain.rootLoanId) ?? { regular: 0n, capitalized: 0n, paymentIds: new Set<string>() };
        row.regular += interest; row.capitalized += capitalized; row.paymentIds.add(event.paymentId);
        chainRows.set(chain.rootLoanId, row);
      }
    } else {
      normal += interest;
      if (gain !== 0n) {
        const row = normalRows.get(event.loanId) ?? { total: 0n, paymentIds: new Set<string>() };
        row.total += interest; row.paymentIds.add(event.paymentId); normalRows.set(event.loanId, row);
      }
    }
    const loan = loanById.get(event.loanId);
    if (gain !== 0n) payments.push({ eventType: event.eventType, source: chain ? 'REFINANCING' : 'NORMAL',
      rootLoanId: chain?.rootLoanId ?? null, paymentId: event.paymentId, loanId: event.loanId,
      loanNumber: loan?.loanNumber ?? '', customerId: loan?.customerId ?? '', customerName: loan?.customerName ?? '',
      paymentDate: event.date, paymentAmount: event.paymentAmount,
      principalAppliedContractual: event.principalAppliedContractual,
      economicPrincipalRecovered: event.economicPrincipalRecovered,
      capitalizedYieldRecovered: event.capitalizedYieldRecovered,
      interestApplied: event.interestApplied, economicGainContribution: money(gain) });
  }
  const refinancingGain = refinancingRegular + capitalizedYield;
  const totalGain = normal + refinancingGain;
  const capitalDays = capital.daily.length === capital.calendarDays
    ? capital.daily.reduce((sum, day) => sum + cents(day.closingBalance), 0n) : null;
  const reliableDenominator = capital.dataStatus === 'COMPLETE' && capitalDays !== null && capitalDays > 0n;
  const normalDetails: NormalProfitabilityRow[] = [...normalRows].map(([loanId, row]) => {
    const loan = loanById.get(loanId);
    return { loanId, loanNumber: loan?.loanNumber ?? '', customerId: loan?.customerId ?? '',
      customerName: loan?.customerName ?? '', status: loan?.status ?? 'UNKNOWN',
      realizedInterestInPeriod: money(row.total), paymentCountContributing: row.paymentIds.size };
  }).sort((left, right) => left.loanNumber.localeCompare(right.loanNumber) || left.loanId.localeCompare(right.loanId));
  const refinancingDetails: RefinancingProfitabilityRow[] = [...chainRows].map(([rootLoanId, row]) => {
    const chain = chainByRoot.get(rootLoanId)!;
    const root = loanById.get(rootLoanId); const terminal = loanById.get(chain.terminalLoanId);
    return { rootLoanId, terminalLoanId: chain.terminalLoanId, loanIds: chain.loanIds, refinancingIds: chain.refinancingIds,
      customer: { id: root?.customerId ?? '', name: root?.customerName ?? '' }, chainStatus: terminal?.status ?? 'UNKNOWN',
      regularInterestRealizedInPeriod: money(row.regular), capitalizedYieldRecoveredInPeriod: money(row.capitalized),
      economicGainInPeriod: money(row.regular + row.capitalized), capitalizedYieldPendingAtEnd: chain.capitalizedYieldPending,
      paymentCountContributing: row.paymentIds.size };
  }).sort((left, right) => left.rootLoanId.localeCompare(right.rootLoanId));
  return { period, fromDate: capital.fromDate, toDate: capital.toDate, calendarDays: capital.calendarDays,
    gain: { total: money(totalGain), normal: money(normal), refinancings: money(refinancingGain),
      refinancingRegularInterest: money(refinancingRegular), recoveredCapitalizedYield: money(capitalizedYield) },
    capital: { openingEconomicBalance: capital.openingEconomicBalance, realDisbursedInPeriod: capital.realCapitalDisbursed,
      economicRecoveredInPeriod: capital.recoveredCapital, adjustmentsInPeriod: capital.periodAdjustments, closingEconomicBalance: capital.closingEconomicBalance,
      capitalDays: capitalDays === null ? null : money(capitalDays), averageWorkingCapital: capital.averageWorkingCapital },
    indicators: { periodProfitability: reliableDenominator ? ratio(totalGain * BigInt(capital.calendarDays), capitalDays!) : null,
      equivalentThirtyDayRate: reliableDenominator ? ratio(totalGain * 30n, capitalDays!) : null,
      capitalRotation: reliableDenominator ? capital.capitalRotation : null },
    integrity: { status: capital.dataStatus, warnings: capital.warnings }, normal: normalDetails,
    refinancings: refinancingDetails,
    payments: payments.sort((left, right) => left.paymentDate.localeCompare(right.paymentDate) || left.paymentId.localeCompare(right.paymentId)) };
}
