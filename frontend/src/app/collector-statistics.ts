import { CollectorStatisticsController } from '../application/use-cases/collector-statistics-controller';
import { collectorStatisticsApi } from '../infrastructure/api/collector-statistics.api';
import { costaRicaDateOnly } from '../shared/utils/date';

export function createCollectorStatistics(): CollectorStatisticsController {
  const currentYear = Number(costaRicaDateOnly().slice(0, 4));
  return new CollectorStatisticsController(collectorStatisticsApi, currentYear, currentYear);
}
