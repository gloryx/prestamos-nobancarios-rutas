import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CustomizePaymentPlanUseCase, PaymentContextUseCase, RegisterPaymentUseCase } from '../../application/payment/payment.use-case';
import { PaymentController } from './payment.controller';
@Module({ controllers: [PaymentController], providers: [{ provide: RegisterPaymentUseCase, inject: [DataSource], useFactory: (dataSource: DataSource) => new RegisterPaymentUseCase(dataSource) }, { provide: PaymentContextUseCase, inject: [DataSource], useFactory: (dataSource: DataSource) => new PaymentContextUseCase(dataSource) }, { provide: CustomizePaymentPlanUseCase, inject: [DataSource], useFactory: (dataSource: DataSource) => new CustomizePaymentPlanUseCase(dataSource) }] })
export class PaymentModule {}
