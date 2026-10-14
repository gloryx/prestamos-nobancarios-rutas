export const COLLECTOR_PRECOLLECTION_STATUSES = [
  'RECORDED',
  'SUBMITTED',
  'SETTLED',
  'REJECTED',
  'CANCELLED',
] as const;

export type CollectorPrecollectionStatus = (typeof COLLECTOR_PRECOLLECTION_STATUSES)[number];

export const COLLECTOR_CUSTODY_TREATMENTS = ['COLLECTOR_HELD', 'COMPANY_RECEIVED'] as const;
export type CollectorCustodyTreatment = (typeof COLLECTOR_CUSTODY_TREATMENTS)[number];

export type CollectorPrecollection = {
  id: string;
  receiptNumber: string;
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
  customerBalanceBefore: string;
  customerBalanceAfter: string;
  effectiveDate: string;
  reference: string | null;
  notes: string | null;
  status: CollectorPrecollectionStatus;
  recordedByUserId: string;
  recordedAt: Date;
  cancelledByUserId: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
};

export type CollectorPrecollectionDetail = CollectorPrecollection & {
  collectorName: string;
  customerName: string;
  customerIdentification: string;
  customerPhone: string;
  customerSecondaryPhone: string | null;
  loanNumber: string;
  routeName: string;
  paymentMethodName: string;
  recordedByName: string;
  cancelledByName: string | null;
  financialBalance: string;
  reservedPrecollections: string;
  operationalBalance: string;
};

export type CollectorPrecollectionIndicators = {
  count: number;
  total: string;
  cash: string;
  electronic: string;
  pending: string;
  cancelled: string;
};

export type CollectorPrecollectionDateNavigation = {
  selectedDate: string;
  today: string;
  previousDate: string;
  nextDate: string | null;
};
