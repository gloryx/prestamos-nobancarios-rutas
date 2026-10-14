export const COLLECTOR_SETTLEMENT_STATUSES = [
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED', 'CANCELLED',
] as const;

export type CollectorSettlementStatus = (typeof COLLECTOR_SETTLEMENT_STATUSES)[number];

export type CollectorSettlement = {
  id: string;
  collectorId: string;
  collectorUserId: string;
  status: CollectorSettlementStatus;
  totalDeclared: string;
  totalConfirmed: string;
  amountDelivered: string;
  retainedAmount: string;
  differenceAmount: string;
  deliveryDate: string | null;
  deliveryPaymentMethodId: string | null;
  deliveryReference: string | null;
  deliveryNotes: string | null;
  reason: string | null;
  createdByUserId: string;
  createdAt: Date;
  submittedByUserId: string | null;
  submittedAt: Date | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
  rejectedByUserId: string | null;
  rejectedAt: Date | null;
  cancelledByUserId: string | null;
  cancelledAt: Date | null;
};

export type CollectorSettlementItem = {
  id: string;
  settlementId: string;
  precollectionId: string;
  customerName: string;
  loanNumber: string;
  effectiveDate: string;
  declaredAmount: string;
  confirmedAmount: string | null;
  paymentId: string | null;
};

export type CollectorSettlementAction = {
  id: string;
  action: 'SUBMIT' | 'REVIEW' | 'REJECT' | 'CANCEL' | 'CONFIRM';
  actorUserId: string;
  reason: string | null;
  createdAt: Date;
};

export type CollectorSettlementDetail = CollectorSettlement & {
  items: CollectorSettlementItem[];
  actions: CollectorSettlementAction[];
};

export type EligibleCollectorPrecollection = {
  id: string;
  receiptNumber: string;
  customerName: string;
  loanNumber: string;
  paymentMethodName: string;
  amount: string;
  effectiveDate: string;
};

export type CollectorSettlementEligibilitySummary = {
  availableCount: number;
  availableAmount: string;
  draftReservedCount: number;
  draftReservedAmount: string;
  submittedOrUnderReviewCount: number;
  submittedOrUnderReviewAmount: string;
};

export type EligibleCollectorPrecollectionPage = {
  items: EligibleCollectorPrecollection[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: CollectorSettlementEligibilitySummary;
};
