export type PaymentReadApplication = {
  paymentId: string;
  planEntryId: string;
  sequence: number;
  amountApplied: string;
  pendingAfter?: string;
  carriedForwardAmount: string;
  carriedToPlanEntryId: string | null;
  sourceDueDate: string;
  createdAt: Date;
};

export type VerifiedPaymentApplication = Pick<PaymentReadApplication, 'planEntryId' | 'sequence' | 'amountApplied' | 'pendingAfter'>;

export interface PaymentApplicationQuery {
  query(sql: string, parameters: unknown[]): Promise<unknown[]>;
}

export async function readPaymentApplications(executor: PaymentApplicationQuery, loanId: string): Promise<PaymentReadApplication[]> {
  return executor.query(`SELECT p.id AS "paymentId", pa.payment_plan_entry_id AS "planEntryId", source.sequence,
    pa.amount_applied::text AS "amountApplied", pa.pending_after::text AS "pendingAfter",
    pa.carried_forward_amount::text AS "carriedForwardAmount",
    pa.carried_to_plan_entry_id AS "carriedToPlanEntryId", source.due_date::text AS "sourceDueDate", pa.created_at AS "createdAt"
    FROM payment_applications pa JOIN payments p ON p.id = pa.payment_id AND p.status = 'VALID'
    JOIN payment_plan_entries source ON source.id = pa.payment_plan_entry_id AND source.loan_id = p.loan_id
    WHERE p.loan_id = $1 AND (pa.amount_applied > 0 OR pa.carried_to_plan_entry_id IS NOT NULL)
    ORDER BY p.payment_date, p.created_at, p.id, pa.created_at, pa.id`, [loanId]) as Promise<PaymentReadApplication[]>;
}

export function attachPaymentApplications<T extends { id: string }>(payments: T[], applications: PaymentReadApplication[]): Array<T & { applications: VerifiedPaymentApplication[] }> {
  const byPayment = new Map<string, VerifiedPaymentApplication[]>();
  for (const application of applications) {
    if (Number(application.amountApplied) <= 0) continue;
    const current = byPayment.get(application.paymentId) ?? [];
    current.push({ planEntryId: application.planEntryId, sequence: application.sequence,
      amountApplied: application.amountApplied, ...(application.pendingAfter === undefined ? {} : { pendingAfter: application.pendingAfter }) });
    byPayment.set(application.paymentId, current);
  }
  return payments.map((payment) => ({ ...payment, applications: byPayment.get(payment.id) ?? [] }));
}
