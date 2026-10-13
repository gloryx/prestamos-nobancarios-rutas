export const COLLECTOR_PRECOLLECTION_STATUSES = ['RECORDED', 'SUBMITTED', 'SETTLED', 'REJECTED', 'CANCELLED'] as const;
export type CollectorPrecollectionStatus = (typeof COLLECTOR_PRECOLLECTION_STATUSES)[number];

export const COLLECTOR_CUSTODY_TREATMENTS = ['COLLECTOR_HELD', 'COMPANY_RECEIVED'] as const;
export type CollectorCustodyTreatment = (typeof COLLECTOR_CUSTODY_TREATMENTS)[number];

export type CollectorPrecollection = {
  id: string;
  collectorId: string;
  collectorUserId: string;
  customerId: string;
  loanId: string;
  routeId: string;
  customerRouteAssignmentId: string;
  collectorRouteAssignmentId: string;
  paymentMethodId: string;
  custodyTreatment: CollectorCustodyTreatment;
  amount: string;
  effectiveDate: string;
  reference: string | null;
  notes: string | null;
  status: CollectorPrecollectionStatus;
  recordedByUserId: string;
  recordedAt: string;
  cancelledByUserId: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
};

export type CollectorPrecollectionDetail = CollectorPrecollection & {
  collectorName: string;
  customerName: string;
  customerIdentification: string;
  loanNumber: string;
  routeName: string;
  paymentMethodName: string;
  recordedByName: string;
  cancelledByName: string | null;
};

export type CollectorPrecollectionPage = {
  items: CollectorPrecollectionDetail[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  indicators: { count: number; total: string; cash: string; electronic: string; pending: string; cancelled: string };
  navigation?: { selectedDate: string; today: string; previousDate: string; nextDate: string | null };
};
