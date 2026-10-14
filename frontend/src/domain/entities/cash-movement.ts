export type CashMovementDirection = 'INFLOW' | 'OUTFLOW';
export type CashMovementConcept = 'CAPITAL_CONTRIBUTION' | 'CAPITAL_WITHDRAWAL' | 'EXTERNAL_INCOME' | 'OPERATING_EXPENSE' | 'LOAN_DISBURSEMENT' | 'CUSTOMER_PAYMENT' | 'REFINANCING_NEW_MONEY_DISBURSEMENT' | 'COLLECTOR_CUSTODY_TRANSFER' | 'REVERSAL';
export const CASH_MOVEMENT_CONCEPT_LABELS: Record<CashMovementConcept, string> = { CAPITAL_CONTRIBUTION: 'Aporte de capital', CAPITAL_WITHDRAWAL: 'Retiro de capital', EXTERNAL_INCOME: 'Ingreso externo', OPERATING_EXPENSE: 'Gasto operativo', LOAN_DISBURSEMENT: 'Desembolso de préstamo', CUSTOMER_PAYMENT: 'Pago de cliente', REFINANCING_NEW_MONEY_DISBURSEMENT: 'Desembolso de dinero nuevo por refinanciamiento', COLLECTOR_CUSTODY_TRANSFER: 'Transferencia a custodia de cobrador', REVERSAL: 'Reversión' };
export function cashMovementConceptLabel(item: { concept: CashMovementConcept; reversedConcept?: CashMovementConcept | null }): string {
  return item.concept === 'REVERSAL' && item.reversedConcept === 'REFINANCING_NEW_MONEY_DISBURSEMENT'
    ? 'Reversión de desembolso por anulación de refinanciamiento'
    : CASH_MOVEMENT_CONCEPT_LABELS[item.concept];
}
export type CashMovement = { id: string; direction: CashMovementDirection; concept: CashMovementConcept; amount: string; movementDate: string; loanNumber?: string | null; reversedConcept?: CashMovementConcept | null; paymentMethod: { id: string; name: string; isActive: boolean }; observations: string | null; reversedMovementId: string | null; createdBy: { id: string; fullName: string }; createdAt: string };
export type CashMovementFilters = { fromDate?: string; toDate?: string; direction?: CashMovementDirection; concept?: CashMovementConcept; paymentMethodId?: string; search?: string; page: number; pageSize: 20 | 50 | 100 };
export type CashMovementSummary = { inflows: string; outflows: string; net: string; currentAvailable: string | null; openingDate: string | null };
