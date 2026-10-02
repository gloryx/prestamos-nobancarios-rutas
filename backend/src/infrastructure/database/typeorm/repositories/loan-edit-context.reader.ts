import type { DataSource } from 'typeorm';
import type { LoanEditContextReader, LoanEditContextSnapshot, LoanEditContextLoan, LoanEditOption } from '../../../../application/loan/loan-edit-context.use-case';
import type { LoanFinancialTotalsReader } from '../../../../application/loan/loan-financial-totals.reader';
import type { LoanEditCurrentSnapshot } from '../../../../application/loan/loan-edit.command';

type LoanRow = Omit<LoanEditContextLoan, 'customer'> & { customerId: string; identification: string; customerName: string };

export class LoanEditContextTypeormReader implements LoanEditContextReader {
  constructor(private readonly source: DataSource, private readonly totalsReader: LoanFinancialTotalsReader) {}

  read(id: string): Promise<LoanEditContextSnapshot | undefined> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const rows: LoanRow[] = await manager.query(`SELECT l.id, l.loan_number::text AS "loanNumber", l.status,
        l.start_date::text AS "startDate", l.principal::text AS principal, l.interest_amount::text AS "interestAmount",
        l.total_amount::text AS "totalAmount", l.observations, c.id AS "customerId", c.identification,
        concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS "customerName",
        pf.id AS "paymentFrequencyId", pf.name AS "paymentFrequencyName",
        pm.id AS "preferredPaymentMethodId", pm.name AS "preferredPaymentMethodName"
        FROM loans l JOIN customers c ON c.id = l.customer_id
        JOIN payment_frequencies pf ON pf.id = l.payment_frequency_id
        JOIN payment_methods pm ON pm.id = l.preferred_payment_method_id WHERE l.id = $1`, [id]);
      const row = rows[0];
      if (!row) return undefined;
      const { customerId, identification, customerName, ...rest } = row;
      const loan: LoanEditContextLoan = { ...rest, customer: { id: customerId, identification, fullName: customerName } };
      const plan: LoanEditCurrentSnapshot['plan'] = await manager.query(`SELECT id, due_date::text AS "dueDate",
        pending_amount::text AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1
        ORDER BY due_date, sequence, id`, [id]);
      const totals = await this.totalsReader.readValidTotals(manager, id);
      const paymentFrequencyOptions: LoanEditOption[] = await manager.query(`SELECT id, name, is_active AS active
        FROM payment_frequencies WHERE is_active = true OR id = $1 ORDER BY display_order, name, id`, [loan.paymentFrequencyId]);
      const preferredPaymentMethodOptions: LoanEditOption[] = await manager.query(`SELECT id, name, is_active AS active
        FROM payment_methods WHERE is_active = true OR id = $1 ORDER BY display_order, name, id`, [loan.preferredPaymentMethodId]);
      return { loan, plan, totals, paymentFrequencyOptions, preferredPaymentMethodOptions };
    });
  }
}
