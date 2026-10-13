import type {
  CollectorPrecollectionDetail,
  CollectorPrecollectionDateNavigation,
  CollectorPrecollectionIndicators,
  CollectorPrecollectionStatus,
} from '../../domain/collector-precollection/collector-precollection.types';
import type { NormalizedCollectorPrecollectionInput } from '../../domain/collector-precollection/collector-precollection.rules';

export type CollectorPrecollectionSort = 'effectiveDate' | 'recordedAt' | 'amount' | 'status' | 'customer' | 'loanNumber';
export type CollectorPrecollectionListQuery = {
  fromDate: string;
  toDate: string;
  status?: CollectorPrecollectionStatus;
  search?: string;
  paymentMethodId?: string;
  collectorId?: string;
  routeId?: string;
  page: number;
  pageSize: number;
  sortBy: CollectorPrecollectionSort;
  sortDir: 'asc' | 'desc';
};
export type CollectorPrecollectionPage = {
  items: CollectorPrecollectionDetail[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  indicators: CollectorPrecollectionIndicators;
  navigation?: CollectorPrecollectionDateNavigation;
};

export interface CollectorPrecollectionStore {
  create(input: NormalizedCollectorPrecollectionInput, actorUserId: string, fingerprint: string): Promise<CollectorPrecollectionDetail>;
  list(query: CollectorPrecollectionListQuery, actorUserId?: string): Promise<CollectorPrecollectionPage>;
  detail(id: string, actorUserId?: string): Promise<CollectorPrecollectionDetail | null>;
  cancel(id: string, reason: string, idempotencyKey: string, fingerprint: string,
    actorUserId: string, allowGlobal: boolean): Promise<CollectorPrecollectionDetail>;
}

export interface CollectorPrecollectionClock { today(): string; }
