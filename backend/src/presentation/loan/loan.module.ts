import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateLoanUseCase, ListActiveLoanCustomersUseCase, ListLoansUseCase } from '../../application/loan/loan.use-case';
import { CASH_MOVEMENT_TRANSACTIONAL_RECORDER } from '../../application/cash-movement/cash-movement.use-cases';
import type { TransactionalCashMovementRecorder } from '../../application/cash-movement/cash-movement.use-cases';
import { CashMovementModule } from '../cash-movement/cash-movement.module';
import { LoanController } from './loan.controller';
@Module({ imports: [CashMovementModule], controllers: [LoanController], providers: [{ provide: CreateLoanUseCase, inject: [DataSource, CASH_MOVEMENT_TRANSACTIONAL_RECORDER], useFactory: (ds: DataSource, recorder: TransactionalCashMovementRecorder) => new CreateLoanUseCase(ds, recorder) }, { provide: ListLoansUseCase, inject: [DataSource], useFactory: (ds: DataSource) => new ListLoansUseCase(ds) }, { provide: ListActiveLoanCustomersUseCase, inject: [DataSource], useFactory: (ds: DataSource) => new ListActiveLoanCustomersUseCase(ds) }] }) export class LoanModule {}
