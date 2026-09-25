import type { Collector, CollectorPage, CollectorStatus, EligibleCollectorUser } from '../../domain/entities/collector';

export type CollectorInput = Omit<Collector, 'id' | 'isActive' | 'photoFileKey' | 'userId' | 'user'> & { userId?: string | null; photo?: File };
export type CollectorUpdateInput = Partial<Omit<CollectorInput, 'userId'>> & { photo?: File };
export type CollectorListQuery = { search: string; status: CollectorStatus; page: number; pageSize: 10 | 20 | 50 };

export interface CollectorRepository {
  list(query: CollectorListQuery): Promise<CollectorPage>;
  detail(id: string): Promise<Collector>;
  create(input: CollectorInput): Promise<Collector>;
  update(id: string, input: CollectorUpdateInput): Promise<Collector>;
  changeStatus(id: string, isActive: boolean): Promise<Collector>;
  linkUser(id: string, userId: string | null): Promise<Collector>;
  eligibleUsers(): Promise<EligibleCollectorUser[]>;
  photo(id: string): Promise<Blob>;
}
