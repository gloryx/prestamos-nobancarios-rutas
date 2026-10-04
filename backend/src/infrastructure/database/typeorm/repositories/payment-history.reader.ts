import type { DataSource } from 'typeorm';
import type { PaymentHistoryItem, PaymentHistoryOptions, PaymentHistoryReader, PaymentHistoryResult,
  PaymentHistorySort, PaymentHistorySummary, ValidPaymentHistoryQuery } from '../../../../application/payment/payment-history.use-case';

const customerName = "concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name)";
const collectorName = "concat_ws(' ', cl.first_name, cl.first_last_name, cl.second_last_name)";
const sorts: Record<PaymentHistorySort, string> = { paymentDate: 'p.payment_date', customer: `lower(${customerName})`,
  loanNumber: 'l.loan_number', amount: 'p.amount', status: 'p.status', principalApplied: 'p.principal_applied',
  interestApplied: 'p.interest_applied' };
type Row = Omit<PaymentHistoryItem, 'loan' | 'customer' | 'paymentMethod' | 'collector' | 'installments'> & {
  loanId: string; loanNumber: string; customerId: string; identification: string; fullName: string;
  primaryPhone: string; methodId: string; methodName: string; collectorId: string | null; collectorName: string | null };

export class PaymentHistoryTypeormReader implements PaymentHistoryReader {
  constructor(private readonly source: DataSource) {}
  async list(query: ValidPaymentHistoryQuery): Promise<PaymentHistoryResult> {
    const params: unknown[] = [];
    const filters: string[] = [];
    const add = (clause: string, value: unknown) => { params.push(value); filters.push(clause.replaceAll('?', `$${params.length}`)); };
    if (query.startDate) add('p.payment_date >= ?::date', query.startDate);
    if (query.endDate) add('p.payment_date <= ?::date', query.endDate);
    if (query.search) add(`(c.identification ILIKE ? OR ${customerName} ILIKE ? OR c.primary_phone ILIKE ? OR c.secondary_phone ILIKE ?)`, `%${query.search}%`);
    if (query.loanNumber) add('l.loan_number::text = ?', query.loanNumber);
    if (query.status) add('p.status = ?', query.status);
    if (query.paymentMethodId) add('p.method_id = ?::uuid', query.paymentMethodId);
    if (query.collectorId) add('p.collector_id = ?::uuid', query.collectorId);
    const from = `FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
      JOIN payment_methods pm ON pm.id = p.method_id LEFT JOIN collectors cl ON cl.id = p.collector_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}`;
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const [summary]: Array<PaymentHistorySummary & { total: number }> = await manager.query(`SELECT
        COUNT(*)::int AS total, COUNT(*) FILTER (WHERE p.status = 'VALID')::int AS "validPaymentsCount",
        COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'VALID'), 0.00)::numeric(38,2)::text AS "receivedAmount",
        COALESCE(SUM(p.principal_applied) FILTER (WHERE p.status = 'VALID'), 0.00)::numeric(38,2)::text AS "principalAppliedAmount",
        COALESCE(SUM(p.interest_applied) FILTER (WHERE p.status = 'VALID'), 0.00)::numeric(38,2)::text AS "interestAppliedAmount"
        ${from}`, params);
      const rows: Row[] = await manager.query(`SELECT p.id AS "paymentId", p.payment_date::text AS "paymentDate",
        p.amount::text AS amount, p.principal_applied::text AS "principalApplied", p.interest_applied::text AS "interestApplied", p.status,
        l.id AS "loanId", l.loan_number::text AS "loanNumber", c.id AS "customerId", c.identification,
        ${customerName} AS "fullName", c.primary_phone AS "primaryPhone", pm.id AS "methodId", pm.name AS "methodName",
        cl.id AS "collectorId", ${collectorName} AS "collectorName"
        ${from} ORDER BY ${sorts[query.sortBy]} ${query.sortDir.toUpperCase()}, p.created_at DESC, p.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, query.pageSize, (query.page - 1) * query.pageSize]);
      const applications: Array<{ paymentId: string; sequence: number }> = rows.length ? await manager.query(`
        SELECT DISTINCT pa.payment_id AS "paymentId", e.sequence FROM payment_applications pa
        JOIN payment_plan_entries e ON e.id = pa.payment_plan_entry_id
        WHERE pa.payment_id = ANY($1::uuid[]) AND pa.amount_applied > 0
        ORDER BY pa.payment_id, e.sequence`, [rows.map((row) => row.paymentId)]) : [];
      const installments = new Map<string, number[]>();
      for (const { paymentId, sequence } of applications) {
        const numbers = installments.get(paymentId) ?? [];
        numbers.push(sequence);
        installments.set(paymentId, numbers);
      }
      return { items: rows.map(({ loanId, loanNumber, customerId, identification, fullName, primaryPhone,
        methodId, methodName, collectorId, collectorName: name, ...payment }) => ({ ...payment,
        loan: { id: loanId, loanNumber }, customer: { id: customerId, identification, fullName, primaryPhone },
        paymentMethod: { id: methodId, name: methodName }, collector: collectorId ? { id: collectorId, name: name! } : null,
        installments: installments.get(payment.paymentId) ?? [] })),
        total: summary.total, page: query.page, pageSize: query.pageSize,
        summary: { validPaymentsCount: summary.validPaymentsCount, receivedAmount: summary.receivedAmount,
          principalAppliedAmount: summary.principalAppliedAmount, interestAppliedAmount: summary.interestAppliedAmount } };
    });
  }
  async options(): Promise<PaymentHistoryOptions> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const paymentMethods: PaymentHistoryOptions['paymentMethods'] = await manager.query(`
        SELECT pm.id, pm.name, pm.is_active AS active FROM payment_methods pm
        WHERE EXISTS (SELECT 1 FROM payments p WHERE p.method_id = pm.id)
        ORDER BY lower(pm.name), pm.id`);
      const collectors: PaymentHistoryOptions['collectors'] = await manager.query(`
        SELECT cl.id, ${collectorName} AS name, cl.is_active AS active FROM collectors cl
        WHERE EXISTS (SELECT 1 FROM payments p WHERE p.collector_id = cl.id)
        ORDER BY lower(${collectorName}), cl.id`);
      return { paymentMethods, collectors };
    });
  }
}
