import { ClosedFinancialPeriodError } from '../../domain/financial-close/financial-close.errors';

export const RETROACTIVE_PERIOD_READER = Symbol('RETROACTIVE_PERIOD_READER');
export interface RetroactivePeriodReader { latestClosedThrough(context?: unknown): Promise<string | null>; }
export class RetroactivePeriodGuard {
  constructor(private readonly reader: RetroactivePeriodReader) {}
  async assertDateAllowed(economicDate: string, context?: unknown): Promise<void> {
    const closedThrough = await this.reader.latestClosedThrough(context);
    if (closedThrough && economicDate <= closedThrough) throw new ClosedFinancialPeriodError(`The economic date ${economicDate} belongs to a closed financial period.`);
  }
}
