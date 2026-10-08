export type PaymentStatus = 'VALID' | 'ANNULLED';
export type PaymentAnnulmentType = 'DATA_CORRECTION' | 'CASH_REFUND';
export type PaymentInput = { loanId: string; amount: string; paymentDate: string; methodId: string; collectorId: string; idempotencyKey: string };
