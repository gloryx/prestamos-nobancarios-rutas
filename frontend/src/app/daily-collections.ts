import { DailyCollectionsController } from '../application/use-cases/daily-collections-controller';
import { assignedDailyCollectionsApi, dailyCollectionsApi } from '../infrastructure/api/daily-collections.api';
import { costaRicaDateOnly } from '../shared/utils/date';

export const createDailyCollections = () => new DailyCollectionsController(dailyCollectionsApi, costaRicaDateOnly);
export const createAssignedDailyCollections = () => new DailyCollectionsController(assignedDailyCollectionsApi, costaRicaDateOnly);
