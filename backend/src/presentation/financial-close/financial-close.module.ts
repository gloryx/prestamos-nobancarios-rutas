import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FINANCIAL_CLOSE_STORE, type FinancialCloseStore } from '../../application/financial-close/financial-close.store';
import { FinancialCloseUseCases } from '../../application/financial-close/financial-close.use-cases';
import { RETROACTIVE_PERIOD_READER, RetroactivePeriodGuard, type RetroactivePeriodReader } from '../../application/financial-close/retroactive-period.guard';
import { FinancialCloseTypeOrmStore } from '../../infrastructure/database/typeorm/repositories/financial-close.typeorm-store';
import { RetroactivePeriodTypeOrmReader } from '../../infrastructure/database/typeorm/repositories/retroactive-period.typeorm-reader';
import { FinancialCloseController } from './financial-close.controller';

@Module({ controllers: [FinancialCloseController], providers: [
  { provide: FINANCIAL_CLOSE_STORE, inject: [DataSource], useFactory: (source: DataSource) => new FinancialCloseTypeOrmStore(source) },
  { provide: FinancialCloseUseCases, inject: [FINANCIAL_CLOSE_STORE], useFactory: (store: FinancialCloseStore) => new FinancialCloseUseCases(store) },
  { provide: RETROACTIVE_PERIOD_READER, inject: [DataSource], useFactory: (source: DataSource) => new RetroactivePeriodTypeOrmReader(source) },
  { provide: RetroactivePeriodGuard, inject: [RETROACTIVE_PERIOD_READER], useFactory: (reader: RetroactivePeriodReader) => new RetroactivePeriodGuard(reader) },
], exports: [RetroactivePeriodGuard] })
export class FinancialCloseModule {}
