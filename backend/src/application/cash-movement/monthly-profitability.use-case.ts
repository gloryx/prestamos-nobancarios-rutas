import { calculateEconomicCapital, economicCapitalPeriod, type EconomicCapitalFacts } from '../../domain/cash-movement/economic-capital';
import { calculateMonthlyProfitability } from '../../domain/cash-movement/monthly-profitability';
import type { EconomicLoanFact, EconomicProvenanceResult } from '../../domain/cash-movement/economic-principal-provenance';
import type { LoanStatus } from '../../domain/loan/loan.types';

export const ECONOMIC_PROFITABILITY_READER = Symbol('ECONOMIC_PROFITABILITY_READER');

export type EconomicProfitabilitySnapshot = {
  capitalFacts: EconomicCapitalFacts;
  provenance: EconomicProvenanceResult;
  loans: EconomicLoanFact[];
};

export interface EconomicProfitabilityReader {
  readProfitabilityThrough(toDate: string): Promise<EconomicProfitabilitySnapshot>;
}

export type ProfitabilityPage = { page: number; pageSize: 10 | 20 | 50 };

const page = <T>(items: T[], query: ProfitabilityPage) => ({ items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
  total: items.length, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(items.length / query.pageSize) });
const sumMoney = (values: string[]): string => {
  const total = values.reduce((sum, value) => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return sum + (negative ? -amount : amount);
  }, 0n);
  const absolute = total < 0n ? -total : total;
  return `${total < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
};

export class MonthlyProfitabilityUseCase {
  constructor(private readonly reader: EconomicProfitabilityReader) {}

  private async analyze(period: string) {
    const { toDate } = economicCapitalPeriod(period);
    const snapshot = await this.reader.readProfitabilityThrough(toDate);
    const capital = calculateEconomicCapital(period, snapshot.capitalFacts);
    return calculateMonthlyProfitability(period, capital, snapshot.provenance, snapshot.loans);
  }

  async summary(period: string) {
    const result = await this.analyze(period);
    return { period: result.period, fromDate: result.fromDate, toDate: result.toDate, calendarDays: result.calendarDays,
      gain: result.gain, capital: result.capital, indicators: result.indicators, integrity: result.integrity };
  }

  async normal(period: string, query: ProfitabilityPage, filter: { status?: LoanStatus } = {}) {
    const items = (await this.analyze(period)).normal.filter((item) => !filter.status || item.status === filter.status);
    return { ...page(items, query), summary: { realizedInterest: sumMoney(items.map((item) => item.realizedInterestInPeriod)) } };
  }
  async refinancings(period: string, query: ProfitabilityPage, filter: { terminalStatus?: LoanStatus } = {}) {
    const items = (await this.analyze(period)).refinancings
      .filter((item) => !filter.terminalStatus || item.chainStatus === filter.terminalStatus);
    return { ...page(items, query), summary: {
      regularInterestRealized: sumMoney(items.map((item) => item.regularInterestRealizedInPeriod)),
      capitalizedYieldRecovered: sumMoney(items.map((item) => item.capitalizedYieldRecoveredInPeriod)),
      economicGain: sumMoney(items.map((item) => item.economicGainInPeriod)),
    } };
  }
  async payments(period: string, query: ProfitabilityPage,
    filter: { source?: 'NORMAL' | 'REFINANCING'; loanId?: string; rootLoanId?: string } = {}) {
    const items = (await this.analyze(period)).payments.filter((item) => (!filter.source || item.source === filter.source)
      && (!filter.loanId || item.loanId === filter.loanId) && (!filter.rootLoanId || item.rootLoanId === filter.rootLoanId));
    return page(items, query);
  }
}
