import type { DataSource } from 'typeorm';
import type { OverdueLoansQuery, OverdueLoansReader, OverdueSnapshot, OverdueCandidate } from '../../../../application/loan/overdue-loans.use-case';
import { LoanFinancialBatchTypeormReader } from './loan-financial-batch.reader';

export class OverdueLoansTypeormReader implements OverdueLoansReader {
  constructor(private readonly dataSource: DataSource, private readonly batch = new LoanFinancialBatchTypeormReader()) {}

  read(query: OverdueLoansQuery, today: string): Promise<OverdueSnapshot> {
    const params: unknown[] = [today];
    const where = ["l.status = 'ACTIVE'", 'first.due_date < $1::date'];
    if (query.search) {
      params.push(`%${query.search}%`);
      const p = `$${params.length}`;
      where.push(`(l.loan_number::text ILIKE ${p} OR c.identification ILIKE ${p} OR concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) ILIKE ${p} OR c.primary_phone ILIKE ${p} OR c.secondary_phone ILIKE ${p})`);
    }
    if (query.startDate) { params.push(query.startDate); where.push(`first.due_date >= $${params.length}::date`); }
    if (query.endDate) { params.push(query.endDate); where.push(`first.due_date <= $${params.length}::date`); }
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const candidates: OverdueCandidate[] = await manager.query(`SELECT l.id AS "loanId", l.loan_number::text AS "loanNumber",
        c.id AS "customerId", c.identification, concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) AS "fullName",
        l.start_date::text AS "startDate", l.principal::text AS principal, l.interest_amount::text AS "interestAmount",
        l.total_amount::text AS "totalAmount", first.id AS "firstRowId", first.due_date::text AS "firstOverdueDueDate",
        first.pending_amount::text AS "firstOverdueAmount"
        FROM loans l JOIN customers c ON c.id = l.customer_id
        JOIN LATERAL (SELECT pe.id, pe.due_date, pe.pending_amount FROM payment_plan_entries pe
          WHERE pe.loan_id = l.id AND pe.pending_amount > 0
          ORDER BY pe.due_date ASC, pe.sequence ASC, pe.id ASC LIMIT 1) first ON true
        WHERE ${where.join(' AND ')}`, params);
      const financial = await this.batch.readLoanFinancialIntegrityBatch(manager, candidates.map((row) => row.loanId));
      return { candidates, financial };
    });
  }
}
