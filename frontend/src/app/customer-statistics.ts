import { CustomerStatisticsController } from '../application/use-cases/customer-statistics-controller';
import { customerStatisticsApi } from '../infrastructure/api/customer-statistics.api';
import { costaRicaDateOnly } from '../shared/utils/date';

export function createCustomerStatistics(): CustomerStatisticsController {
  const currentYear = Number(costaRicaDateOnly().slice(0, 4));
  return new CustomerStatisticsController(customerStatisticsApi, currentYear, currentYear);
}
