import type { DataSource } from 'typeorm';
import type { CollectionAgendaCollectorAccess, CollectionAgendaRead, CollectionAgendaReader, CollectionAgendaRow, CollectionAgendaScope, ValidCollectionAgendaQuery } from '../../../../application/payment/collection-agenda.use-case';

type AgendaDatabaseResult = {
  overdueObligations: number;
  overdueCustomers: number;
  overdueAmount: string;
  dueTodayObligations: number;
  dueTodayCustomers: number;
  dueTodayAmount: string;
  upcomingObligations: number;
  upcomingCustomers: number;
  upcomingAmount: string;
  unassignedRoute: number;
  unassignedCollector: number;
  invalidCollector: number;
  invalidRoute: number;
  total: number;
  items: CollectionAgendaRow[] | string;
};

const customerName = "concat_ws(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name)";

export class CollectionAgendaTypeormReader implements CollectionAgendaReader {
  constructor(private readonly source: DataSource) {}

  async resolveCollectorAccess(userId: string, routeId?: string, customerId?: string): Promise<CollectionAgendaCollectorAccess | null> {
    const rows = await this.source.query(`
      SELECT cl.id AS "collectorId",
        CASE WHEN $2::uuid IS NULL THEN true ELSE EXISTS (
          SELECT 1 FROM collector_route_assignments cra
          JOIN routes r ON r.id = cra.route_id AND r.is_active = true
          WHERE cra.collector_user_id = u.id AND cra.ended_at IS NULL AND cra.route_id = $2::uuid
        ) END AS "routeAllowed",
        CASE WHEN $3::uuid IS NULL THEN true ELSE EXISTS (
          SELECT 1 FROM customer_route_assignments ca
          JOIN customers c ON c.id = ca.customer_id AND c.is_active = true
          JOIN routes r ON r.id = ca.route_id AND r.is_active = true
          JOIN collector_route_assignments cra ON cra.route_id = ca.route_id
            AND cra.collector_user_id = u.id AND cra.ended_at IS NULL
          WHERE ca.customer_id = $3::uuid AND ca.ended_at IS NULL
        ) END AS "customerAllowed"
      FROM users u
      JOIN roles role ON role.id = u.role_id AND role.is_active = true AND role.code = 'COLLECTOR'
      JOIN collectors cl ON cl.user_id = u.id AND cl.is_active = true
      WHERE u.id = $1::uuid AND u.is_active = true`, [userId, routeId ?? null, customerId ?? null]) as CollectionAgendaCollectorAccess[];
    if (rows.length !== 1) return null;
    return { collectorId: rows[0].collectorId, routeAllowed: rows[0].routeAllowed, customerAllowed: rows[0].customerAllowed };
  }

  async read(query: ValidCollectionAgendaQuery, scope: CollectionAgendaScope): Promise<CollectionAgendaRead> {
    const params: unknown[] = [query.referenceDate];
    let scopeSql = '';
    if (scope.kind === 'COLLECTOR') {
      params.push(scope.collectorUserId, scope.collectorId);
      scopeSql = `AND cra.collector_user_id = $2::uuid AND cl.id = $3::uuid
          AND r.is_active = true AND cl.is_active = true AND u.is_active = true
          AND role.is_active = true AND role.code = 'COLLECTOR'`;
    }
    const filters: string[] = [];
    const add = (sql: string, value: unknown) => { params.push(value); filters.push(sql.replaceAll('?', `$${params.length}`)); };
    if (query.fromDate) add('o.due_date >= ?::date', query.fromDate);
    if (query.toDate) add('o.due_date <= ?::date', query.toDate);
    if (query.collectorId) add('o.collector_id = ?::uuid', query.collectorId);
    if (query.routeId) add('o.route_id = ?::uuid', query.routeId);
    if (query.customerId) add('o.customer_id = ?::uuid', query.customerId);
    if (query.collectionStatus !== 'ALL') add('o.collection_status = ?', query.collectionStatus);
    if (query.search) add(`(o.customer_name ILIKE ? OR o.identification ILIKE ? OR o.primary_phone ILIKE ? OR COALESCE(o.secondary_phone, '') ILIKE ?)`, `%${query.search}%`);
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    params.push(query.pageSize, (query.page - 1) * query.pageSize);
    const limit = `$${params.length - 1}`;
    const offset = `$${params.length}`;

    const rows = await this.source.query(`
      WITH ranked_pending AS MATERIALIZED (
        SELECT e.id, e.loan_id, e.sequence, e.due_date, e.pending_amount,
          ROW_NUMBER() OVER (PARTITION BY e.loan_id ORDER BY e.due_date ASC, e.sequence ASC, e.id ASC) AS position
        FROM payment_plan_entries e
        JOIN loans l ON l.id = e.loan_id AND l.status = 'ACTIVE'
        WHERE e.pending_amount > 0
      ), obligations AS MATERIALIZED (
        SELECT l.id AS loan_id, l.loan_number::text AS loan_number, e.id AS payment_plan_entry_id,
          e.sequence, e.due_date, e.pending_amount,
          CASE WHEN e.due_date < $1::date THEN 'OVERDUE' WHEN e.due_date = $1::date THEN 'DUE_TODAY' ELSE 'UPCOMING' END AS collection_status,
          c.id AS customer_id, ${customerName} AS customer_name, c.identification,
          c.primary_phone, c.secondary_phone, a.exact_address, a.latitude::text, a.longitude::text,
          (a.property_photo_file_key IS NOT NULL) AS has_property_photo,
          d.name AS district, ct.name AS canton, p.name AS province,
          ca.route_id, r.name AS route_name, cl.id AS collector_id, cra.collector_user_id,
          concat_ws(' ', cl.first_name, cl.first_last_name, cl.second_last_name) AS collector_name,
          CASE
            WHEN ca.id IS NULL THEN 'UNASSIGNED_ROUTE'
            WHEN r.id IS NULL OR r.is_active = false THEN 'INVALID_ROUTE'
            WHEN cra.id IS NULL THEN 'UNASSIGNED_COLLECTOR'
            WHEN cl.id IS NULL OR cl.is_active = false OR u.is_active = false OR role.is_active = false OR role.code <> 'COLLECTOR' THEN 'INVALID_COLLECTOR'
            ELSE 'ASSIGNED'
          END AS assignment_status
        FROM ranked_pending e
        JOIN loans l ON l.id = e.loan_id
        JOIN customers c ON c.id = l.customer_id AND c.is_active = true
        JOIN customer_addresses a ON a.customer_id = c.id
        JOIN districts d ON d.code = a.district_code
        JOIN cantons ct ON ct.code = d.canton_code
        JOIN provinces p ON p.code = ct.province_code
        LEFT JOIN customer_route_assignments ca ON ca.customer_id = c.id AND ca.ended_at IS NULL
        LEFT JOIN routes r ON r.id = ca.route_id
        LEFT JOIN collector_route_assignments cra ON cra.route_id = ca.route_id AND cra.ended_at IS NULL
        LEFT JOIN users u ON u.id = cra.collector_user_id
        LEFT JOIN roles role ON role.id = u.role_id
        LEFT JOIN collectors cl ON cl.user_id = cra.collector_user_id
        WHERE e.position = 1 ${scopeSql}
      ), filtered AS MATERIALIZED (SELECT o.* FROM obligations o ${where}), stats AS (
        SELECT
          COUNT(*) FILTER (WHERE collection_status = 'OVERDUE')::int AS overdue_obligations,
          COUNT(DISTINCT customer_id) FILTER (WHERE collection_status = 'OVERDUE')::int AS overdue_customers,
          COALESCE(SUM(pending_amount) FILTER (WHERE collection_status = 'OVERDUE'), 0)::numeric(38,2)::text AS overdue_amount,
          COUNT(*) FILTER (WHERE collection_status = 'DUE_TODAY')::int AS due_today_obligations,
          COUNT(DISTINCT customer_id) FILTER (WHERE collection_status = 'DUE_TODAY')::int AS due_today_customers,
          COALESCE(SUM(pending_amount) FILTER (WHERE collection_status = 'DUE_TODAY'), 0)::numeric(38,2)::text AS due_today_amount,
          COUNT(*) FILTER (WHERE collection_status = 'UPCOMING')::int AS upcoming_obligations,
          COUNT(DISTINCT customer_id) FILTER (WHERE collection_status = 'UPCOMING')::int AS upcoming_customers,
          COALESCE(SUM(pending_amount) FILTER (WHERE collection_status = 'UPCOMING'), 0)::numeric(38,2)::text AS upcoming_amount,
          COUNT(*) FILTER (WHERE assignment_status = 'UNASSIGNED_ROUTE')::int AS unassigned_route,
          COUNT(*) FILTER (WHERE assignment_status = 'UNASSIGNED_COLLECTOR')::int AS unassigned_collector,
          COUNT(*) FILTER (WHERE assignment_status = 'INVALID_COLLECTOR')::int AS invalid_collector,
          COUNT(*) FILTER (WHERE assignment_status = 'INVALID_ROUTE')::int AS invalid_route,
          COUNT(*)::int AS total
        FROM filtered
      ), page AS (
        SELECT loan_id AS "loanId", loan_number AS "loanNumber", payment_plan_entry_id AS "paymentPlanEntryId",
          sequence, due_date::text AS "dueDate", pending_amount::text AS "pendingAmount", collection_status AS "collectionStatus",
          assignment_status AS "assignmentStatus", customer_id AS "customerId", customer_name AS "customerName",
          identification, primary_phone AS "primaryPhone", secondary_phone AS "secondaryPhone", exact_address AS "exactAddress",
          latitude, longitude, has_property_photo AS "hasPropertyPhoto", district, canton, province,
          route_id AS "routeId", route_name AS "routeName", collector_id AS "collectorId",
          collector_user_id AS "collectorUserId", collector_name AS "collectorName"
        FROM filtered
        ORDER BY due_date ASC, customer_name ASC, loan_number ASC, payment_plan_entry_id ASC
        LIMIT ${limit} OFFSET ${offset}
      )
      SELECT overdue_obligations AS "overdueObligations", overdue_customers AS "overdueCustomers", overdue_amount AS "overdueAmount",
        due_today_obligations AS "dueTodayObligations", due_today_customers AS "dueTodayCustomers", due_today_amount AS "dueTodayAmount",
        upcoming_obligations AS "upcomingObligations", upcoming_customers AS "upcomingCustomers", upcoming_amount AS "upcomingAmount",
        unassigned_route AS "unassignedRoute", unassigned_collector AS "unassignedCollector",
        invalid_collector AS "invalidCollector", invalid_route AS "invalidRoute", total,
        COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY "dueDate", "customerName", "loanNumber", "paymentPlanEntryId") FROM page), '[]'::jsonb) AS items
      FROM stats`, params) as AgendaDatabaseResult[];
    const row = rows[0];
    const items = typeof row.items === 'string' ? JSON.parse(row.items) as CollectionAgendaRow[] : row.items;
    return {
      summary: {
        overdue: { obligations: Number(row.overdueObligations), customers: Number(row.overdueCustomers), amount: row.overdueAmount },
        dueToday: { obligations: Number(row.dueTodayObligations), customers: Number(row.dueTodayCustomers), amount: row.dueTodayAmount },
        upcoming: { obligations: Number(row.upcomingObligations), customers: Number(row.upcomingCustomers), amount: row.upcomingAmount },
      },
      total: Number(row.total),
      issueCounts: { UNASSIGNED_ROUTE: Number(row.unassignedRoute), UNASSIGNED_COLLECTOR: Number(row.unassignedCollector),
        INVALID_COLLECTOR: Number(row.invalidCollector), INVALID_ROUTE: Number(row.invalidRoute) },
      items,
    };
  }
}
