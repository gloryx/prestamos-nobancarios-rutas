import { Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CASH_MOVEMENT_REPOSITORY, type CashMovementRepository } from '../../application/cash-movement/cash-movement.repository';
import { CASH_MOVEMENT_TRANSACTIONAL_RECORDER, ListCashMovementsUseCase, RecordManualCashMovementUseCase, ReverseCashMovementUseCase, SummarizeCashMovementsUseCase } from '../../application/cash-movement/cash-movement.use-cases';
import { CashMovementOrmEntity, FinancialOpeningOrmEntity, PaymentMethodOrmEntity } from '../../infrastructure/database/typeorm/entities';
import { CashMovementTypeOrmRepository } from '../../infrastructure/database/typeorm/repositories/cash-movement.typeorm-repository';
import { CashMovementController } from './cash-movement.controller';
import { ECONOMIC_CAPITAL_READER, EconomicCapitalUseCase, type EconomicCapitalReader } from '../../application/cash-movement/economic-capital.use-case';
import { EconomicCapitalTypeOrmReader } from '../../infrastructure/database/typeorm/repositories/economic-capital.reader';
import { ECONOMIC_PROFITABILITY_READER, type EconomicProfitabilityReader,
  MonthlyProfitabilityUseCase } from '../../application/cash-movement/monthly-profitability.use-case';
@Module({ imports: [TypeOrmModule.forFeature([CashMovementOrmEntity, FinancialOpeningOrmEntity, PaymentMethodOrmEntity])], controllers: [CashMovementController], providers: [
  { provide: CASH_MOVEMENT_REPOSITORY, inject: [getRepositoryToken(CashMovementOrmEntity), DataSource], useFactory: (repository: Repository<CashMovementOrmEntity>, dataSource: DataSource) => new CashMovementTypeOrmRepository(repository, dataSource) },
  { provide: CASH_MOVEMENT_TRANSACTIONAL_RECORDER, inject: [CASH_MOVEMENT_REPOSITORY], useFactory: (repository: CashMovementTypeOrmRepository) => repository },
  { provide: ListCashMovementsUseCase, inject: [CASH_MOVEMENT_REPOSITORY], useFactory: (repository: CashMovementRepository) => new ListCashMovementsUseCase(repository) },
  { provide: SummarizeCashMovementsUseCase, inject: [CASH_MOVEMENT_REPOSITORY], useFactory: (repository: CashMovementRepository) => new SummarizeCashMovementsUseCase(repository) },
  { provide: RecordManualCashMovementUseCase, inject: [CASH_MOVEMENT_REPOSITORY, getRepositoryToken(FinancialOpeningOrmEntity), getRepositoryToken(PaymentMethodOrmEntity)], useFactory: (repository: CashMovementRepository, opening: Repository<FinancialOpeningOrmEntity>, methods: Repository<PaymentMethodOrmEntity>) => new RecordManualCashMovementUseCase(repository, { find: () => opening.findOne({ where: { singletonKey: 'DEFAULT' } }) }, { findById: (id: string) => methods.findOne({ where: { id } }) }) },
  { provide: ReverseCashMovementUseCase, inject: [CASH_MOVEMENT_REPOSITORY, getRepositoryToken(FinancialOpeningOrmEntity)], useFactory: (repository: CashMovementRepository, opening: Repository<FinancialOpeningOrmEntity>) => new ReverseCashMovementUseCase(repository, { find: () => opening.findOne({ where: { singletonKey: 'DEFAULT' } }) }) },
  { provide: EconomicCapitalTypeOrmReader, inject: [DataSource], useFactory: (dataSource: DataSource) => new EconomicCapitalTypeOrmReader(dataSource) },
  { provide: ECONOMIC_CAPITAL_READER, useExisting: EconomicCapitalTypeOrmReader },
  { provide: ECONOMIC_PROFITABILITY_READER, useExisting: EconomicCapitalTypeOrmReader },
  { provide: EconomicCapitalUseCase, inject: [ECONOMIC_CAPITAL_READER], useFactory: (reader: EconomicCapitalReader) => new EconomicCapitalUseCase(reader) },
  { provide: MonthlyProfitabilityUseCase, inject: [ECONOMIC_PROFITABILITY_READER], useFactory: (reader: EconomicProfitabilityReader) => new MonthlyProfitabilityUseCase(reader) },
  ], exports: [CASH_MOVEMENT_REPOSITORY, CASH_MOVEMENT_TRANSACTIONAL_RECORDER] })
export class CashMovementModule {}
