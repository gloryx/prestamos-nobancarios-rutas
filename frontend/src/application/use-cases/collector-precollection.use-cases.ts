import type { CollectorPrecollectionRepository, CollectorPrecollectionListQuery,
  CreateCollectorPrecollectionInput } from '../ports/collector-precollection.repository';

export class CollectorPrecollectionService {
  constructor(private readonly repository: CollectorPrecollectionRepository) {}
  create(input: CreateCollectorPrecollectionInput) { return this.repository.create(input); }
  mine(query: CollectorPrecollectionListQuery = {}) { return this.repository.mine(query); }
  list(query: CollectorPrecollectionListQuery = {}) { return this.repository.list(query); }
  detail(id: string) { return this.repository.detail(id); }
  cancel(id: string, input: { reason: string; idempotencyKey: string }) { return this.repository.cancel(id, input); }
}
