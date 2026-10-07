import type { DataSource } from 'typeorm';
import { ACTIVE_LOAN_OVERDUE_SQL } from '../../../../application/loan/active-loan-condition.sql';
import type { AssignedLoanQuery, AssignedLoansReader, AssignedLoansScope } from '../../../../application/loan/assigned-loans.use-case';
import type { LoanSortBy } from '../../../../domain/loan/loan.types';

const pending = `(l.total_amount-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.loan_id=l.id AND p.status='VALID'),0))::numeric(18,2)`;
const customerName = "concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name)";
const collectorScope = (userParameter: string) => `EXISTS (SELECT 1 FROM users su JOIN roles sr ON sr.id=su.role_id AND sr.is_active=true AND sr.code='COLLECTOR'
  JOIN collectors scl ON scl.user_id=su.id AND scl.is_active=true
  JOIN collector_route_assignments cra ON cra.collector_user_id=su.id AND cra.ended_at IS NULL
  JOIN routes r ON r.id=cra.route_id AND r.is_active=true
  JOIN customer_route_assignments ca ON ca.route_id=r.id AND ca.ended_at IS NULL
  JOIN customers sc ON sc.id=ca.customer_id AND sc.is_active=true
  WHERE su.id=${userParameter} AND su.is_active=true AND sc.id=l.customer_id)`;
const sortColumns: Record<LoanSortBy, string> = {
  number: 'l.loan_number', customer: `lower(${customerName})`, startDate: 'l.start_date', principal: 'l.principal',
  interest: 'l.interest_amount', total: 'l.total_amount', frequency: 'lower(pf.name)', pending, condition: '"isOverdue"',
};
const cents = (value: string) => { const [whole, decimal = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0')); };
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

export class AssignedLoansTypeormReader implements AssignedLoansReader {
  constructor(private readonly source: DataSource) {}

  async resolveCollector(userId: string): Promise<boolean> {
    const rows = await this.source.query(`SELECT 1 FROM users u JOIN roles role ON role.id=u.role_id AND role.is_active=true AND role.code='COLLECTOR'
      JOIN collectors cl ON cl.user_id=u.id AND cl.is_active=true WHERE u.id=$1 AND u.is_active=true LIMIT 1`, [userId]);
    return Boolean(rows[0]);
  }

  async list(query: AssignedLoanQuery, access: AssignedLoansScope) {
    const params: unknown[] = []; const conditions = [access.kind === 'ALL' ? 'TRUE' : (params.push(access.collectorUserId), collectorScope(`$${params.length}`))];
    const add = (sql: string, value: unknown) => { params.push(value); conditions.push(sql.replace('?', `$${params.length}`)); };
    conditions.push("l.status = 'ACTIVE'");
    if (query.frequencyId) add('l.payment_frequency_id = ?', query.frequencyId);
    if (query.fromDate) add('l.start_date >= ?', query.fromDate);
    if (query.toDate) add('l.start_date <= ?', query.toDate);
    if (query.search) { params.push(`%${query.search}%`); const p = `$${params.length}`; conditions.push(`(l.loan_number::text ILIKE ${p} OR c.identification ILIKE ${p} OR ${customerName} ILIKE ${p} OR c.primary_phone ILIKE ${p} OR c.secondary_phone ILIKE ${p} OR EXISTS (SELECT 1 FROM customer_addresses cad WHERE cad.customer_id=c.id AND cad.exact_address ILIKE ${p}))`); }
    const sortBy = query.sortBy ?? 'number'; const direction = (query.sortOrder ?? 'desc').toUpperCase();
    const order = sortBy === 'number' ? `l.loan_number ${direction}, l.id ASC` : `${sortColumns[sortBy]} ${direction}, l.loan_number DESC, l.id ASC`;
    const where = conditions.join(' AND '); const offset = (query.page - 1) * query.pageSize;
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const count: Array<{ total: number }> = await manager.query(`SELECT COUNT(*)::int AS total FROM loans l JOIN customers c ON c.id=l.customer_id WHERE ${where}`, params);
      const items = await manager.query(`SELECT l.id,l.loan_number AS "loanNumber",l.status,l.start_date::text AS "startDate",l.principal::text AS principal,
        l.interest_amount::text AS "interestAmount",l.total_amount::text AS "totalAmount",${customerName} AS "customerName",c.identification,c.primary_phone AS "primaryPhone",
        pf.name AS "frequencyName",${pending}::text AS "pendingTotal",next_due.due_date::text AS "nextDueDate",next_due.pending_amount::text AS "nextDueAmount",
        ${ACTIVE_LOAN_OVERDUE_SQL} AS "isOverdue"
        FROM loans l JOIN customers c ON c.id=l.customer_id JOIN payment_frequencies pf ON pf.id=l.payment_frequency_id
        LEFT JOIN LATERAL (SELECT pe.due_date,pe.pending_amount FROM payment_plan_entries pe WHERE pe.loan_id=l.id AND pe.pending_amount>0 ORDER BY pe.due_date,pe.sequence,pe.id LIMIT 1) next_due ON true
        WHERE ${where} ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, query.pageSize, offset]);
      return { items, total: count[0]?.total ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }

  async detail(id: string, access: AssignedLoansScope): Promise<unknown | null> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const params: unknown[] = [id]; const accessSql = access.kind === 'ALL' ? 'TRUE' : (params.push(access.collectorUserId), collectorScope(`$${params.length}`));
      const rows = await manager.query(`SELECT l.id,l.loan_number AS "loanNumber",l.status,l.start_date::text AS "startDate",l.principal::text AS principal,
        l.interest_amount::text AS "interestAmount",l.total_amount::text AS "totalAmount",l.observations,l.updated_at AS "updatedAt",c.id AS "customerId",
        ${customerName} AS "customerName",c.identification,pf.id AS "paymentFrequencyId",pf.name AS "frequencyName",pf.interval_unit AS "intervalUnit",
        pf.interval_value AS "intervalValue",u.full_name AS "createdByName",pm.id AS "preferredPaymentMethodId",pm.name AS "preferredPaymentMethod",
        dm.name AS "disbursementPaymentMethod",${pending}::text AS "pendingTotal"
        FROM loans l JOIN customers c ON c.id=l.customer_id JOIN payment_frequencies pf ON pf.id=l.payment_frequency_id
        JOIN payment_methods pm ON pm.id=l.preferred_payment_method_id LEFT JOIN loan_disbursements d ON d.loan_id=l.id
        LEFT JOIN payment_methods dm ON dm.id=d.payment_method_id JOIN users u ON u.id=l.created_by_user_id WHERE l.id=$1 AND ${accessSql}`, params);
      if (!rows[0]) return null;
      const plan = await manager.query('SELECT id,sequence,due_date::text AS "dueDate",pending_amount::text AS "pendingAmount" FROM payment_plan_entries WHERE loan_id=$1 ORDER BY sequence', [id]);
      const validPayments: Array<{ id: string; amount: string; paymentDate: string; status: 'VALID' }> = await manager.query('SELECT id,amount::text AS amount,payment_date::text AS "paymentDate",status FROM payments WHERE loan_id=$1 AND status=\'VALID\' ORDER BY payment_date,id', [id]);
      const paid = validPayments.reduce((sum, payment) => sum + cents(payment.amount), 0n);
      return { ...rows[0], plan, financialBalance: money(cents(rows[0].totalAmount) - paid), validPayments };
    });
  }
}
