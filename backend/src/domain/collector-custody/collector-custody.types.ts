export const COLLECTOR_CUSTODY_DIRECTIONS = ['CREDIT', 'DEBIT'] as const;
export type CollectorCustodyDirection = (typeof COLLECTOR_CUSTODY_DIRECTIONS)[number];
export const COLLECTOR_CUSTODY_ENTRY_TYPES = [
  'CUSTOMER_COLLECTION', 'REMITTANCE_TO_COMPANY', 'COMPANY_TOP_UP', 'AUTHORIZED_ADJUSTMENT',
  'REVERSAL', 'LOAN_DISBURSEMENT',
] as const;
export type CollectorCustodyEntryType = (typeof COLLECTOR_CUSTODY_ENTRY_TYPES)[number];

export type CollectorCustodyEntry = {
  id: string;
  collectorId: string;
  direction: CollectorCustodyDirection;
  entryType: CollectorCustodyEntryType;
  amount: string;
  effectiveDate: string;
  paymentMethodId: string | null;
  reference: string | null;
  reason: string | null;
  notes: string | null;
  precollectionId: string | null;
  settlementId: string | null;
  reversedEntryId: string | null;
  createdByUserId: string;
  createdAt: Date;
};

export type CollectorCustodySummary = {
  collectorId: string;
  declaredBalance: string;
  confirmedBalance: string;
  pendingAmount: string;
  differenceAmount: string;
};
