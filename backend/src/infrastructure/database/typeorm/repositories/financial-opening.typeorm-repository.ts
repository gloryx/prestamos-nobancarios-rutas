import { Repository } from 'typeorm';
import type { FinancialOpeningRepository, CreateFinancialOpening } from '../../../../application/financial-opening/financial-opening.repository';
import type { FinancialOpening } from '../../../../domain/financial-opening/financial-opening.types';
import { FinancialOpeningOrmEntity } from '../entities/financial-opening.orm-entity';
import { FinancialOpeningAlreadyPerformedError } from '../../../../domain/financial-opening/financial-opening.errors';

export class FinancialOpeningTypeOrmRepository implements FinancialOpeningRepository {
  constructor(private readonly repository: Repository<FinancialOpeningOrmEntity>) {}
  private map(entity: FinancialOpeningOrmEntity): FinancialOpening { return { ...entity, openedBy: { id: entity.openedBy.id, fullName: entity.openedBy.fullName } }; }
  async find(): Promise<FinancialOpening | null> { const entity = await this.repository.findOne({ where: { singletonKey: 'DEFAULT' }, relations: { openedBy: true } }); return entity ? this.map(entity) : null; }
  async create(input: CreateFinancialOpening): Promise<FinancialOpening> {
    try { const entity = this.repository.create({ ...input, singletonKey: 'DEFAULT' }); const saved = await this.repository.save(entity); const complete = await this.repository.findOne({ where: { id: saved.id }, relations: { openedBy: true } }); if (!complete) throw new Error('No fue posible recuperar la apertura financiera.'); return this.map(complete); }
    catch (error) { if ((error as { code?: string }).code === '23505') throw new FinancialOpeningAlreadyPerformedError(); throw error; }
  }
}
