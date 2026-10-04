import type { DataSource } from 'typeorm';
import type { DailyCollectionPage, DailyCollectionsReader, DailyDueItem, DailyDueSort, DailyReceivedItem, DailyReceivedSort,
  ValidDailyQuery } from '../../../../application/payment/daily-collections.use-case';

const customerName = "concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name)";
const searchFields = `(l.loan_number::text ILIKE $2 OR c.identification ILIKE $2 OR ${customerName} ILIKE $2
  OR c.primary_phone ILIKE $2 OR c.secondary_phone ILIKE $2)`;
const dueSort: Record<DailyDueSort, string> = {
  customer: `lower(${customerName})`, loanNumber: 'l.loan_number', sequence: 'e.sequence',
  dueDate: 'e.due_date', pendingAmount: 'e.pending_amount',
};
const receivedSort: Record<DailyReceivedSort, string> = {
  customer: `lower(${customerName})`, loanNumber: 'l.loan_number', amount: 'p.amount',
};

export class DailyCollectionsTypeormReader implements DailyCollectionsReader {
  constructor(private readonly source: DataSource) {}

  async summary(date: string) {
    const rows: Array<{ dueCount: number; dueAmount: string; paidLoansCount: number; receivedAmount: string }> = await this.source.query(`
      SELECT due."dueCount", due."dueAmount", paid."paidLoansCount", paid."receivedAmount"
      FROM (SELECT COUNT(*)::int AS "dueCount", COALESCE(SUM(e.pending_amount), 0.00)::numeric(38,2)::text AS "dueAmount"
        FROM payment_plan_entries e JOIN loans l ON l.id = e.loan_id
        WHERE e.due_date = $1::date AND e.pending_amount > 0 AND l.status = 'ACTIVE') due
      CROSS JOIN (SELECT COUNT(DISTINCT p.loan_id)::int AS "paidLoansCount",
        COALESCE(SUM(p.amount), 0.00)::numeric(38,2)::text AS "receivedAmount"
        FROM payments p WHERE p.payment_date = $1::date AND p.status = 'VALID') paid`, [date]);
    return rows[0];
  }

  async due(query: ValidDailyQuery<DailyDueSort>): Promise<DailyCollectionPage<DailyDueItem>> {
    const params: unknown[] = [query.date];
    const from = `FROM payment_plan_entries e JOIN loans l ON l.id = e.loan_id JOIN customers c ON c.id = l.customer_id
      WHERE e.due_date = $1::date AND e.pending_amount > 0 AND l.status = 'ACTIVE'`;
    const where = query.search ? `${from} AND ${searchFields}` : from;
    if (query.search) params.push(`%${query.search}%`);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const count: Array<{ total: number }> = await manager.query(`SELECT COUNT(*)::int AS total ${where}`, params);
      const rows: Array<{ planEntryId: string; sequence: number; dueDate: string; pendingAmount: string;
        loanId: string; loanNumber: string; customerId: string; identification: string; fullName: string; primaryPhone: string }> =
        await manager.query(`SELECT e.id AS "planEntryId", e.sequence, e.due_date::text AS "dueDate",
          e.pending_amount::text AS "pendingAmount", l.id AS "loanId", l.loan_number::text AS "loanNumber",
          c.id AS "customerId", c.identification, ${customerName} AS "fullName", c.primary_phone AS "primaryPhone"
          ${where} ORDER BY ${dueSort[query.sortBy]} ${query.sortDir.toUpperCase()},
          lower(${customerName}) ASC, l.loan_number ASC, e.sequence ASC, e.id ASC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize]);
      return { items: rows.map(({ loanId, loanNumber, customerId, identification, fullName, primaryPhone, ...entry }) => ({
        ...entry, loan: { id: loanId, loanNumber }, customer: { id: customerId, identification, fullName, primaryPhone },
      })), total: count[0].total, page: query.page, pageSize: query.pageSize };
    });
  }

  async received(query: ValidDailyQuery<DailyReceivedSort>): Promise<DailyCollectionPage<DailyReceivedItem>> {
    const params: unknown[] = [query.date];
    const from = `FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
      JOIN payment_methods pm ON pm.id = p.method_id LEFT JOIN collectors cl ON cl.id = p.collector_id
      WHERE p.payment_date = $1::date AND p.status = 'VALID'`;
    const where = query.search ? `${from} AND ${searchFields}` : from;
    if (query.search) params.push(`%${query.search}%`);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const count: Array<{ total: number }> = await manager.query(`SELECT COUNT(*)::int AS total ${where}`, params);
      const rows: Array<{ paymentId: string; paymentDate: string; amount: string; loanId: string; loanNumber: string;
        customerId: string; identification: string; fullName: string; methodId: string; methodName: string;
        collectorId: string | null; collectorName: string | null }> =
        await manager.query(`SELECT p.id AS "paymentId", p.payment_date::text AS "paymentDate", p.amount::text AS amount,
          l.id AS "loanId", l.loan_number::text AS "loanNumber", c.id AS "customerId", c.identification,
          ${customerName} AS "fullName", pm.id AS "methodId", pm.name AS "methodName",
          cl.id AS "collectorId", concat_ws(' ', cl.first_name, cl.first_last_name, cl.second_last_name) AS "collectorName"
          ${where} ORDER BY ${receivedSort[query.sortBy]} ${query.sortDir.toUpperCase()}, p.id ASC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize]);
      return { items: rows.map(({ loanId, loanNumber, customerId, identification, fullName,
        methodId, methodName, collectorId, collectorName, ...payment }) => ({ ...payment,
        loan: { id: loanId, loanNumber }, customer: { id: customerId, identification, fullName },
        paymentMethod: { id: methodId, name: methodName },
        collector: collectorId ? { id: collectorId, name: collectorName! } : null,
      })), total: count[0].total, page: query.page, pageSize: query.pageSize };
    });
  }
}
