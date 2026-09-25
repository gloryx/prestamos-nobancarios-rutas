export type CashMovementDirection = 'INFLOW' | 'OUTFLOW';
export type CashMovementConcept = 'CAPITAL_CONTRIBUTION' | 'CAPITAL_WITHDRAWAL' | 'EXTERNAL_INCOME' | 'OPERATING_EXPENSE' | 'LOAN_DISBURSEMENT' | 'CUSTOMER_PAYMENT' | 'REFINANCING_NEW_MONEY_DISBURSEMENT' | 'REVERSAL';
export type CashMovement = { id: string; direction: CashMovementDirection; concept: CashMovementConcept; amount: string; movementDate: string; paymentMethod: { id: string; name: string; isActive: boolean }; observations: string | null; reversedMovementId: string | null; createdBy: { id: string; fullName: string }; createdAt: string };
export type CashMovementFilters = { fromDate?: string; toDate?: string; direction?: CashMovementDirection; concept?: CashMovementConcept; paymentMethodId?: string; search?: string; page: number; pageSize: 20 | 50 | 100 };
export type CashMovementSummary = { inflows: string; outflows: string; net: string; currentAvailable: string | null; openingDate: string | null };
