import type { DataSource, EntityManager } from 'typeorm';
import type { LoanEditChanges, LoanEditTransaction, LoanEditWriter } from '../../../../application/loan/edit-loan.use-case';
import { LoanEditIdempotencyConflictError, LoanEditOperationsRepository } from './loan-edit-operations.repository';

export class EditLoanTypeormWriter implements LoanEditWriter {
  constructor(private readonly source: DataSource, private readonly operations = new LoanEditOperationsRepository()) {}

  transaction<T>(run: (tx: LoanEditTransaction) => Promise<T>): Promise<T> {
    return this.source.transaction((manager: EntityManager) => run({
      executor: manager,
      lockLoan: async (id) => (await manager.query(`SELECT id, status, start_date::text AS "startDate", principal::text AS principal,
        interest_amount::text AS "interestAmount", total_amount::text AS "totalAmount",
        payment_frequency_id AS "paymentFrequencyId", preferred_payment_method_id AS "preferredPaymentMethodId", observations
        FROM loans WHERE id = $1 FOR UPDATE`, [id]))[0],
      findReplay: (identity) => this.operations.findReplay(manager, identity),
      readPlan: (id) => manager.query(`SELECT id, due_date::text AS "dueDate", pending_amount::text AS "pendingAmount"
        FROM payment_plan_entries WHERE loan_id = $1 ORDER BY due_date, sequence, id FOR UPDATE`, [id]),
      isActiveReference: async (kind, id) => {
        const table = kind === 'frequency' ? 'payment_frequencies' : 'payment_methods';
        return (await manager.query(`SELECT id FROM ${table} WHERE id = $1 AND is_active = true FOR SHARE`, [id])).length === 1;
      },
      updateLoan: async (id, changes: LoanEditChanges) => {
        const fields: string[] = []; const args: unknown[] = [];
        if (changes.paymentFrequencyId !== undefined) { args.push(changes.paymentFrequencyId); fields.push(`payment_frequency_id = $${args.length}`); }
        if (changes.preferredPaymentMethodId !== undefined) { args.push(changes.preferredPaymentMethodId); fields.push(`preferred_payment_method_id = $${args.length}`); }
        if (changes.observations !== undefined) { args.push(changes.observations); fields.push(`observations = $${args.length}`); }
        if (changes.interestAmount !== undefined) { args.push(changes.interestAmount); fields.push(`interest_amount = $${args.length}::numeric(18,2)`); }
        if (changes.totalAmount !== undefined) { args.push(changes.totalAmount); fields.push(`total_amount = $${args.length}::numeric(18,2)`); }
        if (!fields.length) return false;
        args.push(id);
        const raw: unknown = await manager.query(`UPDATE loans SET ${fields.join(', ')}, updated_at = now()
          WHERE id = $${args.length} AND status = 'ACTIVE' RETURNING id`, args);
        return Array.isArray(raw) && Array.isArray(raw[0]) && raw[0].length === 1
          && raw[0][0]?.id?.toLowerCase() === id.toLowerCase() && raw[1] === 1;
      },
      claim: async (identity) => {
        try { return await this.operations.claim(manager, identity); }
        catch (error) {
          if (error instanceof LoanEditIdempotencyConflictError) return undefined;
          throw error;
        }
      },
    }));
  }
}
