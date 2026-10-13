import { DataSource, Repository } from 'typeorm';
import type { Collector, EligibleCollectorUser } from '../../../../domain/collector/collector.types';
import type { CollectorCreate, CollectorListQuery, CollectorRepository, CollectorUpdate } from '../../../../application/collector/collector.repository';
import { CollectorOrmEntity } from '../entities/collector.orm-entity';
import { UserOrmEntity } from '../entities/user.orm-entity';
import { CollectorReassignmentConflictError, CollectorUserAlreadyLinkedError,
  CollectorUserNotEligibleError } from '../../../../domain/collector/collector.errors';

export const mapCollector = (row: CollectorOrmEntity): Collector => ({ id: row.id, identification: row.identification, firstName: row.firstName, firstLastName: row.firstLastName, ...(row.secondLastName ? { secondLastName: row.secondLastName } : {}), phone: row.phone, ...(row.alternativePhone ? { alternativePhone: row.alternativePhone } : {}), ...(row.email ? { email: row.email } : {}), birthDate: row.birthDate, address: row.address, photoFileKey: row.photoFileKey, userId: row.userId, user: row.user ? { fullName: row.user.fullName, username: row.user.username } : null, isActive: row.isActive, createdAt: row.createdAt, updatedAt: row.updatedAt });

export class CollectorTypeOrmRepository implements CollectorRepository {
  constructor(private readonly collectors: Repository<CollectorOrmEntity>, private readonly users: Repository<UserOrmEntity>,
    private readonly source: DataSource) {}
   async list(query: CollectorListQuery) { const qb = this.collectors.createQueryBuilder('c').leftJoin('c.user', 'u').addSelect(['u.id', 'u.fullName', 'u.username']).orderBy('c.firstLastName', 'ASC').addOrderBy('c.firstName', 'ASC'); if (query.status !== 'ALL') qb.andWhere('c.is_active = :active', { active: query.status === 'ACTIVE' }); if (query.search?.trim()) { const search = `%${query.search.trim().toUpperCase()}%`; qb.andWhere('(upper(c.identification) LIKE :search OR upper(c.first_name) LIKE :search OR upper(c.first_last_name) LIKE :search OR upper(coalesce(c.second_last_name, \'\')) LIKE :search OR upper(c.phone) LIKE :search OR upper(coalesce(c.alternative_phone, \'\')) LIKE :search OR lower(coalesce(c.email, \'\')) LIKE lower(:search) OR upper(c.address) LIKE :search)', { search }); } const [rows, total] = await qb.skip((query.page - 1) * query.pageSize).take(query.pageSize).getManyAndCount(); return { items: rows.map(mapCollector), total }; }
   async findById(id: string) { const row = await this.collectors.createQueryBuilder('c').leftJoin('c.user', 'u').addSelect(['u.id', 'u.fullName', 'u.username']).where('c.id = :id', { id }).getOne(); return row ? mapCollector(row) : null; }
  async identificationExists(identification: string, exceptId?: string) { const qb = this.collectors.createQueryBuilder('c').where('lower(c.identification) = lower(:identification)', { identification }); if (exceptId) qb.andWhere('c.id <> :exceptId', { exceptId }); return Boolean(await qb.getOne()); }
   async create(input: CollectorCreate) {
     const { assignedByUserId, ...data } = input;
     const created = await this.source.transaction(async (manager) => {
       const repository = manager.getRepository(CollectorOrmEntity);
       const row = await repository.save(repository.create({ ...data, isActive: true, secondLastName: input.secondLastName ?? null,
         alternativePhone: input.alternativePhone ?? null, email: input.email ?? null, photoFileKey: input.photoFileKey ?? null,
         userId: input.userId ?? null }));
       if (row.userId) await manager.query(`INSERT INTO collector_user_assignments
         (collector_id,user_id,assigned_by_user_id) VALUES ($1,$2,$3)`, [row.id, row.userId, assignedByUserId ?? null]);
       return row;
     });
     return mapCollector(created);
   }
  async update(id: string, input: CollectorUpdate) { const patch: Record<string, unknown> = { ...input }; for (const field of ['secondLastName', 'alternativePhone', 'email'] as const) if (Object.prototype.hasOwnProperty.call(input, field)) patch[field] = input[field] ?? null; const result = await this.collectors.update(id, patch); if (!result.affected) return null; return this.findById(id); }
  async updateStatus(id: string, isActive: boolean) { const result = await this.collectors.update(id, { isActive }); if (!result.affected) return null; return this.findById(id); }
  async reassignUser(id: string, userId: string | null, actorUserId: string) {
    try {
      const found = await this.source.transaction(async (manager) => {
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext('route-assignments-batch'))`);
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext('collector-custody:' || $1::text))`, [id]);
        const [collector] = await manager.query(`SELECT id, user_id AS "userId" FROM collectors WHERE id = $1 FOR UPDATE`, [id]);
        if (!collector) return false;
        if (collector.userId === userId) return true;
        if (userId) {
          const [eligible] = await manager.query(`SELECT u.id FROM users u JOIN roles role ON role.id = u.role_id
            WHERE u.id = $1 AND u.is_active = true AND role.code = 'COLLECTOR' AND role.is_active = true FOR UPDATE OF u`, [userId]);
          if (!eligible) throw new CollectorUserNotEligibleError();
          const [linked] = await manager.query(`SELECT id FROM collectors WHERE user_id = $1 AND id <> $2 FOR SHARE`, [userId, id]);
          if (linked) throw new CollectorUserAlreadyLinkedError();
        }
        if (collector.userId) {
          const [obligations] = await manager.query(`SELECT
            COALESCE((SELECT SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END)
              FROM collector_custody_entries WHERE collector_id = $1),0)::numeric(18,2)::text AS "custodyBalance",
            EXISTS (SELECT 1 FROM collector_precollections WHERE collector_id = $1 AND status IN ('RECORDED','SUBMITTED')) AS "openPrecollections",
            EXISTS (SELECT 1 FROM collector_settlements WHERE collector_id = $1 AND status IN ('DRAFT','SUBMITTED','UNDER_REVIEW')) AS "openSettlements",
            EXISTS (SELECT 1 FROM collector_route_assignments WHERE collector_user_id = $2 AND ended_at IS NULL) AS "activeRoutes",
            EXISTS (SELECT 1 FROM customer_site_update_authorizations WHERE collector_user_id = $2
              AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS "activeAuthorizations"`, [id, collector.userId]);
          if (obligations.custodyBalance !== '0.00') throw new CollectorReassignmentConflictError(
            'El cobrador mantiene un saldo de custodia pendiente.', 'COLLECTOR_CUSTODY_BALANCE_NOT_ZERO');
          if (obligations.openPrecollections) throw new CollectorReassignmentConflictError(
            'El cobrador mantiene cobros preliminares abiertos.', 'COLLECTOR_HAS_OPEN_PRECOLLECTIONS');
          if (obligations.openSettlements) throw new CollectorReassignmentConflictError(
            'El cobrador mantiene liquidaciones abiertas.', 'COLLECTOR_HAS_OPEN_SETTLEMENTS');
          if (obligations.activeRoutes) throw new CollectorReassignmentConflictError(
            'El usuario actual mantiene rutas asignadas.', 'COLLECTOR_HAS_ACTIVE_ROUTE_ASSIGNMENTS');
          if (obligations.activeAuthorizations) throw new CollectorReassignmentConflictError(
            'El usuario actual mantiene autorizaciones de sitio vigentes.', 'COLLECTOR_HAS_ACTIVE_SITE_AUTHORIZATIONS');
        }
        await manager.query(`UPDATE collector_user_assignments SET ended_at = now(), ended_by_user_id = $1
          WHERE collector_id = $2 AND ended_at IS NULL`, [actorUserId, id]);
        if (userId) await manager.query(`INSERT INTO collector_user_assignments
          (collector_id,user_id,assigned_by_user_id) VALUES ($1,$2,$3)`, [id, userId, actorUserId]);
        await manager.query(`UPDATE collectors SET user_id = $1, updated_at = now() WHERE id = $2`, [userId, id]);
        return true;
      });
      return found ? this.findById(id) : null;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new CollectorUserAlreadyLinkedError();
      throw error;
    }
  }
  async findEligibleUser(id: string): Promise<EligibleCollectorUser | null> { const row = await this.users.createQueryBuilder('u').innerJoin('u.role', 'r').select(['u.id', 'u.fullName', 'u.username']).where('u.id = :id AND u.is_active = true AND r.code = :role AND r.is_active = true', { id, role: 'COLLECTOR' }).getOne(); return row ? { id: row.id, fullName: row.fullName, username: row.username } : null; }
  async userLinkedToAnother(userId: string, collectorId: string) { const qb = this.collectors.createQueryBuilder('c').where('c.user_id = :userId', { userId }); if (collectorId) qb.andWhere('c.id <> :collectorId', { collectorId }); return Boolean(await qb.getOne()); }
   async listEligibleUsers() { const rows = await this.users.createQueryBuilder('u').innerJoin('u.role', 'r').leftJoin(CollectorOrmEntity, 'c', 'c.user_id = u.id').select(['u.id', 'u.fullName', 'u.username']).where('u.is_active = true AND r.code = :role AND r.is_active = true AND c.id IS NULL', { role: 'COLLECTOR' }).orderBy('u.fullName', 'ASC').getMany(); return rows.map((row) => ({ id: row.id, fullName: row.fullName, username: row.username })); }
}
