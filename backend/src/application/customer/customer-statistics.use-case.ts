import { calculateCustomerStatistics, type CustomerStatisticsFacts } from '../../domain/customer/customer-statistics';
import { CustomerValidationError } from '../../domain/customer/customer.errors';

export const CUSTOMER_STATISTICS_READER = Symbol('CUSTOMER_STATISTICS_READER');

export interface CustomerStatisticsReader {
  read(year: number, currentMonth: number): Promise<CustomerStatisticsFacts>;
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

export class CustomerStatisticsUseCase {
  constructor(private readonly reader: CustomerStatisticsReader, private readonly currentPeriod = costaRicaPeriod) {}

  async execute(requestedYear?: string) {
    const current = this.currentPeriod();
    const year = requestedYear === undefined ? current.year : Number(requestedYear);
    if (!Number.isSafeInteger(year) || year < 1000 || year > 9999 ||
      (requestedYear !== undefined && !/^[1-9]\d{3}$/.test(requestedYear)))
      throw new CustomerValidationError('El año debe tener formato YYYY.');
    const facts = await this.reader.read(year, current.month);
    return calculateCustomerStatistics(year, current.year, facts);
  }
}
