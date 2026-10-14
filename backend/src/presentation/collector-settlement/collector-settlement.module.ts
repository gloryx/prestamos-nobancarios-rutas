import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { COLLECTOR_SETTLEMENT_CLOCK, COLLECTOR_SETTLEMENT_STORE, ConfirmCollectorSettlementUseCase,
  CreateCollectorSettlementUseCase, GetCollectorSettlementUseCase, ListCollectorSettlementsUseCase,
  ListEligibleCollectorPrecollectionsUseCase, TransitionCollectorSettlementUseCase } from '../../application/collector-settlement/collector-settlement.use-cases';
import type { CollectorSettlementClock, CollectorSettlementStore } from '../../application/collector-settlement/collector-settlement.ports';
import { CollectorSettlementTypeOrmStore } from '../../infrastructure/database/typeorm/repositories/collector-settlement.typeorm-store';
import { CostaRicaClock } from '../../infrastructure/time/costa-rica.clock';
import { TransactionalPaymentRegistrar } from '../../application/payment/payment.use-case';
import { PaymentModule } from '../payment/payment.module';
import { CollectorSettlementController } from './collector-settlement.controller';

@Module({ imports: [PaymentModule], controllers: [CollectorSettlementController], providers: [
  { provide: COLLECTOR_SETTLEMENT_CLOCK, useClass: CostaRicaClock },
  { provide: COLLECTOR_SETTLEMENT_STORE, inject: [DataSource, TransactionalPaymentRegistrar],
    useFactory: (source: DataSource, registrar: TransactionalPaymentRegistrar) => new CollectorSettlementTypeOrmStore(source, registrar) },
  { provide: CreateCollectorSettlementUseCase, inject: [COLLECTOR_SETTLEMENT_STORE], useFactory: (store: CollectorSettlementStore) => new CreateCollectorSettlementUseCase(store) },
  { provide: ListCollectorSettlementsUseCase, inject: [COLLECTOR_SETTLEMENT_STORE], useFactory: (store: CollectorSettlementStore) => new ListCollectorSettlementsUseCase(store) },
  { provide: ListEligibleCollectorPrecollectionsUseCase, inject: [COLLECTOR_SETTLEMENT_STORE], useFactory: (store: CollectorSettlementStore) => new ListEligibleCollectorPrecollectionsUseCase(store) },
  { provide: GetCollectorSettlementUseCase, inject: [COLLECTOR_SETTLEMENT_STORE], useFactory: (store: CollectorSettlementStore) => new GetCollectorSettlementUseCase(store) },
  { provide: TransitionCollectorSettlementUseCase, inject: [COLLECTOR_SETTLEMENT_STORE], useFactory: (store: CollectorSettlementStore) => new TransitionCollectorSettlementUseCase(store) },
  { provide: ConfirmCollectorSettlementUseCase, inject: [COLLECTOR_SETTLEMENT_STORE, COLLECTOR_SETTLEMENT_CLOCK],
    useFactory: (store: CollectorSettlementStore, clock: CollectorSettlementClock) => new ConfirmCollectorSettlementUseCase(store, clock) },
] })
export class CollectorSettlementModule {}
