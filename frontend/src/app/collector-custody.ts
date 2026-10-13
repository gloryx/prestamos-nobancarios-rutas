import { CollectorCustodyService } from '../application/use-cases/collector-custody.use-cases';
import { CollectorCustodyApi } from '../infrastructure/api/collector-custody.api';

export const collectorCustody = new CollectorCustodyService(new CollectorCustodyApi());
