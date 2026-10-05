import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoanRefinancingUseCase } from '../../application/loan-refinancing/refinancing.use-case';
import { CASH_MOVEMENT_TRANSACTIONAL_RECORDER, type TransactionalCashMovementRecorder } from '../../application/cash-movement/cash-movement.use-cases';
import { LoanFinancialTotalsTypeormReader } from '../../infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { LoanRefinancingTypeormStore } from '../../infrastructure/database/typeorm/repositories/loan-refinancing.store';
import { CashMovementModule } from '../cash-movement/cash-movement.module';
import { LoanRefinancingController } from './loan-refinancing.controller';
import { RetroactivePeriodGuard } from '../../application/financial-close/retroactive-period.guard';
import { FinancialCloseModule } from '../financial-close/financial-close.module';

@Module({ imports: [CashMovementModule, FinancialCloseModule], controllers: [LoanRefinancingController], providers: [
  { provide: LoanRefinancingUseCase, inject: [DataSource, CASH_MOVEMENT_TRANSACTIONAL_RECORDER, RetroactivePeriodGuard],
    useFactory: (source: DataSource, cash: TransactionalCashMovementRecorder, guard: RetroactivePeriodGuard) =>
      new LoanRefinancingUseCase(new LoanRefinancingTypeormStore(source, new LoanFinancialTotalsTypeormReader(), cash), guard) },
] })
export class LoanRefinancingModule {}
