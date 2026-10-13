export const PAYMENT_PLAN_CONSOLIDATION_HISTORY_READER = Symbol('PAYMENT_PLAN_CONSOLIDATION_HISTORY_READER');

export type PaymentPlanConsolidationHistory = Readonly<{
  id: string;
  paymentId: string;
  effectivePaymentDate: string;
  totalMoved: string;
  status: 'EFFECTIVE' | 'REVERSED';
  target: Readonly<{ planEntryId: string; dueDate: string; sequence: number;
    pendingBefore: string; pendingAfter: string }>;
  sources: ReadonlyArray<Readonly<{ planEntryId: string; dueDate: string; sequence: number;
    amountMoved: string }>>;
  reversal: Readonly<{ id: string; paymentAnnulmentId: string }> | null;
}>;

export interface PaymentPlanConsolidationHistoryReader {
  read(loanId: string): Promise<PaymentPlanConsolidationHistory[]>;
}
