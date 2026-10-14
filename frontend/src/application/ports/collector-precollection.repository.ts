import type { CollectorPrecollectionDetail, CollectorPrecollectionPage,
  CollectorPrecollectionStatus } from '../../domain/entities/collector-precollection';

export type CollectorPrecollectionListQuery = {
  date?: string;
  fromDate?: string;
  toDate?: string;
  status?: CollectorPrecollectionStatus;
  search?: string;
  paymentMethodId?: string;
  collectorId?: string;
  routeId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'effectiveDate' | 'recordedAt' | 'amount' | 'status' | 'customer' | 'loanNumber';
  sortDir?: 'asc' | 'desc';
};

export type CreateCollectorPrecollectionInput = {
  customerId: string;
  loanId: string;
  paymentMethodId: string;
  custodyTreatment: 'COLLECTOR_HELD';
  amount: string;
  effectiveDate: string;
  reference?: string;
  notes?: string;
  idempotencyKey: string;
};

export interface CollectorPrecollectionRepository {
  create(input: CreateCollectorPrecollectionInput): Promise<CollectorPrecollectionDetail>;
  mine(query: CollectorPrecollectionListQuery): Promise<CollectorPrecollectionPage>;
  list(query: CollectorPrecollectionListQuery): Promise<CollectorPrecollectionPage>;
  detail(id: string): Promise<CollectorPrecollectionDetail>;
  cancel(id: string, input: { reason: string; idempotencyKey: string }): Promise<CollectorPrecollectionDetail>;
}
