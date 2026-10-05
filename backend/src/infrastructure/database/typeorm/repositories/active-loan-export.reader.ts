import type { DataSource } from 'typeorm';
import type { ActiveLoanExportCandidate, ActiveLoanExportReader } from '../../../../application/loan/export-active-loans.use-case';
import { LoanFinancialBatchTypeormReader } from './loan-financial-batch.reader';

export class ActiveLoanExportTypeormReader implements ActiveLoanExportReader {
  constructor(private readonly dataSource: DataSource, private readonly financial = new LoanFinancialBatchTypeormReader()) {}

  read() {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const candidates: ActiveLoanExportCandidate[] = await manager.query(`SELECT l.id, l.loan_number::text AS "loanNumber",
        c.identification, concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS "customerName",
        c.primary_phone AS phone, l.start_date::text AS "startDate", l.principal::text AS principal,
        l.interest_amount::text AS "interestAmount", l.total_amount::text AS "totalAmount", pf.name AS "frequencyName",
        latest.due_date::text AS "dueDate", l.status
        FROM loans l JOIN customers c ON c.id = l.customer_id
        JOIN payment_frequencies pf ON pf.id = l.payment_frequency_id
        JOIN LATERAL (SELECT MAX(pe.due_date) AS due_date FROM payment_plan_entries pe WHERE pe.loan_id = l.id) latest ON latest.due_date IS NOT NULL
        WHERE l.status = 'ACTIVE' ORDER BY l.loan_number DESC, l.id ASC`);
      const financial = await this.financial.readLoanFinancialIntegrityBatch(manager, candidates.map((loan) => loan.id));
      return { candidates, financial };
    });
  }
}
