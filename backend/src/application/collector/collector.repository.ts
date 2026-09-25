import type { Collector, EligibleCollectorUser } from '../../domain/collector/collector.types';

export type CollectorListQuery = { search?: string; status: 'ACTIVE' | 'INACTIVE' | 'ALL'; page: number; pageSize: 10 | 20 | 50 };
export type CollectorCreate = Omit<Collector, 'createdAt' | 'updatedAt' | 'isActive' | 'photoFileKey' | 'userId'> & { id: string; photoFileKey?: string | null; userId?: string | null };
export type CollectorUpdate = Partial<Pick<Collector, 'identification' | 'firstName' | 'firstLastName' | 'secondLastName' | 'phone' | 'alternativePhone' | 'email' | 'birthDate' | 'address' | 'photoFileKey'>>;

export interface CollectorRepository {
  list(query: CollectorListQuery): Promise<{ items: Collector[]; total: number }>;
  findById(id: string): Promise<Collector | null>;
  identificationExists(identification: string, exceptId?: string): Promise<boolean>;
  create(input: CollectorCreate): Promise<Collector>;
  update(id: string, input: CollectorUpdate): Promise<Collector | null>;
  updateStatus(id: string, isActive: boolean): Promise<Collector | null>;
  updateUser(id: string, userId: string | null): Promise<Collector | null>;
  findEligibleUser(id: string): Promise<EligibleCollectorUser | null>;
  userLinkedToAnother(userId: string, collectorId: string): Promise<boolean>;
  listEligibleUsers(): Promise<EligibleCollectorUser[]>;
}
export const COLLECTOR_REPOSITORY = Symbol('COLLECTOR_REPOSITORY');
