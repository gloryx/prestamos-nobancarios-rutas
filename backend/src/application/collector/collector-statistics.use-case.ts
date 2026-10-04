import type { CollectorStatisticsFacts, CollectorStatisticsPeriod } from '../../domain/collector/collector-statistics';
import { buildCollectorStatistics } from '../../domain/collector/collector-statistics';
import { CollectorValidationError } from '../../domain/collector/collector.errors';

export const COLLECTOR_STATISTICS_READER = Symbol('COLLECTOR_STATISTICS_READER');

export interface CollectorStatisticsReader {
  read(period: CollectorStatisticsPeriod): Promise<CollectorStatisticsFacts>;
}

const costaRicaPeriod = (): { year: number; month: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Costa_Rica', year: 'numeric', month: 'numeric',
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
  };
};

const pad = (value: number): string => String(value).padStart(2, '0');

export class CollectorStatisticsUseCase {
  constructor(private readonly reader: CollectorStatisticsReader, private readonly currentPeriod = costaRicaPeriod) {}

  async execute(requestedYear?: string, requestedMonth?: string) {
    const current = this.currentPeriod();
    const year = requestedYear === undefined ? current.year : Number(requestedYear);
    if (!Number.isSafeInteger(year) || year < 1000 || year > 9999 ||
      (requestedYear !== undefined && !/^[1-9]\d{3}$/.test(requestedYear)))
      throw new CollectorValidationError('El año debe tener formato YYYY.');

    let month: number | null = null;
    if (requestedMonth !== undefined) {
      const parsedMonth = Number(requestedMonth);
      if (!/^(?:[1-9]|1[0-2])$/.test(requestedMonth) || !Number.isSafeInteger(parsedMonth) ||
        parsedMonth < 1 || parsedMonth > 12)
        throw new CollectorValidationError('El mes debe ser un entero entre 1 y 12.');
      month = parsedMonth;
    }

    const startDate = month === null ? `${year}-01-01` : `${year}-${pad(month)}-01`;
    const endDate = month === null
      ? `${year}-12-31`
      : `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
    const period: CollectorStatisticsPeriod = {
      year, month, startDate, endDate, granularity: month === null ? 'MONTH' : 'DAY',
    };
    return buildCollectorStatistics(period, await this.reader.read(period));
  }
}
