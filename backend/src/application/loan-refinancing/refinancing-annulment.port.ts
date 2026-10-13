export type RefinancingAnnulmentType = 'DATA_CORRECTION' | 'CASH_REFUND';

export type RefinancingAnnulmentReason = { code: string; message: string };
export type RefinancingAnnulmentTypeEligibility = {
  eligible: boolean;
  requiresEffectiveDate: boolean;
  reasons: RefinancingAnnulmentReason[];
};
export type RefinancingAnnulmentEligibility = {
  eligible: boolean;
  reasons: RefinancingAnnulmentReason[];
  types: Record<RefinancingAnnulmentType, RefinancingAnnulmentTypeEligibility>;
};

export type RefinancingAnnulmentPayment = {
  id: string;
  status: 'VALID' | 'ANNULLED';
  amount: string;
  principalApplied: string;
  interestApplied: string;
  paymentDate: string;
  applicationCount: number;
  applicationAmount: string;
  applicationsValid: boolean;
  annulmentCount: number;
  annulmentType: RefinancingAnnulmentType | null;
  originalCashCount: number;
  originalCashAmount: string | null;
  originalCashMethodId: string | null;
  originalCashDirection: string | null;
  originalCashConcept: string | null;
  reversalCount: number;
  reversalAmount: string | null;
  reversalMethodId: string | null;
  reversalDirection: string | null;
  reversalConcept: string | null;
  reversalEffectiveDate: string | null;
};

export type RefinancingDisbursementFact = {
  id: string;
  amount: string;
  date: string;
  methodId: string;
  cashMovementId: string | null;
  cashAmount: string | null;
  cashDate: string | null;
  cashMethodId: string | null;
  cashDirection: string | null;
  cashConcept: string | null;
};

export type RefinancingAnnulmentSnapshot = {
  refinancingId: string;
  status: 'CONFIRMED' | 'ANNULLED';
  refinancingDate: string;
  originLoanId: string;
  originLoanNumber: string;
  originStatus: string;
  successorLoanId: string;
  successorLoanNumber: string;
  successorStatus: string;
  customer: { id: string; fullName: string; identification: string };
  outstandingPrincipalTransferred: string;
  capitalizedOutstandingInterest: string;
  newMoneyDisbursed: string;
  newContractualTotal: string;
  originPendingPlanAmount: string;
  successorPendingPlanAmount: string;
  activeChildRefinancingCount: number;
  disbursements: RefinancingDisbursementFact[];
  payments: RefinancingAnnulmentPayment[];
};

export type RefinancingAnnulmentDetail = {
  annulmentId: string;
  refinancingId: string;
  refinancingDate: string;
  annulmentType: RefinancingAnnulmentType;
  effectiveDate: string;
  reason: string;
  annulledAt: Date;
  createdByUserId: string;
  createdBy: { id: string; fullName: string };
  refundPaymentMethodId: string | null;
  refundPaymentMethod: { id: string; name: string } | null;
  cashMovementId: string | null;
  customer: { id: string; fullName: string; identification: string };
  originLoan: { id: string; loanNumber: string; status: 'ACTIVE' };
  successorLoan: { id: string; loanNumber: string; status: 'ANNULLED' };
};

export type RefinancingAnnulmentListQuery = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: 10 | 20 | 50;
  sortBy?: 'refinancingDate' | 'effectiveDate' | 'customer' | 'originLoan' | 'successorLoan' |
    'annulmentType' | 'createdBy' | 'newMoneyDisbursed';
  sortDir?: 'asc' | 'desc';
};

export type RefinancingAnnulmentPaymentMethod = { id: string; name: string };

export type CreateRefinancingAnnulment = {
  refinancingId: string;
  annulmentType: RefinancingAnnulmentType;
  disbursementResolution: 'NOT_DELIVERED' | 'RETURNED_IN_FULL';
  effectiveDate: string;
  reason: string;
  actorId: string;
  refundPaymentMethodId: string | null;
  idempotencyKey: string;
  idempotencyFingerprint: string;
};

export interface RefinancingAnnulmentTransaction {
  readonly context?: unknown;
  lockSnapshot(refinancingId: string): Promise<RefinancingAnnulmentSnapshot | undefined>;
  hasPendingPrecollection(loanIds: string[]): Promise<boolean>;
  lockActivePaymentMethod(paymentMethodId: string): Promise<boolean>;
  findByKey(key: string): Promise<{ annulmentId: string; refinancingId: string; fingerprint: string } | undefined>;
  create(input: CreateRefinancingAnnulment): Promise<RefinancingAnnulmentDetail | undefined>;
  detail(annulmentId: string): Promise<RefinancingAnnulmentDetail | undefined>;
}

export interface RefinancingAnnulmentStore {
  transaction<T>(work: (tx: RefinancingAnnulmentTransaction) => Promise<T>): Promise<T>;
  listAnnulled(query: RefinancingAnnulmentListQuery): Promise<{ items: RefinancingAnnulmentDetail[]; total: number }>;
  listCandidates(query: RefinancingAnnulmentListQuery): Promise<{ items: RefinancingAnnulmentSnapshot[]; total: number }>;
  listActivePaymentMethods(): Promise<RefinancingAnnulmentPaymentMethod[]>;
  detail(annulmentId: string): Promise<RefinancingAnnulmentDetail | undefined>;
}
