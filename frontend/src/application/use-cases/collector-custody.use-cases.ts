import type { CollectorCustodyAdjustmentInput, CollectorCustodyMovementInput, CollectorCustodyRepository } from '../ports/collector-custody.repository';

export class CollectorCustodyService {
  constructor(private readonly repository: CollectorCustodyRepository) {}
  summary(collectorId?: string) { return this.repository.summary(collectorId); }
  movements(collectorId?: string) { return this.repository.movements(collectorId); }
  remit(input: CollectorCustodyMovementInput) { return this.repository.remit(input); }
  topUp(input: CollectorCustodyMovementInput) { return this.repository.topUp(input); }
  adjust(input: CollectorCustodyAdjustmentInput) { return this.repository.adjust(input); }
}
