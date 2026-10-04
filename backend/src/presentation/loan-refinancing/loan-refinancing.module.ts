import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoanRefinancingUseCase } from '../../application/loan-refinancing/refinancing.use-case';
import { CASH_MOVEMENT_TRANSACTIONAL_RECORDER, type TransactionalCashMovementRecorder } from '../../application/cash-movement/cash-movement.use-cases';
import { LoanFinancialTotalsTypeormReader } from '../../infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { LoanRefinancingTypeormStore } from '../../infrastructure/database/typeorm/repositories/loan-refinancing.store';
import { CashMovementModule } from '../cash-movement/cash-movement.module';
import { LoanRefinancingController } from './loan-refinancing.controller';

@Module({ imports: [CashMovementModule], controllers: [LoanRefinancingController], providers: [
  { provide: LoanRefinancingUseCase, inject: [DataSource, CASH_MOVEMENT_TRANSACTIONAL_RECORDER],
    useFactory: (source: DataSource, cash: TransactionalCashMovementRecorder) =>
      new LoanRefinancingUseCase(new LoanRefinancingTypeormStore(source, new LoanFinancialTotalsTypeormReader(), cash)) },
] })
export class LoanRefinancingModule {}
