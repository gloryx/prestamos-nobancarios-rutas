import { Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CASH_MOVEMENT_REPOSITORY, type CashMovementRepository } from '../../application/cash-movement/cash-movement.repository';
import { ListCashMovementsUseCase, RecordManualCashMovementUseCase, ReverseCashMovementUseCase, SummarizeCashMovementsUseCase } from '../../application/cash-movement/cash-movement.use-cases';
import { CashMovementOrmEntity, FinancialOpeningOrmEntity, PaymentMethodOrmEntity } from '../../infrastructure/database/typeorm/entities';
import { CashMovementTypeOrmRepository } from '../../infrastructure/database/typeorm/repositories/cash-movement.typeorm-repository';
import { CashMovementController } from './cash-movement.controller';
@Module({ imports: [TypeOrmModule.forFeature([CashMovementOrmEntity, FinancialOpeningOrmEntity, PaymentMethodOrmEntity])], controllers: [CashMovementController], providers: [
  { provide: CASH_MOVEMENT_REPOSITORY, inject: [getRepositoryToken(CashMovementOrmEntity), DataSource], useFactory: (repository: Repository<CashMovementOrmEntity>, dataSource: DataSource) => new CashMovementTypeOrmRepository(repository, dataSource) },
  { provide: ListCashMovementsUseCase, inject: [CASH_MOVEMENT_REPOSITORY], useFactory: (repository: CashMovementRepository) => new ListCashMovementsUseCase(repository) },
  { provide: SummarizeCashMovementsUseCase, inject: [CASH_MOVEMENT_REPOSITORY], useFactory: (repository: CashMovementRepository) => new SummarizeCashMovementsUseCase(repository) },
  { provide: RecordManualCashMovementUseCase, inject: [CASH_MOVEMENT_REPOSITORY, getRepositoryToken(FinancialOpeningOrmEntity), getRepositoryToken(PaymentMethodOrmEntity)], useFactory: (repository: CashMovementRepository, opening: Repository<FinancialOpeningOrmEntity>, methods: Repository<PaymentMethodOrmEntity>) => new RecordManualCashMovementUseCase(repository, { find: () => opening.findOne({ where: { singletonKey: 'DEFAULT' } }) }, { findById: (id: string) => methods.findOne({ where: { id } }) }) },
  { provide: ReverseCashMovementUseCase, inject: [CASH_MOVEMENT_REPOSITORY, getRepositoryToken(FinancialOpeningOrmEntity)], useFactory: (repository: CashMovementRepository, opening: Repository<FinancialOpeningOrmEntity>) => new ReverseCashMovementUseCase(repository, { find: () => opening.findOne({ where: { singletonKey: 'DEFAULT' } }) }) },
 ] })
export class CashMovementModule {}
