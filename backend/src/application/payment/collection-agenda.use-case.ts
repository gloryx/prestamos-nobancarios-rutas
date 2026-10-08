import type { CurrentIdentity } from '../../domain/security/security.types';

export const COLLECTION_AGENDA_STATUSES = ['OVERDUE', 'DUE_TODAY', 'UPCOMING'] as const;
export type CollectionAgendaStatus = (typeof COLLECTION_AGENDA_STATUSES)[number];
export type CollectionAgendaFilterStatus = CollectionAgendaStatus | 'ALL';
export type CollectionAgendaAssignmentStatus = 'ASSIGNED' | 'UNASSIGNED_ROUTE' | 'UNASSIGNED_COLLECTOR' | 'INVALID_COLLECTOR' | 'INVALID_ROUTE';

export type CollectionAgendaQuery = {
  referenceDate?: string;
  fromDate?: string;
  toDate?: string;
  collectorId?: string;
  routeId?: string;
  customerId?: string;
  collectionStatus?: CollectionAgendaFilterStatus;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type ValidCollectionAgendaQuery = Required<Pick<CollectionAgendaQuery, 'referenceDate' | 'collectionStatus' | 'page' | 'pageSize'>> &
  Omit<CollectionAgendaQuery, 'referenceDate' | 'collectionStatus' | 'page' | 'pageSize'>;

export type CollectionAgendaSummaryItem = { obligations: number; customers: number; amount: string };
export type CollectionAgendaSummary = {
  overdue: CollectionAgendaSummaryItem;
  dueToday: CollectionAgendaSummaryItem;
  upcoming: CollectionAgendaSummaryItem;
};

export type CollectionAgendaRow = {
  loanId: string;
  loanNumber: string;
  paymentPlanEntryId: string;
  sequence: number;
  dueDate: string;
  pendingAmount: string;
  overdueAmount: string;
  scheduledAmount: string;
  collectionStatus: CollectionAgendaStatus;
  assignmentStatus: CollectionAgendaAssignmentStatus;
  customerId: string;
  customerName: string;
  identification: string;
  primaryPhone: string;
  secondaryPhone: string | null;
  exactAddress: string;
  latitude: string | null;
  longitude: string | null;
  hasPropertyPhoto: boolean;
  district: string;
  canton: string;
  province: string;
  routeId: string | null;
  routeName: string | null;
  collectorId: string | null;
  collectorUserId: string | null;
  collectorName: string | null;
};

export type CollectionAgendaRead = {
  summary: CollectionAgendaSummary;
  total: number;
  issueCounts: Record<Exclude<CollectionAgendaAssignmentStatus, 'ASSIGNED'>, number>;
  items: CollectionAgendaRow[];
};

export type CollectionAgendaScope =
  | { kind: 'ALL' }
  | { kind: 'COLLECTOR'; collectorId: string; collectorUserId: string };
export type CollectionAgendaCollectorAccess = {
  collectorId: string;
  routeAllowed: boolean;
  customerAllowed: boolean;
};
export interface CollectionAgendaReader {
  resolveCollectorAccess(userId: string, routeId?: string, customerId?: string): Promise<CollectionAgendaCollectorAccess | null>;
  read(query: ValidCollectionAgendaQuery, scope: CollectionAgendaScope): Promise<CollectionAgendaRead>;
}
export const COLLECTION_AGENDA_READER = Symbol('COLLECTION_AGENDA_READER');
export class CollectionAgendaValidationError extends Error {}
export class CollectionAgendaForbiddenError extends Error {}

type AgendaObligation = Pick<CollectionAgendaRow, 'loanId' | 'loanNumber' | 'paymentPlanEntryId' | 'sequence' | 'dueDate' | 'pendingAmount' | 'overdueAmount' | 'scheduledAmount' | 'collectionStatus'>;
type AgendaCustomer = {
  customerId: string;
  customerName: string;
  identification: string;
  primaryPhone: string;
  secondaryPhone: string | null;
  address: { exact: string; district: string; canton: string; province: string };
  coordinates: { latitude: string; longitude: string } | null;
  propertyPhoto: { available: boolean; accessPath: string | null };
  obligations: AgendaObligation[];
};
type AgendaRoute = { routeId: string; routeName: string; customers: AgendaCustomer[] };
type AgendaCollector = { collectorId: string; collectorUserId: string; collectorName: string; routes: AgendaRoute[] };
type AgendaProblemRoute = AgendaRoute & { collectorId?: string; collectorUserId?: string; collectorName?: string };

const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
};
const validUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const costaRicaEconomicDate = (now = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const customerFrom = (row: CollectionAgendaRow): AgendaCustomer => ({
  customerId: row.customerId,
  customerName: row.customerName,
  identification: row.identification,
  primaryPhone: row.primaryPhone,
  secondaryPhone: row.secondaryPhone,
  address: { exact: row.exactAddress, district: row.district, canton: row.canton, province: row.province },
  coordinates: row.latitude !== null && row.longitude !== null ? { latitude: row.latitude, longitude: row.longitude } : null,
  propertyPhoto: { available: row.hasPropertyPhoto, accessPath: row.hasPropertyPhoto ? `/customers/${row.customerId}/files/property` : null },
  obligations: [],
});
const obligationFrom = (row: CollectionAgendaRow): AgendaObligation => ({
  loanId: row.loanId,
  loanNumber: row.loanNumber,
  paymentPlanEntryId: row.paymentPlanEntryId,
  sequence: row.sequence,
  dueDate: row.dueDate,
  pendingAmount: row.pendingAmount,
  overdueAmount: row.overdueAmount,
  scheduledAmount: row.scheduledAmount,
  collectionStatus: row.collectionStatus,
});
const addCustomer = (customers: AgendaCustomer[], row: CollectionAgendaRow) => {
  let customer = customers.find((item) => item.customerId === row.customerId);
  if (!customer) { customer = customerFrom(row); customers.push(customer); }
  customer.obligations.push(obligationFrom(row));
};
const addRoute = (routes: AgendaRoute[], row: CollectionAgendaRow): AgendaRoute => {
  let route = routes.find((item) => item.routeId === row.routeId);
  if (!route) { route = { routeId: row.routeId!, routeName: row.routeName!, customers: [] }; routes.push(route); }
  addCustomer(route.customers, row);
  return route;
};

export class CollectionAgendaUseCase {
  constructor(private readonly reader: CollectionAgendaReader, private readonly now: () => Date = () => new Date()) {}

  async execute(input: CollectionAgendaQuery, actor: CurrentIdentity) {
    let query = this.validate(input);
    let scope: CollectionAgendaScope = { kind: 'ALL' };
    if (!actor.role.isSuperAdmin && actor.role.code === 'COLLECTOR') {
      const access = await this.reader.resolveCollectorAccess(actor.id, query.routeId, query.customerId);
      if (!access) throw new CollectionAgendaForbiddenError('The authenticated user does not have an active collector profile.');
      if (query.collectorId && query.collectorId.toLowerCase() !== access.collectorId.toLowerCase())
        throw new CollectionAgendaForbiddenError('The requested collector is outside the authenticated collector scope.');
      if (!access.routeAllowed) throw new CollectionAgendaForbiddenError('The requested route is outside the authenticated collector scope.');
      if (!access.customerAllowed) throw new CollectionAgendaForbiddenError('The requested customer is outside the authenticated collector scope.');
      query = { ...query, collectorId: access.collectorId };
      scope = { kind: 'COLLECTOR', collectorId: access.collectorId, collectorUserId: actor.id };
    }
    const result = await this.reader.read(query, scope);
    const collectors: AgendaCollector[] = [];
    const withoutRoute: AgendaCustomer[] = [];
    const withoutCollector: AgendaProblemRoute[] = [];
    const invalidCollector: AgendaProblemRoute[] = [];
    const invalidRoute: AgendaProblemRoute[] = [];

    for (const row of result.items) {
      if (row.assignmentStatus === 'UNASSIGNED_ROUTE') { addCustomer(withoutRoute, row); continue; }
      if (row.assignmentStatus === 'UNASSIGNED_COLLECTOR') { addRoute(withoutCollector, row); continue; }
      if (row.assignmentStatus === 'INVALID_ROUTE') { addRoute(invalidRoute, row); continue; }
      if (row.assignmentStatus === 'INVALID_COLLECTOR') {
        const route = addRoute(invalidCollector, row) as AgendaProblemRoute;
        if (row.collectorId) route.collectorId = row.collectorId;
        if (row.collectorUserId) route.collectorUserId = row.collectorUserId;
        if (row.collectorName) route.collectorName = row.collectorName;
        continue;
      }
      let collector = collectors.find((item) => item.collectorId === row.collectorId);
      if (!collector) {
        collector = { collectorId: row.collectorId!, collectorUserId: row.collectorUserId!, collectorName: row.collectorName!, routes: [] };
        collectors.push(collector);
      }
      addRoute(collector.routes, row);
    }

    const labels: Record<Exclude<CollectionAgendaAssignmentStatus, 'ASSIGNED'>, string> = {
      UNASSIGNED_ROUTE: 'Customers with pending obligations have no active route assignment.',
      UNASSIGNED_COLLECTOR: 'Routes with pending obligations have no active collector assignment.',
      INVALID_COLLECTOR: 'Active route assignments reference an inactive or invalid collector.',
      INVALID_ROUTE: 'Active customer assignments reference an inactive or invalid route.',
    };
    const warnings = Object.entries(result.issueCounts)
      .filter(([, obligations]) => obligations > 0)
      .map(([code, obligations]) => ({ code, obligations, message: labels[code as keyof typeof labels] }));

    return {
      referenceDate: query.referenceDate,
      period: { fromDate: query.fromDate ?? null, toDate: query.toDate ?? null },
      summary: result.summary,
      pagination: { page: query.page, pageSize: query.pageSize, totalObligations: result.total, totalPages: Math.ceil(result.total / query.pageSize) },
      collectors,
      unassigned: { withoutRoute, withoutCollector, invalidCollector, invalidRoute },
      warnings,
    };
  }

  private validate(input: CollectionAgendaQuery): ValidCollectionAgendaQuery {
    const referenceDate = input.referenceDate ?? costaRicaEconomicDate(this.now());
    const collectionStatus = input.collectionStatus ?? 'ALL';
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const ids = [input.collectorId, input.routeId, input.customerId].filter((value): value is string => value !== undefined);
    if (!validDate(referenceDate) || (input.fromDate !== undefined && !validDate(input.fromDate)) ||
      (input.toDate !== undefined && !validDate(input.toDate)) || (input.fromDate && input.toDate && input.fromDate > input.toDate) ||
      ![...COLLECTION_AGENDA_STATUSES, 'ALL'].includes(collectionStatus) || ids.some((id) => !validUuid(id)) ||
      (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200)) ||
      !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isSafeInteger(page * pageSize)) throw new CollectionAgendaValidationError('The collection agenda filters are invalid.');
    return { ...input, referenceDate, collectionStatus, page, pageSize, ...(input.search?.trim() ? { search: input.search.trim() } : { search: undefined }) };
  }
}
