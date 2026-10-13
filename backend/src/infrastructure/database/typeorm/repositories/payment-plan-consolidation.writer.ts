import { paymentDateOnlyKey } from '../../../../domain/payment/payment-date-only';
import type { PaymentPlanConsolidationWriter, WritePaymentPlanConsolidation,
  PaymentPlanConsolidationExecutor, LockedPaymentPlanConsolidation } from '../../../../application/payment/payment-plan-consolidation.writer';

export class PaymentPlanConsolidationTypeormWriter implements PaymentPlanConsolidationWriter {
  async write(executor: PaymentPlanConsolidationExecutor, command: WritePaymentPlanConsolidation): Promise<void> {
    const { consolidation } = command;
    const entries = new Map(command.entriesBefore.map((entry) => [entry.id, entry]));
    const target = consolidation.targetPlanEntryId ? entries.get(consolidation.targetPlanEntryId) : undefined;
    if (!target || consolidation.consolidatedAmount === '0.00' || consolidation.traces.length === 0) {
      throw new Error('A complete payment plan consolidation is required.');
    }

    const [header] = await executor.query(`INSERT INTO payment_plan_consolidations
      (payment_id,loan_id,rule_version,effective_payment_date,target_plan_entry_id,target_due_date,target_sequence,
        target_pending_before,target_pending_after,total_moved)
      VALUES ($1,$2,1,$3,$4,$5,$6,$7::numeric(18,2),$8::numeric(18,2),$9::numeric(18,2)) RETURNING id`,
    [command.paymentId, command.loanId, command.effectivePaymentDate, target.id, paymentDateOnlyKey(target.dueDate),
      target.sequence, target.pendingAmount,
      consolidation.entries.find((entry) => entry.id === target.id)?.pendingAmount, consolidation.consolidatedAmount]) as Array<{ id: string }>;
    if (!header?.id) throw new Error('The payment plan consolidation header was not persisted.');

    for (const [index, trace] of consolidation.traces.entries()) {
      const source = entries.get(trace.sourcePlanEntryId);
      if (!source) throw new Error('A payment plan consolidation source is unavailable.');
      await executor.query(`INSERT INTO payment_plan_consolidation_sources
        (consolidation_id,loan_id,ordinal,source_plan_entry_id,source_due_date,source_sequence,amount_moved,
          source_pending_before,source_pending_after)
        VALUES ($1,$2,$3,$4,$5,$6,$7::numeric(18,2),$8::numeric(18,2),0)`,
      [header.id, command.loanId, index + 1, source.id, paymentDateOnlyKey(source.dueDate), source.sequence,
        trace.amount, source.pendingAmount]);
    }

    for (const mutation of consolidation.mutations) {
      await executor.query(`UPDATE payment_plan_entries SET pending_amount = $1::numeric(18,2), updated_at = now()
        WHERE id = $2 AND loan_id = $3 AND pending_amount = $4::numeric(18,2)`,
      [mutation.pendingAfter, mutation.planEntryId, command.loanId, mutation.pendingBefore]);
      const [persisted] = await executor.query(`SELECT pending_amount::text AS "pendingAmount"
        FROM payment_plan_entries WHERE id = $1 AND loan_id = $2`, [mutation.planEntryId, command.loanId]) as Array<{ pendingAmount: string }>;
      if (!persisted || persisted.pendingAmount !== mutation.pendingAfter) {
        throw new Error('A payment plan consolidation mutation did not reconcile.');
      }
    }
  }

  async lockForReversal(executor: PaymentPlanConsolidationExecutor, paymentId: string,
    loanId: string): Promise<LockedPaymentPlanConsolidation | null> {
    const [header] = await executor.query(`SELECT id, payment_id AS "paymentId", loan_id AS "loanId",
      effective_payment_date::text AS "effectivePaymentDate", total_moved::text AS "totalMoved",
      target_plan_entry_id AS "targetPlanEntryId", target_due_date::text AS "targetDueDate",
      target_sequence AS "targetSequence", target_pending_before::text AS "targetPendingBefore",
      target_pending_after::text AS "targetPendingAfter"
      FROM payment_plan_consolidations WHERE payment_id = $1 FOR UPDATE`, [paymentId]) as Array<{
      id: string; paymentId: string; loanId: string; effectivePaymentDate: string; totalMoved: string;
      targetPlanEntryId: string; targetDueDate: string; targetSequence: number;
      targetPendingBefore: string; targetPendingAfter: string;
    }>;
    if (!header) return null;
    if (header.paymentId !== paymentId || header.loanId !== loanId) {
      throw new Error('The payment plan consolidation identity does not reconcile.');
    }
    const sources = await executor.query(`SELECT source_plan_entry_id AS "planEntryId",
      source_due_date::text AS "dueDate", source_sequence AS sequence, amount_moved::text AS "amountMoved",
      source_pending_before::text AS "pendingBefore", source_pending_after::text AS "pendingAfter"
      FROM payment_plan_consolidation_sources WHERE consolidation_id = $1 ORDER BY ordinal FOR UPDATE`,
    [header.id]) as Array<{ planEntryId: string; dueDate: string; sequence: number; amountMoved: string;
      pendingBefore: string; pendingAfter: string }>;
    const [reversal] = await executor.query(`SELECT payment_annulment_id AS "paymentAnnulmentId"
      FROM payment_plan_consolidation_reversals WHERE consolidation_id = $1 FOR UPDATE`, [header.id]) as Array<{
      paymentAnnulmentId: string;
    }>;
    return {
      id: header.id, paymentId: header.paymentId, loanId: header.loanId,
      effectivePaymentDate: header.effectivePaymentDate, totalMoved: header.totalMoved,
      target: { planEntryId: header.targetPlanEntryId, dueDate: header.targetDueDate,
        sequence: header.targetSequence, pendingBefore: header.targetPendingBefore,
        pendingAfter: header.targetPendingAfter },
      sources, reversalAnnulmentId: reversal?.paymentAnnulmentId ?? null,
    };
  }

  async reverse(executor: PaymentPlanConsolidationExecutor, consolidation: LockedPaymentPlanConsolidation,
    paymentAnnulmentId: string): Promise<void> {
    const mutations = [
      { planEntryId: consolidation.target.planEntryId, pendingBefore: consolidation.target.pendingAfter,
        pendingAfter: consolidation.target.pendingBefore },
      ...consolidation.sources.map((source) => ({ planEntryId: source.planEntryId,
        pendingBefore: source.pendingAfter, pendingAfter: source.pendingBefore })),
    ];
    for (const mutation of mutations) {
      await executor.query(`UPDATE payment_plan_entries SET pending_amount = $1::numeric(18,2), updated_at = now()
        WHERE id = $2 AND loan_id = $3 AND pending_amount = $4::numeric(18,2)`,
      [mutation.pendingAfter, mutation.planEntryId, consolidation.loanId, mutation.pendingBefore]);
      const [persisted] = await executor.query(`SELECT pending_amount::text AS "pendingAmount"
        FROM payment_plan_entries WHERE id = $1 AND loan_id = $2`,
      [mutation.planEntryId, consolidation.loanId]) as Array<{ pendingAmount: string }>;
      if (!persisted || persisted.pendingAmount !== mutation.pendingAfter) {
        throw new Error('A payment plan consolidation reversal mutation did not reconcile.');
      }
    }
    const [reversal] = await executor.query(`INSERT INTO payment_plan_consolidation_reversals
      (consolidation_id,payment_annulment_id) VALUES ($1,$2) RETURNING id`,
    [consolidation.id, paymentAnnulmentId]) as Array<{ id: string }>;
    if (!reversal?.id) throw new Error('The payment plan consolidation reversal was not persisted.');
  }
}
