import { CollectorPrecollectionService } from '../application/use-cases/collector-precollection.use-cases';
import { CollectorPrecollectionApi } from '../infrastructure/api/collector-precollection.api';

export const collectorPrecollections = new CollectorPrecollectionService(new CollectorPrecollectionApi());
