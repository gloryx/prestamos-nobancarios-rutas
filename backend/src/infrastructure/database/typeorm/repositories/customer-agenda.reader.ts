import type { DataSource } from 'typeorm';
import type { CustomerAgendaReader, CustomerAgendaResponse, CustomerAgendaScope, ValidCustomerAgendaQuery } from '../../../../application/customer/customer-agenda.use-case';

type CustomerAgendaDatabaseRow = {
  summary: CustomerAgendaResponse['summary'] | string;
  pagination: CustomerAgendaResponse['pagination'] | string;
  options: CustomerAgendaResponse['options'] | string;
  items: CustomerAgendaResponse['items'] | string;
};

const customerName = "CONCAT_WS(' ', customer.first_name, customer.middle_name, customer.first_last_name, customer.second_last_name)";
const collectorName = "CONCAT_WS(' ', collector.first_name, collector.first_last_name, collector.second_last_name)";

export const CUSTOMER_AGENDA_SQL = `
WITH active_loans AS MATERIALIZED (
  SELECT loan.customer_id, COUNT(*)::int AS active_loan_count
  FROM loans loan
  WHERE loan.status = 'ACTIVE'
  GROUP BY loan.customer_id
), classified AS MATERIALIZED (
  SELECT customer.id AS customer_id, ${customerName} AS customer_name,
    customer.identification, customer.primary_phone, active_loans.active_loan_count,
    CASE
      WHEN customer_assignment.id IS NULL THEN 'WITHOUT_ROUTE'
      WHEN route.id IS NULL OR route.is_active = false THEN 'INVALID_ROUTE'
      WHEN collector_assignment.id IS NULL THEN 'WITHOUT_COLLECTOR'
      WHEN collector.id IS NULL OR collector.is_active IS DISTINCT FROM true
        OR collector_user.is_active IS DISTINCT FROM true OR collector_role.is_active IS DISTINCT FROM true
        OR collector_role.code IS DISTINCT FROM 'COLLECTOR' THEN 'INVALID_COLLECTOR'
      ELSE 'ASSIGNED'
    END AS assignment_status,
    route.id AS route_id, route.name AS route_name,
    CASE WHEN route.is_active = true AND collector.id IS NOT NULL AND collector.is_active = true AND collector_user.is_active = true
      AND collector_role.is_active = true AND collector_role.code = 'COLLECTOR' THEN collector.id END AS collector_id,
    CASE WHEN route.is_active = true AND collector.id IS NOT NULL AND collector.is_active = true AND collector_user.is_active = true
      AND collector_role.is_active = true AND collector_role.code = 'COLLECTOR' THEN ${collectorName} END AS collector_name,
    province.code AS province_code, province.name AS province_name,
    canton.code AS canton_code, canton.name AS canton_name,
    district.code AS district_code, district.name AS district_name,
    customer.primary_phone AS search_primary_phone, customer.secondary_phone AS search_secondary_phone
  FROM active_loans
  JOIN customers customer ON customer.id = active_loans.customer_id
  LEFT JOIN customer_addresses address ON address.customer_id = customer.id
  LEFT JOIN districts district ON district.code = address.district_code
  LEFT JOIN cantons canton ON canton.code = district.canton_code
  LEFT JOIN provinces province ON province.code = canton.province_code
  LEFT JOIN customer_route_assignments customer_assignment
    ON customer_assignment.customer_id = customer.id AND customer_assignment.ended_at IS NULL
  LEFT JOIN routes route ON route.id = customer_assignment.route_id
  LEFT JOIN collector_route_assignments collector_assignment
    ON collector_assignment.route_id = customer_assignment.route_id AND collector_assignment.ended_at IS NULL
  LEFT JOIN users collector_user ON collector_user.id = collector_assignment.collector_user_id
  LEFT JOIN roles collector_role ON collector_role.id = collector_user.role_id
  LEFT JOIN LATERAL (
    SELECT candidate.* FROM collectors candidate
    WHERE candidate.user_id = collector_user.id
    ORDER BY candidate.id
    LIMIT 1
  ) collector ON true
  WHERE ($10::uuid IS NULL OR (
    collector_assignment.collector_user_id = $10::uuid
    AND route.is_active = true
    AND collector.id IS NOT NULL AND collector.is_active = true
    AND collector_user.is_active = true
    AND collector_role.is_active = true AND collector_role.code = 'COLLECTOR'
  ))
), filtered AS MATERIALIZED (
  SELECT * FROM classified item
  WHERE ($1::text IS NULL OR item.customer_name ILIKE '%' || $1 || '%'
    OR item.identification ILIKE '%' || $1 || '%'
    OR COALESCE(item.search_primary_phone, '') ILIKE '%' || $1 || '%'
    OR COALESCE(item.search_secondary_phone, '') ILIKE '%' || $1 || '%')
    AND ($2::uuid IS NULL OR (item.assignment_status = 'ASSIGNED' AND item.collector_id = $2::uuid))
    AND ($3::uuid IS NULL OR item.route_id = $3::uuid)
    AND ($4::int IS NULL OR item.province_code = $4::int)
    AND ($5::int IS NULL OR item.canton_code = $5::int)
    AND ($6::int IS NULL OR item.district_code = $6::int)
    AND ($7::text = 'ALL' OR ($7::text = 'ASSIGNED' AND item.assignment_status = 'ASSIGNED')
      OR ($7::text = 'UNASSIGNED' AND item.assignment_status <> 'ASSIGNED'))
), stats AS (
  SELECT COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE assignment_status = 'ASSIGNED')::int AS assigned,
    COUNT(*) FILTER (WHERE assignment_status <> 'ASSIGNED')::int AS unassigned,
    COUNT(*) FILTER (WHERE assignment_status = 'WITHOUT_ROUTE')::int AS without_route,
    COUNT(*) FILTER (WHERE assignment_status = 'WITHOUT_COLLECTOR')::int AS route_without_collector,
    COUNT(*) FILTER (WHERE assignment_status = 'INVALID_ROUTE')::int AS invalid_route,
    COUNT(*) FILTER (WHERE assignment_status = 'INVALID_COLLECTOR')::int AS invalid_collector
  FROM filtered
), page_bounds AS (
  SELECT GREATEST(1, LEAST($9::int, CEIL(stats.total::numeric / $8::int)::int)) AS effective_page
  FROM stats
), page AS (
  SELECT * FROM filtered item
  ORDER BY CASE WHEN item.assignment_status = 'ASSIGNED' THEN 0 ELSE 1 END,
    item.collector_name ASC NULLS LAST, item.route_name ASC NULLS LAST,
    item.customer_name ASC, item.customer_id ASC
  LIMIT $8 OFFSET (((SELECT effective_page FROM page_bounds) - 1) * $8)
), collector_options AS (
  SELECT collector.id, ${collectorName} AS name
  FROM collectors collector
  JOIN users collector_user ON collector_user.id = collector.user_id AND collector_user.is_active = true
  JOIN roles collector_role ON collector_role.id = collector_user.role_id
    AND collector_role.is_active = true AND collector_role.code = 'COLLECTOR'
  WHERE collector.is_active = true AND ($10::uuid IS NULL OR collector_user.id = $10::uuid)
  ORDER BY name, collector.id
), route_options AS (
  SELECT route.id, route.name,
    CASE WHEN collector.id IS NOT NULL AND collector.is_active = true AND collector_user.is_active = true
      AND collector_role.is_active = true AND collector_role.code = 'COLLECTOR' THEN collector.id END AS collector_id
  FROM routes route
  LEFT JOIN collector_route_assignments collector_assignment
    ON collector_assignment.route_id = route.id AND collector_assignment.ended_at IS NULL
  LEFT JOIN users collector_user ON collector_user.id = collector_assignment.collector_user_id
  LEFT JOIN roles collector_role ON collector_role.id = collector_user.role_id
  LEFT JOIN collectors collector ON collector.user_id = collector_user.id
  WHERE route.is_active = true AND ($10::uuid IS NULL OR (
    collector_assignment.collector_user_id = $10::uuid
    AND collector.id IS NOT NULL AND collector.is_active = true
    AND collector_user.is_active = true
    AND collector_role.is_active = true AND collector_role.code = 'COLLECTOR'
  ))
  ORDER BY route.name, route.id
)
SELECT jsonb_build_object(
    'total', stats.total, 'assigned', stats.assigned, 'unassigned', stats.unassigned,
    'withoutRoute', stats.without_route, 'routeWithoutCollector', stats.route_without_collector,
    'invalidRoute', stats.invalid_route, 'invalidCollector', stats.invalid_collector
  ) AS summary,
  jsonb_build_object('page', (SELECT effective_page FROM page_bounds), 'pageSize', $8::int, 'total', stats.total,
    'totalPages', CASE WHEN stats.total = 0 THEN 0 ELSE CEIL(stats.total::numeric / $8::int)::int END) AS pagination,
  jsonb_build_object(
    'collectors', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name, id) FROM collector_options), '[]'::jsonb),
    'routes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'collectorId', collector_id) ORDER BY name, id) FROM route_options), '[]'::jsonb),
    'provinces', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name) ORDER BY name, code)
      FROM (SELECT DISTINCT province_code AS code, province_name AS name FROM classified WHERE province_code IS NOT NULL) province_options), '[]'::jsonb),
    'cantons', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'provinceCode', province_code) ORDER BY name, code)
      FROM (SELECT DISTINCT canton_code AS code, canton_name AS name, province_code FROM classified WHERE canton_code IS NOT NULL) canton_options), '[]'::jsonb),
    'districts', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'cantonCode', canton_code) ORDER BY name, code)
      FROM (SELECT DISTINCT district_code AS code, district_name AS name, canton_code FROM classified WHERE district_code IS NOT NULL) district_options), '[]'::jsonb)
  ) AS options,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'customerId', customer_id, 'customerName', customer_name, 'identification', identification,
    'primaryPhone', primary_phone, 'activeLoanCount', active_loan_count, 'assignmentStatus', assignment_status,
    'route', CASE WHEN route_id IS NULL THEN NULL ELSE jsonb_build_object('id', route_id, 'name', route_name) END,
    'collector', CASE WHEN collector_id IS NULL THEN NULL ELSE jsonb_build_object('id', collector_id, 'name', collector_name) END,
    'territory', CASE WHEN district_code IS NULL THEN NULL ELSE jsonb_build_object(
      'provinceCode', province_code, 'provinceName', province_name, 'cantonCode', canton_code,
      'cantonName', canton_name, 'districtCode', district_code, 'districtName', district_name) END
  ) ORDER BY CASE WHEN assignment_status = 'ASSIGNED' THEN 0 ELSE 1 END,
    collector_name ASC NULLS LAST, route_name ASC NULLS LAST, customer_name ASC, customer_id ASC) FROM page), '[]'::jsonb) AS items
FROM stats`;

const json = <T>(value: T | string): T => typeof value === 'string' ? JSON.parse(value) as T : value;

export class CustomerAgendaTypeOrmReader implements CustomerAgendaReader {
  constructor(private readonly source: DataSource) {}

  async read(query: ValidCustomerAgendaQuery, scope: CustomerAgendaScope): Promise<CustomerAgendaResponse> {
    const rows = await this.source.query(CUSTOMER_AGENDA_SQL, [
      query.search ?? null,
      query.collectorId ?? null,
      query.routeId ?? null,
      query.provinceCode ?? null,
      query.cantonCode ?? null,
      query.districtCode ?? null,
      query.assignmentStatus,
      query.pageSize,
      query.page,
      scope.kind === 'COLLECTOR' ? scope.collectorUserId : null,
    ]) as CustomerAgendaDatabaseRow[];
    const row = rows[0];
    return {
      summary: json(row.summary),
      pagination: json(row.pagination),
      options: json(row.options),
      items: json(row.items),
    };
  }
}
