export type PaymentStatus = 'VALID' | 'ANNULLED';
export type PaymentInput = { loanId: string; amount: string; paymentDate: string; methodId: string; collectorId?: string; idempotencyKey: string };
