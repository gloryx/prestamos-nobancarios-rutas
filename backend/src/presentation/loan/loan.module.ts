import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateLoanUseCase, ListActiveLoanCustomersUseCase, ListLoansUseCase } from '../../application/loan/loan.use-case';
import { CANCELLED_LOANS_READER, ListCancelledLoansUseCase } from '../../application/loan/cancelled-loans.use-case';
import type { CancelledLoansReader } from '../../application/loan/cancelled-loans.use-case';
import { CancelledLoansTypeormReader } from '../../infrastructure/database/typeorm/repositories/cancelled-loans.reader';
import { LOAN_FINANCIAL_TOTALS_READER, type LoanFinancialTotalsReader } from '../../application/loan/loan-financial-totals.reader';
import { UNCOLLECTIBLE_ELIGIBILITY_READER, EvaluateUncollectibleEligibilityUseCase, type UncollectibleEligibilityReader } from '../../application/loan/uncollectible-eligibility.use-case';
import { LoanFinancialTotalsTypeormReader } from '../../infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { UncollectibleEligibilityTypeormReader } from '../../infrastructure/database/typeorm/repositories/uncollectible-eligibility.reader';
import { MARK_UNCOLLECTIBLE_WRITER, MarkUncollectibleUseCase, type MarkUncollectibleWriter } from '../../application/loan/mark-uncollectible.use-case';
import { MarkUncollectibleTypeormWriter } from '../../infrastructure/database/typeorm/repositories/mark-uncollectible.writer';
import { REACTIVATE_LOAN_WRITER, ReactivateLoanUseCase, type ReactivateLoanWriter } from '../../application/loan/reactivate-loan.use-case';
import { ReactivateLoanTypeormWriter } from '../../infrastructure/database/typeorm/repositories/reactivate-loan.writer';
import { OVERDUE_LOANS_READER, ListOverdueLoansUseCase, type OverdueLoansReader } from '../../application/loan/overdue-loans.use-case';
import { OverdueLoansTypeormReader } from '../../infrastructure/database/typeorm/repositories/overdue-loans.reader';
import { UNCOLLECTIBLE_LOANS_READER, ListUncollectibleLoansUseCase, type UncollectibleLoansReader } from '../../application/loan/uncollectible-loans.use-case';
import { UncollectibleLoansTypeormReader } from '../../infrastructure/database/typeorm/repositories/uncollectible-loans.reader';
import { CASH_MOVEMENT_TRANSACTIONAL_RECORDER } from '../../application/cash-movement/cash-movement.use-cases';
import type { TransactionalCashMovementRecorder } from '../../application/cash-movement/cash-movement.use-cases';
import { CashMovementModule } from '../cash-movement/cash-movement.module';
import { LoanController } from './loan.controller';
@Module({ imports: [CashMovementModule], controllers: [LoanController], providers: [{ provide: CreateLoanUseCase, inject: [DataSource, CASH_MOVEMENT_TRANSACTIONAL_RECORDER], useFactory: (ds: DataSource, recorder: TransactionalCashMovementRecorder) => new CreateLoanUseCase(ds, recorder) }, { provide: ListLoansUseCase, inject: [DataSource], useFactory: (ds: DataSource) => new ListLoansUseCase(ds) }, { provide: ListActiveLoanCustomersUseCase, inject: [DataSource], useFactory: (ds: DataSource) => new ListActiveLoanCustomersUseCase(ds) }, { provide: CANCELLED_LOANS_READER, inject: [DataSource], useFactory: (ds: DataSource) => new CancelledLoansTypeormReader(ds) }, { provide: ListCancelledLoansUseCase, inject: [CANCELLED_LOANS_READER], useFactory: (reader: CancelledLoansReader) => new ListCancelledLoansUseCase(reader) },
  { provide: LOAN_FINANCIAL_TOTALS_READER, useClass: LoanFinancialTotalsTypeormReader },
  { provide: UNCOLLECTIBLE_ELIGIBILITY_READER, useClass: UncollectibleEligibilityTypeormReader },
  { provide: EvaluateUncollectibleEligibilityUseCase, inject: [LOAN_FINANCIAL_TOTALS_READER, UNCOLLECTIBLE_ELIGIBILITY_READER], useFactory: (totals: LoanFinancialTotalsReader, reader: UncollectibleEligibilityReader) => new EvaluateUncollectibleEligibilityUseCase(totals, reader) },
  { provide: MARK_UNCOLLECTIBLE_WRITER, inject: [DataSource], useFactory: (ds: DataSource) => new MarkUncollectibleTypeormWriter(ds) },
  { provide: MarkUncollectibleUseCase, inject: [MARK_UNCOLLECTIBLE_WRITER, EvaluateUncollectibleEligibilityUseCase], useFactory: (writer: MarkUncollectibleWriter, evaluator: EvaluateUncollectibleEligibilityUseCase) => new MarkUncollectibleUseCase(writer, evaluator) },
  { provide: REACTIVATE_LOAN_WRITER, inject: [DataSource], useFactory: (ds: DataSource) => new ReactivateLoanTypeormWriter(ds) },
  { provide: ReactivateLoanUseCase, inject: [REACTIVATE_LOAN_WRITER, EvaluateUncollectibleEligibilityUseCase], useFactory: (writer: ReactivateLoanWriter, evaluator: EvaluateUncollectibleEligibilityUseCase) => new ReactivateLoanUseCase(writer, evaluator) },
  { provide: OVERDUE_LOANS_READER, inject: [DataSource], useFactory: (ds: DataSource) => new OverdueLoansTypeormReader(ds) },
  { provide: ListOverdueLoansUseCase, inject: [OVERDUE_LOANS_READER], useFactory: (reader: OverdueLoansReader) => new ListOverdueLoansUseCase(reader) },
  { provide: UNCOLLECTIBLE_LOANS_READER, inject: [DataSource], useFactory: (ds: DataSource) => new UncollectibleLoansTypeormReader(ds) },
  { provide: ListUncollectibleLoansUseCase, inject: [UNCOLLECTIBLE_LOANS_READER], useFactory: (reader: UncollectibleLoansReader) => new ListUncollectibleLoansUseCase(reader) },
] }) export class LoanModule {}
