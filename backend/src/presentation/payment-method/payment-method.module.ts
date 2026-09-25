import { Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PAYMENT_METHOD_REPOSITORY, type PaymentMethodRepository } from '../../application/payment-method/payment-method.repository';
import { ChangePaymentMethodStatusUseCase, CreatePaymentMethodUseCase, GetPaymentMethodUseCase, ListPaymentMethodsUseCase, UpdatePaymentMethodUseCase } from '../../application/payment-method/payment-method.use-cases';
import { PaymentMethodOrmEntity } from '../../infrastructure/database/typeorm/entities';
import { PaymentMethodTypeOrmRepository } from '../../infrastructure/database/typeorm/repositories/payment-method.typeorm-repository';
import { PaymentMethodController } from './payment-method.controller';

@Module({ imports: [TypeOrmModule.forFeature([PaymentMethodOrmEntity])], controllers: [PaymentMethodController], providers: [
  { provide: PAYMENT_METHOD_REPOSITORY, inject: [getRepositoryToken(PaymentMethodOrmEntity)], useFactory: (repository: Repository<PaymentMethodOrmEntity>) => new PaymentMethodTypeOrmRepository(repository) },
  ...[ListPaymentMethodsUseCase, GetPaymentMethodUseCase, CreatePaymentMethodUseCase, UpdatePaymentMethodUseCase, ChangePaymentMethodStatusUseCase].map((useCase) => ({ provide: useCase, inject: [PAYMENT_METHOD_REPOSITORY], useFactory: (repository: PaymentMethodRepository) => new useCase(repository) })),
] })
export class PaymentMethodModule {}
