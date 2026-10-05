import { DataSource, EntityManager, Repository } from 'typeorm';
import type { CashMovementBeforeWrite, CashMovementFilters, CashMovementRepository, CreateCashMovement, PeriodSummary } from '../../../../application/cash-movement/cash-movement.repository';
import type { CashMovement } from '../../../../domain/cash-movement/cash-movement.types';
import { CashMovementConflictError } from '../../../../domain/cash-movement/cash-movement.errors';
import { CashMovementOrmEntity } from '../entities/cash-movement.orm-entity';
import { FinancialOpeningOrmEntity } from '../entities/financial-opening.orm-entity';
const map = (e: CashMovementOrmEntity): CashMovement => ({ ...e, direction: e.direction as CashMovement['direction'], concept: e.concept as CashMovement['concept'], paymentMethod: { id: e.paymentMethod.id, name: e.paymentMethod.name, isActive: e.paymentMethod.isActive }, createdBy: { id: e.createdBy.id, fullName: e.createdBy.fullName } });
export class CashMovementTypeOrmRepository implements CashMovementRepository {
  constructor(private readonly repository: Repository<CashMovementOrmEntity>, private readonly dataSource: DataSource) {}
  private query(filters: Partial<CashMovementFilters>) { const q = this.repository.createQueryBuilder('m').leftJoinAndSelect('m.paymentMethod', 'pm').leftJoinAndSelect('m.createdBy', 'u'); if (filters.fromDate) q.andWhere('m.movement_date >= :fromDate', { fromDate: filters.fromDate }); if (filters.toDate) q.andWhere('m.movement_date <= :toDate', { toDate: filters.toDate }); if (filters.direction) q.andWhere('m.direction = :direction', { direction: filters.direction }); if (filters.concept) q.andWhere('m.concept = :concept', { concept: filters.concept }); if (filters.paymentMethodId) q.andWhere('m.payment_method_id = :paymentMethodId', { paymentMethodId: filters.paymentMethodId }); if (filters.search) q.andWhere('(m.concept ILIKE :search OR m.observations ILIKE :search OR pm.name ILIKE :search OR u.full_name ILIKE :search)', { search: `%${filters.search}%` }); return q; }
  async list(filters: CashMovementFilters) { const [rows, total] = await this.query(filters).orderBy('m.movementDate', 'DESC').addOrderBy('m.createdAt', 'DESC').skip((filters.page - 1) * filters.pageSize).take(filters.pageSize).getManyAndCount();
    type Source = Pick<CashMovementOrmEntity, 'concept' | 'loanDisbursementId' | 'paymentId'>;
    const originals = new Map<string, Source>();
    const reversalIds = [...new Set(rows.filter((row) => row.concept === 'REVERSAL' && row.reversedMovementId).map((row) => row.reversedMovementId!))];
    if (reversalIds.length) {
      const found = await this.dataSource.query('SELECT id, concept, loan_disbursement_id AS "loanDisbursementId", payment_id AS "paymentId" FROM cash_movements WHERE id = ANY($1::uuid[])', [reversalIds]) as (Source & { id: string })[];
      for (const original of found) originals.set(original.id, original);
    }
    const sourceFor = (row: CashMovementOrmEntity): Source | undefined => row.concept === 'REVERSAL' ? originals.get(row.reversedMovementId ?? '') : row;
    const disbursementIds = new Set<string>();
    const paymentIds = new Set<string>();
    for (const row of rows) {
      const source = sourceFor(row);
      if ((source?.concept === 'LOAN_DISBURSEMENT' || source?.concept === 'REFINANCING_NEW_MONEY_DISBURSEMENT') && source.loanDisbursementId) disbursementIds.add(source.loanDisbursementId);
      if (source?.concept === 'CUSTOMER_PAYMENT' && source.paymentId) paymentIds.add(source.paymentId);
    }
    const disbursements = new Map<string, string>();
    if (disbursementIds.size) {
      const found = await this.dataSource.query('SELECT d.id, l.loan_number::text AS "loanNumber" FROM loan_disbursements d JOIN loans l ON l.id = d.loan_id WHERE d.id = ANY($1::uuid[])', [[...disbursementIds]]) as { id: string; loanNumber: string }[];
      for (const result of found) disbursements.set(result.id, result.loanNumber);
    }
    const payments = new Map<string, string>();
    if (paymentIds.size) {
      const found = await this.dataSource.query('SELECT p.id, l.loan_number::text AS "loanNumber" FROM payments p JOIN loans l ON l.id = p.loan_id WHERE p.id = ANY($1::uuid[])', [[...paymentIds]]) as { id: string; loanNumber: string }[];
      for (const result of found) payments.set(result.id, result.loanNumber);
    }
    return { items: rows.map((row) => {
      const source = sourceFor(row);
      const loanNumber = source?.concept === 'LOAN_DISBURSEMENT' || source?.concept === 'REFINANCING_NEW_MONEY_DISBURSEMENT' ? disbursements.get(source.loanDisbursementId ?? '')
        : source?.concept === 'CUSTOMER_PAYMENT' ? payments.get(source.paymentId ?? '') : undefined;
      return { ...map(row), loanNumber: loanNumber ?? null,
        reversedConcept: row.concept === 'REVERSAL' && (source?.concept === 'LOAN_DISBURSEMENT' || source?.concept === 'REFINANCING_NEW_MONEY_DISBURSEMENT' || source?.concept === 'CUSTOMER_PAYMENT') ? source.concept as CashMovement['concept'] : null };
    }), total };
  }
  async summary(filters: Pick<CashMovementFilters, 'fromDate' | 'toDate' | 'direction' | 'concept' | 'paymentMethodId' | 'search'>): Promise<PeriodSummary> { const q = this.query(filters); const raw = await q.select("CAST(COALESCE(SUM(CASE WHEN m.direction = 'INFLOW' THEN m.amount ELSE 0 END), 0) AS numeric(18,2))::text", 'inflows').addSelect("CAST(COALESCE(SUM(CASE WHEN m.direction = 'OUTFLOW' THEN m.amount ELSE 0 END), 0) AS numeric(18,2))::text", 'outflows').addSelect("CAST(COALESCE(SUM(CASE WHEN m.direction = 'INFLOW' THEN m.amount ELSE -m.amount END), 0) AS numeric(18,2))::text", 'net').getRawOne<{ inflows: string; outflows: string; net: string }>(); const aggregate = { inflows: raw?.inflows ?? '0.00', outflows: raw?.outflows ?? '0.00', net: raw?.net ?? '0.00' }; const opening = await this.dataSource.getRepository(FinancialOpeningOrmEntity).findOne({ where: { singletonKey: 'DEFAULT' } }); if (!opening) return { ...aggregate, currentAvailable: null, openingDate: null }; const rawCurrent = await this.dataSource.getRepository(CashMovementOrmEntity).createQueryBuilder('m').select("(CAST(:initial AS numeric) + COALESCE(SUM(CASE WHEN m.direction = 'INFLOW' THEN m.amount ELSE -m.amount END), 0))::text", 'value').setParameter('initial', opening.initialAvailableAmount).getRawOne<{ value: string }>(); return { ...aggregate, currentAvailable: rawCurrent?.value ?? opening.initialAvailableAmount, openingDate: opening.openingDate }; }
  async findById(id: string) { const e = await this.query({}).andWhere('m.id = :id', { id }).getOne(); return e ? map(e) : null; }
  async findByIdempotencyKey(key: string) { const e = await this.query({}).andWhere('m.idempotency_key = :key', { key }).getOne(); return e ? map(e) : null; }
  async create(input: CreateCashMovement, beforeWrite?: CashMovementBeforeWrite) {
    return this.dataSource.transaction(async (manager) => {
      await beforeWrite?.(manager);
      return this.recordWithManager(manager, input);
    });
  }
  async recordWithManager(manager: EntityManager, input: CreateCashMovement) {
    const repo = manager.getRepository(CashMovementOrmEntity);
    const saved = await repo.save(repo.create(input));
    const entity = await repo.findOne({ where: { id: saved.id }, relations: { paymentMethod: true, createdBy: true } });
    if (!entity) throw new Error('No fue posible recuperar el movimiento.');
    return map(entity);
  }
  async reverse(original: CashMovement, input: CreateCashMovement, beforeWrite?: CashMovementBeforeWrite) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CashMovementOrmEntity);
      const existing = await repository.findOne({ where: { reversedMovementId: original.id } });
      if (existing) throw new CashMovementConflictError('El movimiento ya fue reversado.');
      try {
        await beforeWrite?.(manager);
        const saved = await repository.save(repository.create(input));
        return map(await repository.findOneOrFail({ where: { id: saved.id }, relations: { paymentMethod: true, createdBy: true } }));
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new CashMovementConflictError('El movimiento ya fue reversado.');
        throw error;
      }
    });
  }
}
