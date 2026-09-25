import { Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FINANCIAL_OPENING_REPOSITORY, FinancialOpeningRepository } from '../../application/financial-opening/financial-opening.repository';
import { GetFinancialOpeningUseCase, PerformFinancialOpeningUseCase } from '../../application/financial-opening/financial-opening.use-cases';
import { FinancialOpeningOrmEntity } from '../../infrastructure/database/typeorm/entities';
import { FinancialOpeningTypeOrmRepository } from '../../infrastructure/database/typeorm/repositories/financial-opening.typeorm-repository';
import { FinancialOpeningController } from './financial-opening.controller';

@Module({ imports: [TypeOrmModule.forFeature([FinancialOpeningOrmEntity])], controllers: [FinancialOpeningController], providers: [
  { provide: FINANCIAL_OPENING_REPOSITORY, inject: [getRepositoryToken(FinancialOpeningOrmEntity)], useFactory: (repository: Repository<FinancialOpeningOrmEntity>) => new FinancialOpeningTypeOrmRepository(repository) },
  { provide: GetFinancialOpeningUseCase, inject: [FINANCIAL_OPENING_REPOSITORY], useFactory: (repository: FinancialOpeningRepository) => new GetFinancialOpeningUseCase(repository) },
  { provide: PerformFinancialOpeningUseCase, inject: [FINANCIAL_OPENING_REPOSITORY], useFactory: (repository: FinancialOpeningRepository) => new PerformFinancialOpeningUseCase(repository) },
] })
export class FinancialOpeningModule {}
