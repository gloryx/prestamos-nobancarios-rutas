import type { CollectorInput, CollectorListQuery, CollectorRepository, CollectorUpdateInput } from '../ports/collector.repository';

export class ListCollectors { constructor(private readonly repository: CollectorRepository) {} execute(query: CollectorListQuery) { return this.repository.list(query); } }
export class GetCollector { constructor(private readonly repository: CollectorRepository) {} execute(id: string) { return this.repository.detail(id); } }
export class CreateCollector { constructor(private readonly repository: CollectorRepository) {} execute(input: CollectorInput) { return this.repository.create(input); } }
export class UpdateCollector { constructor(private readonly repository: CollectorRepository) {} execute(id: string, input: CollectorUpdateInput) { return this.repository.update(id, input); } }
export class ChangeCollectorStatus { constructor(private readonly repository: CollectorRepository) {} execute(id: string, isActive: boolean) { return this.repository.changeStatus(id, isActive); } }
export class LinkCollectorUser { constructor(private readonly repository: CollectorRepository) {} execute(id: string, userId: string | null) { return this.repository.linkUser(id, userId); } }
export class ListEligibleCollectorUsers { constructor(private readonly repository: CollectorRepository) {} execute() { return this.repository.eligibleUsers(); } }
export class GetCollectorPhoto { constructor(private readonly repository: CollectorRepository) {} execute(id: string) { return this.repository.photo(id); } }
