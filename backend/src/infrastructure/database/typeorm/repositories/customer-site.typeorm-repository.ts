import { createHash } from 'node:crypto';
import { QueryFailedError, Repository } from 'typeorm';
import type { AssignedCustomer, AssignedCustomerQuery, AssignmentBatchInput, AssignmentWorkspace, AssignmentWorkspaceQuery, CustomerSiteRepository } from '../../../../application/customer-site/customer-site.repository';
import type { CustomerSiteUpdateAuthorization, SiteUpdateScope } from '../../../../domain/customer-site/customer-site.types';
import { CustomerSiteConflictError, CustomerSiteForbiddenError, CustomerSiteNotFoundError } from '../../../../domain/customer-site/customer-site.errors';
import { CantonOrmEntity, CollectorOrmEntity, CustomerAddressOrmEntity, CustomerOrmEntity, CustomerRouteAssignmentOrmEntity, CustomerSiteUpdateAuthorizationOrmEntity, CollectorRouteAssignmentOrmEntity, DistrictOrmEntity, ProvinceOrmEntity, RoleOrmEntity, RouteOrmEntity, UserOrmEntity } from '../entities';

type ActiveCustomerAssignment = { id: string; customerId: string; routeId: string };
type ActiveCollectorAssignment = { id: string; routeId: string; collectorUserId: string };
type WorkspaceCollectorRow = { collectorId: string; collectorUserId: string; name: string };
type WorkspaceRouteRow = { routeId: string; routeName: string; routeActive: boolean; collectorAssignmentId: string | null; collectorUserId: string | null };
type WorkspaceCustomerRow = { customerId: string; name: string; identification: string; phone: string; customerActive: boolean; customerRouteAssignmentId: string; routeId: string };
type WorkspaceUnassignedCustomer = Omit<WorkspaceCustomerRow, 'customerRouteAssignmentId' | 'routeId'> & { cantonName?: string; districtName?: string };
type WorkspaceUnassignedCustomerResult = { items: WorkspaceUnassignedCustomer[]; total: number; totalUnassigned: number };

export const assignmentSnapshotToken = (customers: ActiveCustomerAssignment[], collectors: ActiveCollectorAssignment[]): string => createHash('sha256')
  .update([...customers.map((row) => `C:${row.id}:${row.customerId}:${row.routeId}`), ...collectors.map((row) => `R:${row.id}:${row.routeId}:${row.collectorUserId}`)].sort().join('|'))
  .digest('hex');

const conflictMessage = 'La asignación cambió desde que cargaste la pantalla. Actualiza las asignaciones e inténtalo nuevamente.';
const pgCode = (error: unknown): string | undefined => (error as { code?: string; driverError?: { code?: string } })?.code ?? (error as { driverError?: { code?: string } })?.driverError?.code;

export class CustomerSiteTypeOrmRepository implements CustomerSiteRepository {
  constructor(private readonly customers: Repository<CustomerOrmEntity>, private readonly addresses: Repository<CustomerAddressOrmEntity>, private readonly customerAssignments: Repository<CustomerRouteAssignmentOrmEntity>, private readonly collectorAssignments: Repository<CollectorRouteAssignmentOrmEntity>, private readonly authorizations: Repository<CustomerSiteUpdateAuthorizationOrmEntity>, private readonly users: Repository<UserOrmEntity>, private readonly routes: Repository<RouteOrmEntity>) {}

  async resolveCollectorAccess(collectorUserId: string, routeId?: string) {
    const rows = await this.customers.manager.query(`SELECT cl.id AS "collectorId",
      CASE WHEN $2::uuid IS NULL THEN true ELSE EXISTS (
        SELECT 1 FROM collector_route_assignments cra
        JOIN routes r ON r.id = cra.route_id AND r.is_active = true
        WHERE cra.collector_user_id = u.id AND cra.ended_at IS NULL AND cra.route_id = $2::uuid
      ) END AS "routeAllowed"
      FROM users u
      JOIN roles role ON role.id = u.role_id AND role.code = 'COLLECTOR' AND role.is_active = true
      JOIN collectors cl ON cl.user_id = u.id AND cl.is_active = true
      WHERE u.id = $1::uuid AND u.is_active = true`, [collectorUserId, routeId ?? null]) as Array<{ collectorId: string; routeAllowed: boolean }>;
    if (rows.length !== 1) return null;
    return rows[0];
  }

  async hasCollectorAccess(customerId: string, collectorUserId: string): Promise<boolean> {
    const rows = await this.customers.manager.query(`SELECT 1
      FROM customer_route_assignments ca
      JOIN customers c ON c.id = ca.customer_id AND c.is_active = true
      JOIN routes r ON r.id = ca.route_id AND r.is_active = true
      JOIN collector_route_assignments cra ON cra.route_id = ca.route_id AND cra.ended_at IS NULL
      JOIN users u ON u.id = cra.collector_user_id AND u.is_active = true
      JOIN roles role ON role.id = u.role_id AND role.code = 'COLLECTOR' AND role.is_active = true
      JOIN collectors cl ON cl.user_id = u.id AND cl.is_active = true
      WHERE ca.customer_id = $1::uuid AND cra.collector_user_id = $2::uuid AND ca.ended_at IS NULL`, [customerId, collectorUserId]) as unknown[];
    return rows.length === 1;
  }

  async listAssignedCustomers(collectorUserId: string, query: AssignedCustomerQuery) {
    return this.customers.manager.transaction('REPEATABLE READ', async (manager) => {
      const search = query.search?.trim() ?? '';
      const [result] = await manager.query(`WITH eligible AS MATERIALIZED (
        SELECT c.id, c.identification,
          CONCAT_WS(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS "fullName",
          c.primary_phone AS "primaryPhone", a.latitude, a.longitude,
          (a.property_photo_file_key IS NOT NULL) AS "hasPropertyPhoto", a.site_data_updated_at AS "siteDataUpdatedAt",
          r.id AS "routeId", r.name AS "routeName", c.first_name, c.first_last_name
        FROM customer_route_assignments ca
        JOIN customers c ON c.id = ca.customer_id AND c.is_active = true
        JOIN customer_addresses a ON a.customer_id = c.id
        JOIN routes r ON r.id = ca.route_id AND r.is_active = true
        JOIN collector_route_assignments cra ON cra.route_id = ca.route_id AND cra.ended_at IS NULL
        JOIN users u ON u.id = cra.collector_user_id AND u.is_active = true
        JOIN roles role ON role.id = u.role_id AND role.code = 'COLLECTOR' AND role.is_active = true
        JOIN collectors cl ON cl.user_id = u.id AND cl.is_active = true
        WHERE ca.ended_at IS NULL AND cra.collector_user_id = $1::uuid
          AND ($2 = '' OR CONCAT_WS(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) ILIKE '%' || $2 || '%'
            OR c.identification ILIKE '%' || $2 || '%' OR c.primary_phone ILIKE '%' || $2 || '%'
            OR COALESCE(c.secondary_phone, '') ILIKE '%' || $2 || '%')
          AND ($3::uuid IS NULL OR r.id = $3::uuid)
      ), page AS (
        SELECT * FROM eligible ORDER BY first_name, first_last_name, id LIMIT $4 OFFSET $5
      ) SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', id, 'identification', identification, 'fullName', "fullName", 'primaryPhone', "primaryPhone",
          'latitude', latitude, 'longitude', longitude, 'hasPropertyPhoto', "hasPropertyPhoto", 'siteDataUpdatedAt', "siteDataUpdatedAt",
          'route', JSONB_BUILD_OBJECT('id', "routeId", 'name', "routeName")
        ) ORDER BY first_name, first_last_name, id), '[]'::jsonb) AS items,
        (SELECT COUNT(*)::int FROM eligible) AS total FROM page`, [collectorUserId, search, query.routeId ?? null, query.pageSize, (query.page - 1) * query.pageSize]) as Array<{ items: Array<Record<string, unknown>>; total: number }>;
      const routes = await manager.query(`SELECT DISTINCT r.id, r.name
        FROM collector_route_assignments cra
        JOIN routes r ON r.id = cra.route_id AND r.is_active = true
        JOIN users u ON u.id = cra.collector_user_id AND u.is_active = true
        JOIN roles role ON role.id = u.role_id AND role.code = 'COLLECTOR' AND role.is_active = true
        JOIN collectors cl ON cl.user_id = u.id AND cl.is_active = true
        WHERE cra.collector_user_id = $1::uuid AND cra.ended_at IS NULL
        ORDER BY r.name, r.id`, [collectorUserId]) as Array<{ id: string; name: string }>;
      const items = result.items.map((row) => ({ ...row, latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude) })) as AssignedCustomer[];
      return { items, total: Number(result.total), routes };
    });
  }

  async listAssignedCollectors(customerId: string) {
    const rows = await this.customerAssignments.createQueryBuilder('ca')
      .innerJoin(CustomerOrmEntity, 'c', 'c.id = ca.customer_id AND c.is_active = true')
      .innerJoin(RouteOrmEntity, 'r', 'r.id = ca.route_id AND r.is_active = true')
      .innerJoin(CollectorRouteAssignmentOrmEntity, 'cra', 'cra.route_id = ca.route_id AND cra.ended_at IS NULL')
      .innerJoin(UserOrmEntity, 'u', 'u.id = cra.collector_user_id AND u.is_active = true')
      .innerJoin(RoleOrmEntity, 'role', "role.id = u.role_id AND role.code = 'COLLECTOR' AND role.is_active = true")
      .select(['u.id AS id', 'u.full_name AS "fullName"', 'u.username AS username'])
      .where('ca.customer_id = :customerId AND ca.ended_at IS NULL', { customerId })
      .distinct(true)
      .orderBy('u.full_name', 'ASC')
      .getRawMany();
    return rows.map((row) => ({ id: row.id, fullName: row.fullName, username: row.username }));
  }

  async listRouteAssignmentOptions() {
    const [customers, routes, collectors] = await Promise.all([
      this.customers.createQueryBuilder('c').select(['c.id AS id', 'c.identification AS identification', `CONCAT_WS(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS "fullName"`]).where('c.is_active = true').orderBy('c.first_name', 'ASC').addOrderBy('c.first_last_name', 'ASC').getRawMany(),
      this.routes.createQueryBuilder('r').select(['r.id AS id', 'r.name AS name']).where('r.is_active = true').orderBy('r.name', 'ASC').getRawMany(),
      this.users.createQueryBuilder('u').innerJoin(RoleOrmEntity, 'role', "role.id = u.role_id AND role.code = 'COLLECTOR' AND role.is_active = true").select(['u.id AS id', 'u.full_name AS "fullName"', 'u.username AS username']).where('u.is_active = true').orderBy('u.full_name', 'ASC').getRawMany(),
    ]);
    return { customers, routes, collectors };
  }

  async readAssignmentWorkspace(query: AssignmentWorkspaceQuery): Promise<AssignmentWorkspace> {
    return this.customers.manager.transaction('REPEATABLE READ', async (manager) => {
      const search = query.search?.trim() ?? '';
      const offset = (query.page - 1) * query.pageSize;
      const activeLoanFilter = query.activeLoanFilter ?? 'ALL';
      const collectors = await manager.query(`SELECT c.id AS "collectorId", u.id AS "collectorUserId",
        CONCAT_WS(' ', c.first_name, c.first_last_name, c.second_last_name) AS name
        FROM collectors c JOIN users u ON u.id = c.user_id AND u.is_active = true
        JOIN roles role ON role.id = u.role_id AND role.code = 'COLLECTOR' AND role.is_active = true
        WHERE c.is_active = true ORDER BY c.first_name, c.first_last_name, c.id`) as WorkspaceCollectorRow[];
      const routes = await manager.query(`SELECT r.id AS "routeId", r.name AS "routeName", r.is_active AS "routeActive", cra.id AS "collectorAssignmentId",
        cra.collector_user_id AS "collectorUserId" FROM routes r
        LEFT JOIN collector_route_assignments cra ON cra.route_id = r.id AND cra.ended_at IS NULL
        ORDER BY r.name, r.id`) as WorkspaceRouteRow[];
      const assignedCustomers = await manager.query(`SELECT c.id AS "customerId",
        CONCAT_WS(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS name,
        c.identification, c.primary_phone AS phone, c.is_active AS "customerActive", cra.id AS "customerRouteAssignmentId", cra.route_id AS "routeId"
        FROM customers c JOIN customer_route_assignments cra ON cra.customer_id = c.id AND cra.ended_at IS NULL
        ORDER BY c.first_name, c.first_last_name, c.id`) as WorkspaceCustomerRow[];
       const [unassignedCustomers] = await manager.query(`WITH unassigned AS MATERIALIZED (
          SELECT c.id AS "customerId", CONCAT_WS(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS name,
            c.identification, c.primary_phone AS phone, c.secondary_phone AS "secondaryPhone", c.first_name, c.first_last_name,
            canton.code AS "cantonCode", canton.name AS "cantonName", district.code AS "districtCode", district.name AS "districtName"
          FROM customers c LEFT JOIN customer_route_assignments cra ON cra.customer_id = c.id AND cra.ended_at IS NULL
          LEFT JOIN customer_addresses address ON address.customer_id = c.id
          LEFT JOIN districts district ON district.code = address.district_code
          LEFT JOIN cantons canton ON canton.code = district.canton_code
          WHERE c.is_active = true AND cra.id IS NULL
        ), eligible AS MATERIALIZED (
          SELECT * FROM unassigned WHERE
            ($1 = '' OR name ILIKE '%' || $1 || '%' OR identification ILIKE '%' || $1 || '%' OR phone ILIKE '%' || $1 || '%' OR COALESCE("secondaryPhone", '') ILIKE '%' || $1 || '%')
            AND ($4::int IS NULL OR "cantonCode" = $4)
            AND ($5::int IS NULL OR "districtCode" = $5)
            AND ($6 = 'ALL'
              OR ($6 = 'WITH_ACTIVE' AND EXISTS (SELECT 1 FROM loans loan WHERE loan.customer_id = "customerId" AND loan.status = 'ACTIVE'))
              OR ($6 = 'WITHOUT_ACTIVE' AND NOT EXISTS (SELECT 1 FROM loans loan WHERE loan.customer_id = "customerId" AND loan.status = 'ACTIVE')))
        ), page AS (SELECT * FROM eligible ORDER BY first_name, first_last_name, "customerId" LIMIT $2 OFFSET $3)
        SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('customerId', "customerId", 'name', name, 'identification', identification, 'phone', phone,
          'cantonName', "cantonName", 'districtName', "districtName")
          ORDER BY first_name, first_last_name, "customerId"), '[]'::jsonb) AS items,
          (SELECT COUNT(*)::int FROM eligible) AS total,
          (SELECT COUNT(*)::int FROM unassigned) AS "totalUnassigned" FROM page`, [search, query.pageSize, offset, query.cantonCode ?? null, query.districtCode ?? null, activeLoanFilter]) as WorkspaceUnassignedCustomerResult[];

      const collectorMap = new Map(collectors.map((row) => [row.collectorUserId, { ...row, active: true as const, routes: [] as AssignmentWorkspace['unassignedRoutes'] }]));
      const routeMap = new Map<string, AssignmentWorkspace['unassignedRoutes'][number]>();
      const seenRoutes = new Set<string>();
      const unassignedRoutes: AssignmentWorkspace['unassignedRoutes'] = [];
      const activeCollectorAssignments: ActiveCollectorAssignment[] = [];
      for (const row of routes) {
        if (seenRoutes.has(row.routeId)) throw new CustomerSiteConflictError('Existen varias asignaciones activas para una ruta. Debe sanearlas antes de continuar.');
        seenRoutes.add(row.routeId);
        if (row.collectorAssignmentId && row.collectorUserId) activeCollectorAssignments.push({ id: row.collectorAssignmentId, routeId: row.routeId, collectorUserId: row.collectorUserId });
        if (!row.routeActive) continue;
        const route = { routeId: row.routeId, routeName: row.routeName, ...(row.collectorAssignmentId ? { collectorAssignmentId: row.collectorAssignmentId } : {}), customers: [] };
        routeMap.set(row.routeId, route);
        if (!row.collectorAssignmentId || !row.collectorUserId) unassignedRoutes.push(route);
        else {
          const collector = collectorMap.get(row.collectorUserId);
          if (!collector) throw new CustomerSiteConflictError('Una ruta tiene una asignación activa hacia un cobrador no elegible. Debe sanearla antes de continuar.');
          collector.routes.push(route);
        }
      }
      const seenCustomers = new Set<string>();
      const activeCustomerAssignments: ActiveCustomerAssignment[] = [];
      for (const row of assignedCustomers) {
        if (seenCustomers.has(row.customerId)) throw new CustomerSiteConflictError('Existen varias asignaciones activas para un cliente. Debe sanearlas antes de continuar.');
        seenCustomers.add(row.customerId);
        activeCustomerAssignments.push({ id: row.customerRouteAssignmentId, customerId: row.customerId, routeId: row.routeId });
        if (!row.customerActive) continue;
        const route = routeMap.get(row.routeId);
        if (!route) throw new CustomerSiteConflictError('Un cliente tiene una asignación activa hacia una ruta inactiva. Debe sanearla antes de continuar.');
        route.customers.push({ customerId: row.customerId, name: row.name, identification: row.identification, phone: row.phone, customerRouteAssignmentId: row.customerRouteAssignmentId });
      }
      return {
        snapshotToken: assignmentSnapshotToken(activeCustomerAssignments, activeCollectorAssignments),
        collectors: [...collectorMap.values()],
        unassignedRoutes,
        unassignedCustomers: { items: unassignedCustomers.items, total: Number(unassignedCustomers.total), totalUnassigned: Number(unassignedCustomers.totalUnassigned), page: query.page, pageSize: query.pageSize },
      };
    });
  }

  async applyAssignmentBatch(input: AssignmentBatchInput): Promise<{ applied: number; snapshotToken: string }> {
    try {
      return await this.customers.manager.transaction(async (manager) => {
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext('route-assignments-batch'))`);
        const customerRows = await manager.query(`SELECT id, customer_id AS "customerId", route_id AS "routeId"
          FROM customer_route_assignments WHERE ended_at IS NULL ORDER BY customer_id, id FOR UPDATE`) as ActiveCustomerAssignment[];
        const collectorRows = await manager.query(`SELECT id, route_id AS "routeId", collector_user_id AS "collectorUserId"
          FROM collector_route_assignments WHERE ended_at IS NULL ORDER BY route_id, id FOR UPDATE`) as ActiveCollectorAssignment[];
        if (assignmentSnapshotToken(customerRows, collectorRows) !== input.snapshotToken) throw new CustomerSiteConflictError(conflictMessage);

        const routeIds = [...new Set(input.operations.flatMap((operation) => operation.type === 'UNASSIGN_CUSTOMER_FROM_ROUTE' ? [] : [operation.routeId]))];
        const customerIds = [...new Set(input.operations.flatMap((operation) => operation.type === 'ASSIGN_CUSTOMER_TO_ROUTE' || operation.type === 'MOVE_CUSTOMER_TO_ROUTE' || operation.type === 'UNASSIGN_CUSTOMER_FROM_ROUTE' ? [operation.customerId] : []))];
        const collectorUserIds = [...new Set(input.operations.flatMap((operation) => operation.type === 'ASSIGN_ROUTE_TO_COLLECTOR' || operation.type === 'MOVE_ROUTE_TO_COLLECTOR' ? [operation.collectorUserId] : []))];
        const activeRoutes = routeIds.length ? await manager.query('SELECT id FROM routes WHERE id = ANY($1::uuid[]) AND is_active = true FOR SHARE', [routeIds]) as Array<{ id: string }> : [];
        const activeCustomers = customerIds.length ? await manager.query('SELECT id FROM customers WHERE id = ANY($1::uuid[]) AND is_active = true FOR SHARE', [customerIds]) as Array<{ id: string }> : [];
        const eligibleCollectors = collectorUserIds.length ? await manager.query(`SELECT u.id FROM collectors c
          JOIN users u ON u.id = c.user_id AND u.is_active = true JOIN roles role ON role.id = u.role_id AND role.code = 'COLLECTOR' AND role.is_active = true
          WHERE c.is_active = true AND u.id = ANY($1::uuid[]) FOR SHARE OF c, u, role`, [collectorUserIds]) as Array<{ id: string }> : [];
        if (activeRoutes.length !== routeIds.length) throw new CustomerSiteNotFoundError('Una de las rutas no existe o está inactiva.');
        if (activeCustomers.length !== customerIds.length) throw new CustomerSiteNotFoundError('Uno de los clientes no existe o está inactivo.');
        if (eligibleCollectors.length !== collectorUserIds.length) throw new CustomerSiteNotFoundError('El cobrador no existe, está inactivo o no tiene un usuario activo vinculado.');

        const customers = new Map(customerRows.map((row) => [row.customerId, row]));
        const routes = new Map(collectorRows.map((row) => [row.routeId, row]));
        if (customers.size !== customerRows.length || routes.size !== collectorRows.length) throw new CustomerSiteConflictError('Existen asignaciones activas duplicadas. Debe sanearlas antes de continuar.');
        const at = new Date();
        const end = async (table: 'customer_route_assignments' | 'collector_route_assignments', id: string): Promise<void> => {
          const ended = await manager.query(`UPDATE ${table} SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL RETURNING id`, [id, at]) as Array<{ id: string }>;
          if (!ended.length) throw new CustomerSiteConflictError(conflictMessage);
        };
        const insertCustomer = async (customerId: string, routeId: string): Promise<ActiveCustomerAssignment> => {
          const [created] = await manager.query(`INSERT INTO customer_route_assignments (customer_id, route_id, assigned_by_user_id, assigned_at)
            VALUES ($1,$2,$3,$4) RETURNING id, customer_id AS "customerId", route_id AS "routeId"`, [customerId, routeId, input.actorId, at]) as ActiveCustomerAssignment[];
          return created;
        };
        const insertCollector = async (routeId: string, collectorUserId: string): Promise<ActiveCollectorAssignment> => {
          const [created] = await manager.query(`INSERT INTO collector_route_assignments (route_id, collector_user_id, assigned_by_user_id, assigned_at)
            VALUES ($1,$2,$3,$4) RETURNING id, route_id AS "routeId", collector_user_id AS "collectorUserId"`, [routeId, collectorUserId, input.actorId, at]) as ActiveCollectorAssignment[];
          return created;
        };

        for (const operation of input.operations) {
          if (operation.type === 'ASSIGN_CUSTOMER_TO_ROUTE') {
            if (customers.has(operation.customerId)) throw new CustomerSiteConflictError(conflictMessage);
            customers.set(operation.customerId, await insertCustomer(operation.customerId, operation.routeId));
          } else if (operation.type === 'MOVE_CUSTOMER_TO_ROUTE') {
            const current = customers.get(operation.customerId);
            if (!current || current.id !== operation.expectedAssignmentId || current.routeId === operation.routeId) throw new CustomerSiteConflictError(conflictMessage);
            await end('customer_route_assignments', current.id);
            customers.set(operation.customerId, await insertCustomer(operation.customerId, operation.routeId));
          } else if (operation.type === 'UNASSIGN_CUSTOMER_FROM_ROUTE') {
            const current = customers.get(operation.customerId);
            if (!current || current.id !== operation.expectedAssignmentId) throw new CustomerSiteConflictError(conflictMessage);
            await end('customer_route_assignments', current.id);
            customers.delete(operation.customerId);
          } else if (operation.type === 'ASSIGN_ROUTE_TO_COLLECTOR') {
            if (routes.has(operation.routeId)) throw new CustomerSiteConflictError(conflictMessage);
            routes.set(operation.routeId, await insertCollector(operation.routeId, operation.collectorUserId));
          } else if (operation.type === 'MOVE_ROUTE_TO_COLLECTOR') {
            const current = routes.get(operation.routeId);
            if (!current || current.id !== operation.expectedAssignmentId || current.collectorUserId === operation.collectorUserId) throw new CustomerSiteConflictError(conflictMessage);
            await end('collector_route_assignments', current.id);
            routes.set(operation.routeId, await insertCollector(operation.routeId, operation.collectorUserId));
          } else {
            const current = routes.get(operation.routeId);
            if (!current || current.id !== operation.expectedAssignmentId) throw new CustomerSiteConflictError(conflictMessage);
            await end('collector_route_assignments', current.id);
            routes.delete(operation.routeId);
          }
        }
        return { applied: input.operations.length, snapshotToken: assignmentSnapshotToken([...customers.values()], [...routes.values()]) };
      });
    } catch (error) {
      if (pgCode(error) === '23505') throw new CustomerSiteConflictError(conflictMessage);
      throw error;
    }
  }

  async createCustomerAssignment(input: { customerId: string; routeId: string; assignedByUserId: string }) {
    const [customer, route] = await Promise.all([this.customers.findOneBy({ id: input.customerId, isActive: true }), this.routes.findOneBy({ id: input.routeId, isActive: true })]);
    if (!customer || !route) throw new CustomerSiteNotFoundError('El cliente o la ruta no están activos.');
    try { return await this.customerAssignments.save(this.customerAssignments.create(input)); } catch (error) { if (error instanceof QueryFailedError) throw new CustomerSiteConflictError('No se pudo crear la asignación.'); throw error; }
  }
  async createCollectorAssignment(input: { routeId: string; collectorUserId: string; assignedByUserId: string }) {
    const [user, route] = await Promise.all([this.users.createQueryBuilder('u').innerJoinAndSelect('u.role', 'role').innerJoin(CollectorOrmEntity, 'collector', 'collector.user_id = u.id AND collector.is_active = true').where('u.id = :id AND u.is_active = true AND role.code = :code AND role.is_active = true', { id: input.collectorUserId, code: 'COLLECTOR' }).getOne(), this.routes.findOneBy({ id: input.routeId, isActive: true })]);
    if (!user) throw new CustomerSiteNotFoundError('El cobrador no existe, está inactivo o no tiene un usuario activo vinculado.');
    if (!route) throw new CustomerSiteNotFoundError('La ruta no existe o está inactiva.');
    try { return await this.collectorAssignments.save(this.collectorAssignments.create(input)); } catch (error) { if (error instanceof QueryFailedError) throw new CustomerSiteConflictError('No se pudo crear la asignación.'); throw error; }
  }
  private async end(repo: Repository<CustomerRouteAssignmentOrmEntity> | Repository<CollectorRouteAssignmentOrmEntity>, id: string, endedAt: Date): Promise<void> { const result = await repo.createQueryBuilder().update().set({ endedAt } as never).where('id = :id AND ended_at IS NULL', { id }).execute(); if (!result.affected) throw new CustomerSiteNotFoundError('La asignación no existe o ya finalizó.'); }
  endCustomerAssignment(id: string, endedAt: Date) { return this.end(this.customerAssignments, id, endedAt); }
  endCollectorAssignment(id: string, endedAt: Date) { return this.end(this.collectorAssignments, id, endedAt); }

  async validateAuthorizationTarget(customerId: string, collectorUserId: string): Promise<void> { if (!(await this.hasCollectorAccess(customerId, collectorUserId))) throw new CustomerSiteConflictError('El cliente y el cobrador no tienen una intersección activa válida.'); }
  private map(row: CustomerSiteUpdateAuthorizationOrmEntity): CustomerSiteUpdateAuthorization { return { id: row.id, customerId: row.customerId, collectorUserId: row.collectorUserId, scope: row.scope as SiteUpdateScope, reason: row.reason, authorizedByUserId: row.authorizedByUserId, authorizedAt: row.authorizedAt, expiresAt: row.expiresAt, usedAt: row.usedAt, revokedAt: row.revokedAt }; }
  async createAuthorization(input: Omit<CustomerSiteUpdateAuthorization, 'id' | 'usedAt' | 'revokedAt'>) { try { return this.map(await this.authorizations.save(this.authorizations.create({ ...input, usedAt: null, revokedAt: null }))); } catch (error) { if (error instanceof QueryFailedError) throw new CustomerSiteConflictError('No se pudo crear la autorización.'); throw error; } }
  async listAuthorizations(customerId: string) { const now = new Date(); return (await this.authorizations.find({ where: { customerId }, order: { authorizedAt: 'DESC' } })).map((row) => ({ ...this.map(row), status: row.revokedAt ? 'REVOKED' : row.usedAt ? 'USED' : row.expiresAt <= now ? 'EXPIRED' : 'ACTIVE' })); }
  async revokeAuthorization(id: string, customerId: string) { const result = await this.authorizations.createQueryBuilder().update().set({ revokedAt: new Date() }).where('id = :id AND customer_id = :customerId AND revoked_at IS NULL AND used_at IS NULL', { id, customerId }).execute(); if (!result.affected) throw new CustomerSiteConflictError('La autorización no existe o no puede revocarse.'); }

  async readSite(customerId: string, collectorUserId?: string) {
    const query = this.addresses.createQueryBuilder('a').innerJoin(CustomerOrmEntity, 'c', 'c.id = a.customer_id AND c.is_active = true').innerJoin(DistrictOrmEntity, 'district', 'district.code = a.district_code').innerJoin(CantonOrmEntity, 'canton', 'canton.code = district.canton_code').innerJoin(ProvinceOrmEntity, 'province', 'province.code = canton.province_code');
    if (collectorUserId) query.innerJoin(CustomerRouteAssignmentOrmEntity, 'ca', 'ca.customer_id = c.id AND ca.ended_at IS NULL').innerJoin(RouteOrmEntity, 'r', 'r.id = ca.route_id AND r.is_active = true').innerJoin(CollectorRouteAssignmentOrmEntity, 'cra', 'cra.route_id = ca.route_id AND cra.ended_at IS NULL AND cra.collector_user_id = :collectorUserId', { collectorUserId }).innerJoin(UserOrmEntity, 'collectorUser', 'collectorUser.id = cra.collector_user_id AND collectorUser.is_active = true').innerJoin(RoleOrmEntity, 'collectorRole', "collectorRole.id = collectorUser.role_id AND collectorRole.code = 'COLLECTOR' AND collectorRole.is_active = true").innerJoin(CollectorOrmEntity, 'collector', 'collector.user_id = collectorUser.id AND collector.is_active = true');
    else query.leftJoin(CustomerRouteAssignmentOrmEntity, 'ca', 'ca.customer_id = c.id AND ca.ended_at IS NULL').leftJoin(RouteOrmEntity, 'r', 'r.id = ca.route_id AND r.is_active = true');
    const row = await query.leftJoin(UserOrmEntity, 'u', 'u.id = a.site_data_updated_by_user_id').select(['c.id AS "customerId"', `CONCAT_WS(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS "customerFullName"`, 'c.identification AS identification', 'c.primary_phone AS "primaryPhone"', 'c.secondary_phone AS "secondaryPhone"', 'r.id AS "routeId"', 'r.name AS "routeName"', 'province.name AS province', 'canton.name AS canton', 'district.name AS district', 'a.exact_address AS "exactAddress"', 'a.latitude AS latitude', 'a.longitude AS longitude', 'a.property_photo_file_key AS photo', 'a.site_data_updated_at AS "updatedAt"', 'u.id AS "userId"', 'u.full_name AS "fullName"']).where('a.customer_id = :customerId', { customerId }).getRawOne();
    if (!row) return null;

    const site = { customer: { id: row.customerId, fullName: row.customerFullName, identification: row.identification, primaryPhone: row.primaryPhone, secondaryPhone: row.secondaryPhone ?? null }, route: row.routeId ? { id: row.routeId, name: row.routeName } : null, address: { province: row.province, canton: row.canton, district: row.district, exactAddress: row.exactAddress }, latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude), hasPropertyPhoto: Boolean(row.photo), siteDataUpdatedAt: row.updatedAt ?? null, siteDataUpdatedBy: row.userId ? { id: row.userId, fullName: row.fullName } : null };
    if (!collectorUserId) return site;

    const now = new Date();
    const authorization = await this.authorizations.createQueryBuilder('auth')
      .where('auth.customer_id = :customerId AND auth.collector_user_id = :collectorUserId AND auth.used_at IS NULL AND auth.revoked_at IS NULL AND auth.expires_at > :now', { customerId, collectorUserId, now })
      .orderBy('auth.authorized_at', 'DESC')
      .getOne();
    return { ...site, ...(authorization ? { activeAuthorization: { ...this.map(authorization), status: 'ACTIVE' as const } } : {}) };
  }

  async readPropertyPhotoKey(customerId: string, collectorUserId?: string): Promise<string | null | undefined> {
    const query = this.addresses.createQueryBuilder('a').innerJoin(CustomerOrmEntity, 'c', 'c.id = a.customer_id AND c.is_active = true');
    if (collectorUserId) query.innerJoin(CustomerRouteAssignmentOrmEntity, 'ca', 'ca.customer_id = c.id AND ca.ended_at IS NULL').innerJoin(RouteOrmEntity, 'r', 'r.id = ca.route_id AND r.is_active = true').innerJoin(CollectorRouteAssignmentOrmEntity, 'cra', 'cra.route_id = ca.route_id AND cra.ended_at IS NULL AND cra.collector_user_id = :collectorUserId', { collectorUserId }).innerJoin(UserOrmEntity, 'u', 'u.id = cra.collector_user_id AND u.is_active = true').innerJoin(RoleOrmEntity, 'role', "role.id = u.role_id AND role.code = 'COLLECTOR' AND role.is_active = true").innerJoin(CollectorOrmEntity, 'collector', 'collector.user_id = u.id AND collector.is_active = true');
    const row = await query.select('a.property_photo_file_key', 'key').where('a.customer_id = :customerId', { customerId }).getRawOne<{ key: string | null }>();
    return row ? row.key : undefined;
  }

  async updateSiteAtomically(customerId: string, patch: { latitude?: number; longitude?: number; propertyPhotoFileKey?: string }, actorId: string, authorizationScopes: SiteUpdateScope[], at: Date, enforceCollectorScope: boolean) {
    return this.customers.manager.transaction(async (manager) => {
      if (enforceCollectorScope) {
        const access = await manager.query(`SELECT 1 FROM customer_route_assignments ca
          JOIN customers c ON c.id = ca.customer_id AND c.is_active = true
          JOIN routes r ON r.id = ca.route_id AND r.is_active = true
          JOIN collector_route_assignments cra ON cra.route_id = ca.route_id AND cra.ended_at IS NULL
          JOIN users u ON u.id = cra.collector_user_id AND u.is_active = true
          JOIN roles role ON role.id = u.role_id AND role.code = 'COLLECTOR' AND role.is_active = true
          JOIN collectors cl ON cl.user_id = u.id AND cl.is_active = true
          WHERE ca.customer_id = $1::uuid AND cra.collector_user_id = $2::uuid AND ca.ended_at IS NULL FOR SHARE OF ca, cra, c, r, u, role, cl`, [customerId, actorId]) as unknown[];
        if (access.length !== 1) throw new CustomerSiteForbiddenError('El cliente no está asignado al usuario activo.');
      }
      const customer = await manager.getRepository(CustomerOrmEntity).findOneBy({ id: customerId, isActive: true });
      if (!customer) throw new CustomerSiteNotFoundError('Cliente activo no encontrado.');
      const address = await manager.getRepository(CustomerAddressOrmEntity).createQueryBuilder('a').where('a.customer_id = :customerId', { customerId }).setLock('pessimistic_write').getOne();
      if (!address) throw new CustomerSiteNotFoundError('Dirección del cliente no encontrada.');
      const replacesLocation = patch.latitude !== undefined && (address.latitude !== null || address.longitude !== null);
      const replacesPhoto = Boolean(patch.propertyPhotoFileKey) && Boolean(address.propertyPhotoFileKey);
      if ((replacesLocation || replacesPhoto) && authorizationScopes.length > 0) {
        const auth = await manager.getRepository(CustomerSiteUpdateAuthorizationOrmEntity).createQueryBuilder('auth').setLock('pessimistic_write').where('auth.customer_id = :customerId AND auth.collector_user_id = :actorId AND auth.used_at IS NULL AND auth.revoked_at IS NULL AND auth.expires_at > :at AND auth.scope IN (:...scopes)', { customerId, actorId, at, scopes: authorizationScopes }).orderBy('auth.authorized_at', 'ASC').getOne();
        if (!auth) throw new CustomerSiteConflictError('No existe una autorización vigente para este alcance.');
        auth.usedAt = at;
        await manager.save(auth);
      }
      const oldPropertyPhotoKey = address.propertyPhotoFileKey ?? undefined;
      await manager.getRepository(CustomerAddressOrmEntity).update(address.id, { ...patch, siteDataUpdatedByUserId: actorId, siteDataUpdatedAt: at });
      return { oldPropertyPhotoKey };
    });
  }
}
