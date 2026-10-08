export type CollectionAgendaStatus = 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING';
export type CollectionAgendaFilterStatus = CollectionAgendaStatus | 'ALL';
export type CollectionAgendaPeriod = 'TODAY' | 'TOMORROW' | 'WEEK' | 'CUSTOM';

export type CollectionAgendaSummaryItem = { obligations: number; customers: number; amount: string };
export type CollectionAgendaObligation = {
  loanId: string;
  loanNumber: string;
  paymentPlanEntryId: string;
  sequence: number;
  dueDate: string;
  pendingAmount: string;
  overdueAmount: string;
  scheduledAmount: string;
  collectionStatus: CollectionAgendaStatus;
};
export type CollectionAgendaCustomer = {
  customerId: string;
  customerName: string;
  identification: string;
  primaryPhone: string;
  secondaryPhone: string | null;
  address: { exact: string; district: string; canton: string; province: string };
  coordinates: { latitude: string; longitude: string } | null;
  propertyPhoto: { available: boolean; accessPath: string | null };
  obligations: CollectionAgendaObligation[];
};
export type CollectionAgendaRoute = { routeId: string; routeName: string; customers: CollectionAgendaCustomer[] };
export type CollectionAgendaCollector = { collectorId: string; collectorUserId: string; collectorName: string; routes: CollectionAgendaRoute[] };
export type CollectionAgendaProblemRoute = CollectionAgendaRoute & { collectorId?: string; collectorUserId?: string; collectorName?: string };
export type CollectionAgendaWarningCode = 'UNASSIGNED_ROUTE' | 'UNASSIGNED_COLLECTOR' | 'INVALID_COLLECTOR' | 'INVALID_ROUTE';

export type CollectionAgendaResult = {
  referenceDate: string;
  period: { fromDate: string | null; toDate: string | null };
  summary: { overdue: CollectionAgendaSummaryItem; dueToday: CollectionAgendaSummaryItem; upcoming: CollectionAgendaSummaryItem };
  pagination: { page: number; pageSize: number; totalObligations: number; totalPages: number };
  collectors: CollectionAgendaCollector[];
  unassigned: {
    withoutRoute: CollectionAgendaCustomer[];
    withoutCollector: CollectionAgendaProblemRoute[];
    invalidCollector: CollectionAgendaProblemRoute[];
    invalidRoute: CollectionAgendaProblemRoute[];
  };
  warnings: Array<{ code: CollectionAgendaWarningCode; obligations: number; message: string }>;
};

export type CollectionAgendaFilters = {
  period: CollectionAgendaPeriod;
  referenceDate: string;
  fromDate: string;
  toDate: string;
  collectorId: string;
  routeId: string;
  collectionStatus: CollectionAgendaFilterStatus;
  search: string;
  page: number;
  pageSize: 20;
};
