import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CustomizePaymentPlanUseCase, PaymentContextUseCase, RegisterPaymentUseCase } from '../../application/payment/payment.use-case';
import { LOAN_FINANCIAL_TOTALS_READER, type LoanFinancialTotalsReader } from '../../application/loan/loan-financial-totals.reader';
import { LoanFinancialTotalsTypeormReader } from '../../infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { PaymentController } from './payment.controller';
@Module({ controllers: [PaymentController], providers: [
  { provide: LOAN_FINANCIAL_TOTALS_READER, useClass: LoanFinancialTotalsTypeormReader },
  { provide: RegisterPaymentUseCase, inject: [DataSource, LOAN_FINANCIAL_TOTALS_READER], useFactory: (dataSource: DataSource, reader: LoanFinancialTotalsReader) => new RegisterPaymentUseCase(dataSource, reader) },
  { provide: PaymentContextUseCase, inject: [DataSource, LOAN_FINANCIAL_TOTALS_READER], useFactory: (dataSource: DataSource, reader: LoanFinancialTotalsReader) => new PaymentContextUseCase(dataSource, reader) },
  { provide: CustomizePaymentPlanUseCase, inject: [DataSource, LOAN_FINANCIAL_TOTALS_READER], useFactory: (dataSource: DataSource, reader: LoanFinancialTotalsReader) => new CustomizePaymentPlanUseCase(dataSource, reader) },
] })
export class PaymentModule {}
