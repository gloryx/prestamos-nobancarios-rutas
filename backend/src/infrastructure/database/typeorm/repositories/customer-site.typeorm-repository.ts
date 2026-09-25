import { QueryFailedError, Repository } from 'typeorm';
import type { CustomerSiteRepository } from '../../../../application/customer-site/customer-site.repository';
import type { CustomerSiteUpdateAuthorization, SiteUpdateScope } from '../../../../domain/customer-site/customer-site.types';
import { CustomerSiteConflictError, CustomerSiteNotFoundError } from '../../../../domain/customer-site/customer-site.errors';
import { CustomerAddressOrmEntity, CustomerOrmEntity, CustomerRouteAssignmentOrmEntity, CustomerSiteUpdateAuthorizationOrmEntity, CollectorRouteAssignmentOrmEntity, RoleOrmEntity, RouteOrmEntity, UserOrmEntity } from '../entities';

export class CustomerSiteTypeOrmRepository implements CustomerSiteRepository {
  constructor(private readonly customers: Repository<CustomerOrmEntity>, private readonly addresses: Repository<CustomerAddressOrmEntity>, private readonly customerAssignments: Repository<CustomerRouteAssignmentOrmEntity>, private readonly collectorAssignments: Repository<CollectorRouteAssignmentOrmEntity>, private readonly authorizations: Repository<CustomerSiteUpdateAuthorizationOrmEntity>, private readonly users: Repository<UserOrmEntity>, private readonly routes: Repository<RouteOrmEntity>) {}

  async hasCollectorAccess(customerId: string, collectorUserId: string): Promise<boolean> {
    const row = await this.customerAssignments.createQueryBuilder('ca').innerJoin(CollectorRouteAssignmentOrmEntity, 'cra', 'cra.route_id = ca.route_id AND cra.ended_at IS NULL').innerJoin(CustomerOrmEntity, 'c', 'c.id = ca.customer_id AND c.is_active = true').innerJoin(RouteOrmEntity, 'r', 'r.id = ca.route_id AND r.is_active = true').innerJoin(UserOrmEntity, 'u', 'u.id = cra.collector_user_id AND u.is_active = true').innerJoin(RoleOrmEntity, 'role', 'role.id = u.role_id AND role.code = :role AND role.is_active = true', { role: 'COLLECTOR' }).where('ca.customer_id = :customerId AND cra.collector_user_id = :collectorUserId AND ca.ended_at IS NULL', { customerId, collectorUserId }).getRawOne();
    return Boolean(row);
  }

  async listAssignedCustomers(collectorUserId: string) {
    const rows = await this.customerAssignments.createQueryBuilder('ca').innerJoin(CollectorRouteAssignmentOrmEntity, 'cra', 'cra.route_id = ca.route_id AND cra.ended_at IS NULL AND cra.collector_user_id = :collectorUserId', { collectorUserId }).innerJoin(CustomerOrmEntity, 'c', 'c.id = ca.customer_id AND c.is_active = true').innerJoin(CustomerAddressOrmEntity, 'a', 'a.customer_id = c.id').innerJoin(RouteOrmEntity, 'r', 'r.id = ca.route_id AND r.is_active = true').innerJoin(UserOrmEntity, 'u', 'u.id = cra.collector_user_id AND u.is_active = true').innerJoin(RoleOrmEntity, 'role', 'role.id = u.role_id AND role.code = :role AND role.is_active = true', { role: 'COLLECTOR' }).select(['c.id AS id', 'c.identification AS identification', `CONCAT_WS(' ', c.first_name, c.middle_name, c.first_last_name, c.second_last_name) AS "fullName"`, 'c.is_active AS "isActive"', 'a.latitude AS latitude', 'a.longitude AS longitude', 'a.property_photo_file_key AS photo', 'a.site_data_updated_at AS "siteDataUpdatedAt"', 'r.id AS "routeId"', 'r.name AS "routeName"']).where('ca.ended_at IS NULL').orderBy('c.first_name', 'ASC').getRawMany();
    return rows.map((row) => ({ id: row.id, identification: row.identification, fullName: row.fullName, isActive: row.isActive === true || row.isActive === 'true', latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude), hasPropertyPhoto: Boolean(row.photo), siteDataUpdatedAt: row.siteDataUpdatedAt ?? null, route: { id: row.routeId, name: row.routeName } }));
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

  async createCustomerAssignment(input: { customerId: string; routeId: string; assignedByUserId: string }) {
    const [customer, route] = await Promise.all([this.customers.findOneBy({ id: input.customerId, isActive: true }), this.routes.findOneBy({ id: input.routeId, isActive: true })]);
    if (!customer || !route) throw new CustomerSiteNotFoundError('El cliente o la ruta no están activos.');
    try { return await this.customerAssignments.save(this.customerAssignments.create(input)); } catch (error) { if (error instanceof QueryFailedError) throw new CustomerSiteConflictError('No se pudo crear la asignación.'); throw error; }
  }
  async createCollectorAssignment(input: { routeId: string; collectorUserId: string; assignedByUserId: string }) {
    const [user, route] = await Promise.all([this.users.createQueryBuilder('u').innerJoinAndSelect('u.role', 'role').where('u.id = :id AND u.is_active = true AND role.code = :code AND role.is_active = true', { id: input.collectorUserId, code: 'COLLECTOR' }).getOne(), this.routes.findOneBy({ id: input.routeId, isActive: true })]);
    if (!user || !route) throw new CustomerSiteNotFoundError('El cobrador o la ruta no están activos.');
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
    const row = await this.addresses.createQueryBuilder('a').innerJoin(CustomerOrmEntity, 'c', 'c.id = a.customer_id AND c.is_active = true').leftJoin(UserOrmEntity, 'u', 'u.id = a.site_data_updated_by_user_id').select(['a.latitude AS latitude', 'a.longitude AS longitude', 'a.property_photo_file_key AS photo', 'a.site_data_updated_at AS updatedAt', 'u.id AS userId', 'u.full_name AS fullName']).where('a.customer_id = :customerId', { customerId }).getRawOne();
    if (!row) return null;

    const site = { latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude), hasPropertyPhoto: Boolean(row.photo), siteDataUpdatedAt: row.updatedAt ?? null, siteDataUpdatedBy: row.userId ? { id: row.userId, fullName: row.fullName } : null };
    if (!collectorUserId) return site;

    const now = new Date();
    const authorization = await this.authorizations.createQueryBuilder('auth')
      .where('auth.customer_id = :customerId AND auth.collector_user_id = :collectorUserId AND auth.used_at IS NULL AND auth.revoked_at IS NULL AND auth.expires_at > :now', { customerId, collectorUserId, now })
      .orderBy('auth.authorized_at', 'DESC')
      .getOne();
    return { ...site, ...(authorization ? { activeAuthorization: { ...this.map(authorization), status: 'ACTIVE' as const } } : {}) };
  }

  async updateSiteAtomically(customerId: string, patch: { latitude?: number; longitude?: number; propertyPhotoFileKey?: string }, actorId: string, authorizationScopes: SiteUpdateScope[], at: Date) {
    return this.customers.manager.transaction(async (manager) => {
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
