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
@Module({ controllers: [PaymentController], providers: [
  { provide: LOAN_FINANCIAL_TOTALS_READER, useClass: LoanFinancialTotalsTypeormReader },
  { provide: RegisterPaymentUseCase, inject: [DataSource, LOAN_FINANCIAL_TOTALS_READER], useFactory: (dataSource: DataSource, reader: LoanFinancialTotalsReader) => new RegisterPaymentUseCase(dataSource, reader) },
  { provide: PaymentContextUseCase, inject: [DataSource, LOAN_FINANCIAL_TOTALS_READER], useFactory: (dataSource: DataSource, reader: LoanFinancialTotalsReader) => new PaymentContextUseCase(dataSource, reader) },
  { provide: CustomizePaymentPlanUseCase, inject: [DataSource, LOAN_FINANCIAL_TOTALS_READER], useFactory: (dataSource: DataSource, reader: LoanFinancialTotalsReader) => new CustomizePaymentPlanUseCase(dataSource, reader) },
  { provide: DAILY_COLLECTIONS_READER, inject: [DataSource], useFactory: (dataSource: DataSource) => new DailyCollectionsTypeormReader(dataSource) },
  { provide: DailyCollectionsUseCase, inject: [DAILY_COLLECTIONS_READER], useFactory: (reader: DailyCollectionsReader) => new DailyCollectionsUseCase(reader) },
  { provide: PAYMENT_HISTORY_READER, inject: [DataSource], useFactory: (dataSource: DataSource) => new PaymentHistoryTypeormReader(dataSource) },
  { provide: PaymentHistoryUseCase, inject: [PAYMENT_HISTORY_READER], useFactory: (reader: PaymentHistoryReader) => new PaymentHistoryUseCase(reader) },
  { provide: PORTFOLIO_TRACKING_READER, inject: [DataSource], useFactory: (dataSource: DataSource) => new PortfolioTrackingTypeormReader(dataSource) },
  { provide: PortfolioTrackingUseCase, inject: [PORTFOLIO_TRACKING_READER, PaymentContextUseCase], useFactory: (reader: PortfolioTrackingReader, context: PaymentContextUseCase) => new PortfolioTrackingUseCase(reader, context) },
] })
export class PaymentModule {}
