import type { ChronologicalConsolidation, ConsolidationPlanEntry } from '../../domain/payment/payment-plan-consolidation';

export const PAYMENT_PLAN_CONSOLIDATION_WRITER = Symbol('PAYMENT_PLAN_CONSOLIDATION_WRITER');

export type PaymentPlanConsolidationExecutor = {
  query(sql: string, parameters?: unknown[]): Promise<unknown[]>;
};

export type WritePaymentPlanConsolidation = Readonly<{
  paymentId: string;
  loanId: string;
  effectivePaymentDate: string;
  entriesBefore: ReadonlyArray<ConsolidationPlanEntry>;
  consolidation: ChronologicalConsolidation;
}>;

export type LockedPaymentPlanConsolidation = Readonly<{
  id: string;
  paymentId: string;
  loanId: string;
  effectivePaymentDate: string;
  totalMoved: string;
  target: Readonly<{ planEntryId: string; dueDate: string; sequence: number;
    pendingBefore: string; pendingAfter: string }>;
  sources: ReadonlyArray<Readonly<{ planEntryId: string; dueDate: string; sequence: number;
    amountMoved: string; pendingBefore: string; pendingAfter: string }>>;
  reversalAnnulmentId: string | null;
}>;

export interface PaymentPlanConsolidationWriter {
  write(executor: PaymentPlanConsolidationExecutor, command: WritePaymentPlanConsolidation): Promise<void>;
  lockForReversal(executor: PaymentPlanConsolidationExecutor, paymentId: string,
    loanId: string): Promise<LockedPaymentPlanConsolidation | null>;
  reverse(executor: PaymentPlanConsolidationExecutor, consolidation: LockedPaymentPlanConsolidation,
    paymentAnnulmentId: string): Promise<void>;
}
