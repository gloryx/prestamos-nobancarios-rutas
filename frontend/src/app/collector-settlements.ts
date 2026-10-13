import { CollectorSettlementService } from '../application/use-cases/collector-settlement.use-cases';
import { CollectorSettlementApi } from '../infrastructure/api/collector-settlement.api';

export const collectorSettlements = new CollectorSettlementService(new CollectorSettlementApi());
