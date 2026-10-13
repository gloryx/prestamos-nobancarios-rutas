import type { CollectorSettlementActionInput, CollectorSettlementReasonedActionInput, CollectorSettlementRepository, ConfirmCollectorSettlementInput,
  CreateCollectorSettlementInput } from '../ports/collector-settlement.repository';

export class CollectorSettlementService {
  constructor(private readonly repository: CollectorSettlementRepository) {}
  create(input: CreateCollectorSettlementInput) { return this.repository.create(input); }
  mine() { return this.repository.mine(); }
  list() { return this.repository.list(); }
  detail(id: string) { return this.repository.detail(id); }
  submit(id: string, input: CollectorSettlementActionInput) { return this.repository.submit(id, input); }
  review(id: string, input: CollectorSettlementActionInput) { return this.repository.review(id, input); }
  reject(id: string, input: CollectorSettlementReasonedActionInput) { return this.repository.reject(id, input); }
  cancel(id: string, input: CollectorSettlementReasonedActionInput) { return this.repository.cancel(id, input); }
  confirm(id: string, input: ConfirmCollectorSettlementInput) { return this.repository.confirm(id, input); }
}
