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
import { EditLoanUseCase } from '../../application/loan/edit-loan.use-case';
import { EditLoanTypeormWriter } from '../../infrastructure/database/typeorm/repositories/edit-loan.writer';
import { GetLoanEditContextUseCase, LOAN_EDIT_CONTEXT_READER, type LoanEditContextReader } from '../../application/loan/loan-edit-context.use-case';
import { LoanEditContextTypeormReader } from '../../infrastructure/database/typeorm/repositories/loan-edit-context.reader';
import { ANNULLED_LOANS_READER, ListAnnulledLoansUseCase, type AnnulledLoansReader } from '../../application/loan/annulled-loans.use-case';
import { ANNUL_LOAN_WRITER, AnnulLoanUseCase, type AnnulLoanWriter } from '../../application/loan/annul-loan.use-case';
import { AnnulledLoansTypeormReader } from '../../infrastructure/database/typeorm/repositories/annulled-loans.reader';
import { AnnulLoanTypeormWriter } from '../../infrastructure/database/typeorm/repositories/annul-loan.writer';
import { CASH_MOVEMENT_TRANSACTIONAL_RECORDER } from '../../application/cash-movement/cash-movement.use-cases';
import type { TransactionalCashMovementRecorder } from '../../application/cash-movement/cash-movement.use-cases';
import { CashMovementModule } from '../cash-movement/cash-movement.module';
import { LoanController } from './loan.controller';
import { RetroactivePeriodGuard } from '../../application/financial-close/retroactive-period.guard';
import { FinancialCloseModule } from '../financial-close/financial-close.module';
import { ExportActiveLoansUseCase, type ActiveLoanExportReader } from '../../application/loan/export-active-loans.use-case';
import { ActiveLoanExportTypeormReader } from '../../infrastructure/database/typeorm/repositories/active-loan-export.reader';
import { ASSIGNED_LOANS_READER, AssignedLoansUseCase, type AssignedLoansReader } from '../../application/loan/assigned-loans.use-case';
import { AssignedLoansTypeormReader } from '../../infrastructure/database/typeorm/repositories/assigned-loans.reader';
@Module({ imports: [CashMovementModule, FinancialCloseModule], controllers: [LoanController], providers: [{ provide: CreateLoanUseCase, inject: [DataSource, CASH_MOVEMENT_TRANSACTIONAL_RECORDER, RetroactivePeriodGuard], useFactory: (ds: DataSource, recorder: TransactionalCashMovementRecorder, guard: RetroactivePeriodGuard) => new CreateLoanUseCase(ds, recorder, guard) }, { provide: ListLoansUseCase, inject: [DataSource], useFactory: (ds: DataSource) => new ListLoansUseCase(ds) }, { provide: ListActiveLoanCustomersUseCase, inject: [DataSource], useFactory: (ds: DataSource) => new ListActiveLoanCustomersUseCase(ds) }, { provide: CANCELLED_LOANS_READER, inject: [DataSource], useFactory: (ds: DataSource) => new CancelledLoansTypeormReader(ds) }, { provide: ListCancelledLoansUseCase, inject: [CANCELLED_LOANS_READER], useFactory: (reader: CancelledLoansReader) => new ListCancelledLoansUseCase(reader) },
  { provide: LOAN_FINANCIAL_TOTALS_READER, useClass: LoanFinancialTotalsTypeormReader },
  { provide: EditLoanUseCase, inject: [DataSource, LOAN_FINANCIAL_TOTALS_READER], useFactory: (ds: DataSource, totals: LoanFinancialTotalsReader) => new EditLoanUseCase(new EditLoanTypeormWriter(ds), totals) },
  { provide: LOAN_EDIT_CONTEXT_READER, inject: [DataSource, LOAN_FINANCIAL_TOTALS_READER], useFactory: (ds: DataSource, totals: LoanFinancialTotalsReader) => new LoanEditContextTypeormReader(ds, totals) },
  { provide: GetLoanEditContextUseCase, inject: [LOAN_EDIT_CONTEXT_READER], useFactory: (reader: LoanEditContextReader) => new GetLoanEditContextUseCase(reader) },
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
  { provide: ANNULLED_LOANS_READER, inject: [DataSource], useFactory: (ds: DataSource) => new AnnulledLoansTypeormReader(ds) },
  { provide: ListAnnulledLoansUseCase, inject: [ANNULLED_LOANS_READER], useFactory: (reader: AnnulledLoansReader) => new ListAnnulledLoansUseCase(reader) },
  { provide: ANNUL_LOAN_WRITER, inject: [DataSource], useFactory: (ds: DataSource) => new AnnulLoanTypeormWriter(ds) },
  { provide: AnnulLoanUseCase, inject: [ANNUL_LOAN_WRITER, LOAN_FINANCIAL_TOTALS_READER], useFactory: (writer: AnnulLoanWriter, totals: LoanFinancialTotalsReader) => new AnnulLoanUseCase(writer, totals) },
  { provide: ExportActiveLoansUseCase, inject: [DataSource], useFactory: (ds: DataSource) => new ExportActiveLoansUseCase(new ActiveLoanExportTypeormReader(ds) as ActiveLoanExportReader) },
  { provide: ASSIGNED_LOANS_READER, inject: [DataSource], useFactory: (ds: DataSource) => new AssignedLoansTypeormReader(ds) },
  { provide: AssignedLoansUseCase, inject: [ASSIGNED_LOANS_READER], useFactory: (reader: AssignedLoansReader) => new AssignedLoansUseCase(reader) },
] }) export class LoanModule {}
