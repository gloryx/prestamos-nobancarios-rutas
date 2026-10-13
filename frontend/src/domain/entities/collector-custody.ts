export type CollectorCustodyDirection = 'CREDIT' | 'DEBIT';
export type CollectorCustodyEntryType = 'CUSTOMER_COLLECTION' | 'REMITTANCE_TO_COMPANY' | 'COMPANY_TOP_UP' |
  'AUTHORIZED_ADJUSTMENT' | 'REVERSAL' | 'LOAN_DISBURSEMENT';

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
  createdAt: string;
};

export type CollectorCustodySummary = {
  collectorId: string;
  declaredBalance: string;
  confirmedBalance: string;
  pendingAmount: string;
  differenceAmount: string;
};
