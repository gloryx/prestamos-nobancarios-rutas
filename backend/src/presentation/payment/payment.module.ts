import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CustomizePaymentPlanUseCase, PaymentContextUseCase, RegisterPaymentUseCase } from '../../application/payment/payment.use-case';
import { DAILY_COLLECTIONS_READER, DailyCollectionsUseCase, type DailyCollectionsReader } from '../../application/payment/daily-collections.use-case';
import { DailyCollectionsTypeormReader } from '../../infrastructure/database/typeorm/repositories/daily-collections.reader';
import { PAYMENT_HISTORY_READER, PaymentHistoryUseCase, type PaymentHistoryReader } from '../../application/payment/payment-history.use-case';
import { PaymentHistoryTypeormReader } from '../../infrastructure/database/typeorm/repositories/payment-history.reader';
import { LOAN_FINANCIAL_TOTALS_READER, type LoanFinancialTotalsReader } from '../../application/loan/loan-financial-totals.reader';
import { LoanFinancialTotalsTypeormReader } from '../../infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { PaymentController } from './payment.controller';
import { PORTFOLIO_TRACKING_READER, PortfolioTrackingUseCase, type PortfolioTrackingReader } from '../../application/payment/portfolio-tracking.use-case';
import { PortfolioTrackingTypeormReader } from '../../infrastructure/database/typeorm/repositories/portfolio-tracking.reader';
import { RetroactivePeriodGuard } from '../../application/financial-close/retroactive-period.guard';
import { FinancialCloseModule } from '../financial-close/financial-close.module';
import { COLLECTION_AGENDA_READER, CollectionAgendaUseCase, type CollectionAgendaReader } from '../../application/payment/collection-agenda.use-case';
import { CollectionAgendaTypeormReader } from '../../infrastructure/database/typeorm/repositories/collection-agenda.reader';
import { COLLECTOR_PAYMENTS_REPORT_READER, CollectorPaymentsReportUseCase, type CollectorPaymentsReportReader } from '../../application/payment/collector-payments-report.use-case';
import { CollectorPaymentsReportTypeormReader } from '../../infrastructure/database/typeorm/repositories/collector-payments-report.reader';
@Module({ imports: [FinancialCloseModule], controllers: [PaymentController], providers: [
  { provide: LOAN_FINANCIAL_TOTALS_READER, useClass: LoanFinancialTotalsTypeormReader },
  { provide: RegisterPaymentUseCase, inject: [DataSource, LOAN_FINANCIAL_TOTALS_READER, RetroactivePeriodGuard], useFactory: (dataSource: DataSource, reader: LoanFinancialTotalsReader, guard: RetroactivePeriodGuard) => new RegisterPaymentUseCase(dataSource, reader, guard) },
  { provide: PaymentContextUseCase, inject: [DataSource, LOAN_FINANCIAL_TOTALS_READER], useFactory: (dataSource: DataSource, reader: LoanFinancialTotalsReader) => new PaymentContextUseCase(dataSource, reader) },
  { provide: CustomizePaymentPlanUseCase, inject: [DataSource, LOAN_FINANCIAL_TOTALS_READER], useFactory: (dataSource: DataSource, reader: LoanFinancialTotalsReader) => new CustomizePaymentPlanUseCase(dataSource, reader) },
  { provide: DAILY_COLLECTIONS_READER, inject: [DataSource], useFactory: (dataSource: DataSource) => new DailyCollectionsTypeormReader(dataSource) },
  { provide: DailyCollectionsUseCase, inject: [DAILY_COLLECTIONS_READER], useFactory: (reader: DailyCollectionsReader) => new DailyCollectionsUseCase(reader) },
  { provide: COLLECTION_AGENDA_READER, inject: [DataSource], useFactory: (dataSource: DataSource) => new CollectionAgendaTypeormReader(dataSource) },
  { provide: CollectionAgendaUseCase, inject: [COLLECTION_AGENDA_READER], useFactory: (reader: CollectionAgendaReader) => new CollectionAgendaUseCase(reader) },
  { provide: PAYMENT_HISTORY_READER, inject: [DataSource], useFactory: (dataSource: DataSource) => new PaymentHistoryTypeormReader(dataSource) },
  { provide: PaymentHistoryUseCase, inject: [PAYMENT_HISTORY_READER], useFactory: (reader: PaymentHistoryReader) => new PaymentHistoryUseCase(reader) },
  { provide: COLLECTOR_PAYMENTS_REPORT_READER, inject: [DataSource], useFactory: (dataSource: DataSource) => new CollectorPaymentsReportTypeormReader(dataSource) },
  { provide: CollectorPaymentsReportUseCase, inject: [COLLECTOR_PAYMENTS_REPORT_READER], useFactory: (reader: CollectorPaymentsReportReader) => new CollectorPaymentsReportUseCase(reader) },
  { provide: PORTFOLIO_TRACKING_READER, inject: [DataSource], useFactory: (dataSource: DataSource) => new PortfolioTrackingTypeormReader(dataSource) },
  { provide: PortfolioTrackingUseCase, inject: [PORTFOLIO_TRACKING_READER, PaymentContextUseCase], useFactory: (reader: PortfolioTrackingReader, context: PaymentContextUseCase) => new PortfolioTrackingUseCase(reader, context) },
] })
export class PaymentModule {}
