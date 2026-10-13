import type { PaymentPlanConsolidationHistory, PaymentPlanConsolidationHistoryReader } from
  '../../../../application/payment/payment-plan-consolidation-history.reader';

type QueryExecutor = { query(sql: string, parameters?: unknown[]): Promise<unknown[]> };
type HistoryRow = {
  id: string; paymentId: string; effectivePaymentDate: string; totalMoved: string;
  targetPlanEntryId: string; targetDueDate: string; targetSequence: number;
  targetPendingBefore: string; targetPendingAfter: string;
  sourcePlanEntryId: string; sourceDueDate: string; sourceSequence: number; amountMoved: string;
  reversalId: string | null; paymentAnnulmentId: string | null;
};

export class PaymentPlanConsolidationHistoryTypeormReader implements PaymentPlanConsolidationHistoryReader {
  constructor(private readonly source: QueryExecutor) {}

  async read(loanId: string): Promise<PaymentPlanConsolidationHistory[]> {
    const rows = await this.source.query(`SELECT header.id, header.payment_id AS "paymentId",
      header.effective_payment_date::text AS "effectivePaymentDate", header.total_moved::text AS "totalMoved",
      header.target_plan_entry_id AS "targetPlanEntryId", header.target_due_date::text AS "targetDueDate",
      header.target_sequence AS "targetSequence", header.target_pending_before::text AS "targetPendingBefore",
      header.target_pending_after::text AS "targetPendingAfter",
      source.source_plan_entry_id AS "sourcePlanEntryId", source.source_due_date::text AS "sourceDueDate",
      source.source_sequence AS "sourceSequence", source.amount_moved::text AS "amountMoved",
      reversal.id AS "reversalId", reversal.payment_annulment_id AS "paymentAnnulmentId"
      FROM payment_plan_consolidations header
      JOIN payment_plan_consolidation_sources source ON source.consolidation_id = header.id
      LEFT JOIN payment_plan_consolidation_reversals reversal ON reversal.consolidation_id = header.id
      WHERE header.loan_id = $1
      ORDER BY header.effective_payment_date, header.created_at, header.id, source.ordinal`, [loanId]) as HistoryRow[];
    const history = new Map<string, PaymentPlanConsolidationHistory>();
    for (const row of rows) {
      let event = history.get(row.id);
      if (!event) {
        event = {
          id: row.id, paymentId: row.paymentId, effectivePaymentDate: row.effectivePaymentDate,
          totalMoved: row.totalMoved, status: row.reversalId ? 'REVERSED' : 'EFFECTIVE',
          target: { planEntryId: row.targetPlanEntryId, dueDate: row.targetDueDate,
            sequence: row.targetSequence, pendingBefore: row.targetPendingBefore,
            pendingAfter: row.targetPendingAfter },
          sources: [], reversal: row.reversalId && row.paymentAnnulmentId
            ? { id: row.reversalId, paymentAnnulmentId: row.paymentAnnulmentId } : null,
        };
        history.set(row.id, event);
      }
      (event.sources as Array<{ planEntryId: string; dueDate: string; sequence: number; amountMoved: string }>).push({
        planEntryId: row.sourcePlanEntryId, dueDate: row.sourceDueDate,
        sequence: row.sourceSequence, amountMoved: row.amountMoved,
      });
    }
    return [...history.values()];
  }
}
