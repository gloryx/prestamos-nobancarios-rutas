import { calculateEconomicCapital, economicCapitalPeriod } from '../../domain/cash-movement/economic-capital';
import { calculateMonthlyProfitability } from '../../domain/cash-movement/monthly-profitability';
import { calculateFinancialClose } from '../../domain/financial-close/financial-close';
import { FinancialCloseConflictError, FinancialCloseIntegrityError, FinancialCloseValidationError, FinancialCloseNotFoundError } from '../../domain/financial-close/financial-close.errors';
import type { FinancialCloseSourceSnapshot, FinancialCloseStore } from './financial-close.store';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const costaRicaDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const monthOf = (date: string) => date.slice(0, 7);
const nextMonth = (period: string) => { const [year, month] = period.split('-').map(Number); return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7); };

export class FinancialCloseUseCases {
  constructor(private readonly store: FinancialCloseStore, private readonly currentDate = costaRicaDate) {}
  private validatePeriod(period: string) {
    if (!MONTH.test(period)) throw new FinancialCloseValidationError('The period must use YYYY-MM format.');
    const range = economicCapitalPeriod(period);
    if (range.toDate >= this.currentDate()) throw new FinancialCloseValidationError('Only ended periods can be closed.');
    return range;
  }
  private calculate(period: string, source: FinancialCloseSourceSnapshot) {
    if (!source.opening) throw new FinancialCloseConflictError('The financial opening is required.');
    const capital = calculateEconomicCapital(period, source.capitalFacts, this.currentDate(), source.effectiveFromDate);
    const profitability = calculateMonthlyProfitability(period, capital, source.provenance, source.loans);
    return calculateFinancialClose({ period, openingDate: source.opening.openingDate,
      initialAvailableAmount: source.opening.initialAvailableAmount, initialPortfolio: source.opening.initialPortfolio,
      initialUncollectibleAmount: source.opening.initialUncollectibleAmount, cashFacts: source.cashFacts,
      cashBalances: source.cashBalances, profitability, openingEconomic: source.openingEconomic,
      finalEconomic: { provenance: source.provenance, facts: source.economicFacts }, statusTransitions: source.statusTransitions });
  }
  private validateSequence(period: string, openingDate: string, state: { expectedPeriod: string | null }) {
    const expected = state.expectedPeriod ?? monthOf(openingDate);
    if (period !== expected) throw new FinancialCloseConflictError(`The next financial close period must be ${expected}.`);
  }
  async preview(period: string) {
    const { toDate } = this.validatePeriod(period);
    const { fromDate } = economicCapitalPeriod(period);
    const source = await this.store.previewSource(fromDate, toDate);
    if (!source.opening) throw new FinancialCloseConflictError('The financial opening is required.');
    this.validateSequence(period, source.opening.openingDate, await this.store.nextSequence());
    return this.calculate(period, source);
  }
  async confirm(period: string, actorId: string) {
    const { toDate } = this.validatePeriod(period);
    return this.store.confirm(async (transaction) => {
      await transaction.lock();
      const state = await transaction.nextSequence();
      const { fromDate } = economicCapitalPeriod(period);
      const source = await transaction.source(fromDate, toDate);
      if (!source.opening) throw new FinancialCloseConflictError('The financial opening is required.');
      this.validateSequence(period, source.opening.openingDate, state);
      const calculation = this.calculate(period, source);
      if (calculation.integrity.status !== 'COMPLETE') throw new FinancialCloseIntegrityError(calculation.integrity.blockingIssues.join(' '));
      return transaction.insert(calculation, state.sequence, actorId);
    });
  }
  async list(page: number, pageSize: 10 | 20 | 50) {
    const result = await this.store.list(page, pageSize);
    return { ...result, page, pageSize, totalPages: Math.ceil(result.total / pageSize) };
  }
  async detail(id: string) { const result = await this.store.findById(id); if (!result) throw new FinancialCloseNotFoundError('Financial close not found.'); return result; }
}

export { nextMonth };
