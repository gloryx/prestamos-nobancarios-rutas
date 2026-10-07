import type { DataSource } from 'typeorm';
import type { DailyCollectionPage, DailyCollectionsReader, DailyCollectionsScope, DailyDueItem, DailyDueSort, DailyReceivedItem, DailyReceivedSort,
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

  async resolveCollector(userId: string): Promise<boolean> {
    const rows = await this.source.query(`SELECT 1 FROM users u JOIN roles role ON role.id=u.role_id AND role.is_active=true AND role.code='COLLECTOR'
      JOIN collectors cl ON cl.user_id=u.id AND cl.is_active=true WHERE u.id=$1 AND u.is_active=true LIMIT 1`, [userId]);
    return Boolean(rows[0]);
  }

  private scope(scope: DailyCollectionsScope | undefined, customerAlias: string, params: unknown[]) {
    if (!scope || scope.kind === 'ALL') return '';
    params.push(scope.collectorUserId);
    const user = `$${params.length}`;
    return ` AND EXISTS (SELECT 1 FROM users su JOIN roles sr ON sr.id=su.role_id AND sr.is_active=true AND sr.code='COLLECTOR'
      JOIN collectors scl ON scl.user_id=su.id AND scl.is_active=true
      JOIN collector_route_assignments scra ON scra.collector_user_id=su.id AND scra.ended_at IS NULL
      JOIN routes srte ON srte.id=scra.route_id AND srte.is_active=true
      JOIN customer_route_assignments sca ON sca.route_id=srte.id AND sca.ended_at IS NULL
      JOIN customers sc ON sc.id=sca.customer_id AND sc.is_active=true
      WHERE su.id=${user} AND su.is_active=true AND sc.id=${customerAlias}.id)`;
  }

  async summary(date: string, scope?: DailyCollectionsScope) {
    const dueParams: unknown[] = [date]; const dueScope = this.scope(scope, 'c', dueParams);
    const paidScope = dueScope.replace('sc.id=c.id', 'sc.id=pc.id');
    const rows: Array<{ dueCount: number; dueAmount: string; paidLoansCount: number; receivedAmount: string }> = await this.source.query(`
      SELECT due."dueCount", due."dueAmount", paid."paidLoansCount", paid."receivedAmount"
      FROM (SELECT COUNT(*)::int AS "dueCount", COALESCE(SUM(e.pending_amount), 0.00)::numeric(38,2)::text AS "dueAmount"
        FROM payment_plan_entries e JOIN loans l ON l.id = e.loan_id JOIN customers c ON c.id=l.customer_id
        WHERE e.due_date = $1::date AND e.pending_amount > 0 AND l.status = 'ACTIVE'${dueScope}) due
      CROSS JOIN (SELECT COUNT(DISTINCT p.loan_id)::int AS "paidLoansCount",
        COALESCE(SUM(p.amount), 0.00)::numeric(38,2)::text AS "receivedAmount"
        FROM payments p JOIN loans pl ON pl.id=p.loan_id JOIN customers pc ON pc.id=pl.customer_id
        WHERE p.payment_date = $1::date AND p.status = 'VALID'${paidScope}) paid`, dueParams);
    return rows[0];
  }

  async due(query: ValidDailyQuery<DailyDueSort>, scope?: DailyCollectionsScope): Promise<DailyCollectionPage<DailyDueItem>> {
    const params: unknown[] = [query.date];
    const from = `FROM payment_plan_entries e JOIN loans l ON l.id = e.loan_id JOIN customers c ON c.id = l.customer_id
      WHERE e.due_date = $1::date AND e.pending_amount > 0 AND l.status = 'ACTIVE'${this.scope(scope, 'c', params)}`;
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

  async received(query: ValidDailyQuery<DailyReceivedSort>, scope?: DailyCollectionsScope): Promise<DailyCollectionPage<DailyReceivedItem>> {
    const params: unknown[] = [query.date];
    const from = `FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
      JOIN payment_methods pm ON pm.id = p.method_id LEFT JOIN collectors cl ON cl.id = p.collector_id
      WHERE p.payment_date = $1::date AND p.status = 'VALID'${this.scope(scope, 'c', params)}`;
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
