import type { FinancialCloseCalculation, FinancialCloseCashFact, FinancialCloseStatusTransition } from '../../domain/financial-close/financial-close';
import type { EconomicProvenanceFacts, EconomicProvenanceResult } from '../../domain/cash-movement/economic-principal-provenance';
import type { EconomicProfitabilitySnapshot } from '../cash-movement/monthly-profitability.use-case';

export const FINANCIAL_CLOSE_STORE = Symbol('FINANCIAL_CLOSE_STORE');
export type FinancialCloseRecord = Omit<FinancialCloseCalculation, 'modelVersion'> & { modelVersion: number; id: string; sequence: number; confirmedAt: Date; confirmedBy: { id: string; fullName: string } };
export type FinancialCloseEconomicSnapshot = { provenance: EconomicProvenanceResult; facts: EconomicProvenanceFacts };
export type FinancialCloseSourceSnapshot = EconomicProfitabilitySnapshot & {
  opening: { openingDate: string; initialAvailableAmount: string; initialPortfolio: string; initialUncollectibleAmount: string } | null;
  effectiveFromDate: string; openingEconomic: FinancialCloseEconomicSnapshot | null;
  economicFacts: EconomicProvenanceFacts; cashFacts: FinancialCloseCashFact[];
  cashBalances: { opening: string; closing: string }; statusTransitions: FinancialCloseStatusTransition[];
};
export interface FinancialCloseStore {
  previewSource(fromDate: string, toDate: string): Promise<FinancialCloseSourceSnapshot>;
  nextSequence(): Promise<{ sequence: number; expectedPeriod: string | null }>;
  confirm<T>(work: (transaction: FinancialCloseTransaction) => Promise<T>): Promise<T>;
  list(page: number, pageSize: 10 | 20 | 50): Promise<{ items: FinancialCloseRecord[]; total: number }>;
  findById(id: string): Promise<FinancialCloseRecord | null>;
}
export interface FinancialCloseTransaction {
  lock(): Promise<void>;
  nextSequence(): Promise<{ sequence: number; expectedPeriod: string | null }>;
  source(fromDate: string, toDate: string): Promise<FinancialCloseSourceSnapshot>;
  insert(calculation: FinancialCloseCalculation, sequence: number, actorId: string): Promise<FinancialCloseRecord>;
}
