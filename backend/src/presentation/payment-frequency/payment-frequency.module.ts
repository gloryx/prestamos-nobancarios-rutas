import { Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PAYMENT_FREQUENCY_REPOSITORY, type PaymentFrequencyRepository } from '../../application/payment-frequency/payment-frequency.repository';
import { ChangePaymentFrequencyStatusUseCase, CreatePaymentFrequencyUseCase, GetPaymentFrequencyUseCase, ListPaymentFrequenciesUseCase, UpdatePaymentFrequencyUseCase } from '../../application/payment-frequency/payment-frequency.use-cases';
import { PaymentFrequencyOrmEntity } from '../../infrastructure/database/typeorm/entities';
import { PaymentFrequencyTypeOrmRepository } from '../../infrastructure/database/typeorm/repositories/payment-frequency.typeorm-repository';
import { PaymentFrequencyController } from './payment-frequency.controller';

@Module({ imports: [TypeOrmModule.forFeature([PaymentFrequencyOrmEntity])], controllers: [PaymentFrequencyController], providers: [
  { provide: PAYMENT_FREQUENCY_REPOSITORY, inject: [getRepositoryToken(PaymentFrequencyOrmEntity)], useFactory: (repository: Repository<PaymentFrequencyOrmEntity>) => new PaymentFrequencyTypeOrmRepository(repository) },
  ...[ListPaymentFrequenciesUseCase, GetPaymentFrequencyUseCase, CreatePaymentFrequencyUseCase, UpdatePaymentFrequencyUseCase, ChangePaymentFrequencyStatusUseCase].map((useCase) => ({ provide: useCase, inject: [PAYMENT_FREQUENCY_REPOSITORY], useFactory: (repository: PaymentFrequencyRepository) => new useCase(repository) })),
] })
export class PaymentFrequencyModule {}
