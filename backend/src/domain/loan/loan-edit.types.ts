// PATCH /loans/:id body contract.
export type LoanEditPlanEntry = Readonly<{ id: string | null; dueDate: string; pendingAmount: string }>;
export type LoanEditBaseline = Readonly<{
  interestAmount: string;
  paymentFrequencyId: string;
  preferredPaymentMethodId: string;
  observations: string | null;
  financialBalance: string;
  // Snapshot every positive pending row for comparison under the loan lock.
  plan: ReadonlyArray<Readonly<{ id: string; dueDate: string; pendingAmount: string }>>;
}>;

export type LoanEditInput = Readonly<{
  idempotencyKey: string;
  baseline: LoanEditBaseline;
  changes: Readonly<{
    interestAmount?: string;
    paymentFrequencyId?: string;
    preferredPaymentMethodId?: string;
    // Omitted keeps the old value; null or blank clears it after normalization.
    observations?: string | null;
  }>;
  plan?: readonly LoanEditPlanEntry[];
}>;

// Responses and replays return the stored receipt, never the current Loan.
export type LoanEditReceipt = Readonly<{ operationId: string; loanId: string; createdAt: Date }>;
export type LoanEditIdentity = Readonly<{ loanId: string; actorId: string; idempotencyKey: string; fingerprint: string }>;
