import { calculateEconomicCapital, economicCapitalPeriod, type EconomicCapitalFacts } from '../../domain/cash-movement/economic-capital';

export const ECONOMIC_CAPITAL_READER = Symbol('ECONOMIC_CAPITAL_READER');

export interface EconomicCapitalReader {
  readThrough(toDate: string): Promise<EconomicCapitalFacts>;
}

export class EconomicCapitalUseCase {
  constructor(private readonly reader: EconomicCapitalReader) {}
  async execute(period: string) {
    const { toDate } = economicCapitalPeriod(period);
    return calculateEconomicCapital(period, await this.reader.readThrough(toDate));
  }
}
