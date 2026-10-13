import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  COLLECTOR_PRECOLLECTION_CLOCK,
  COLLECTOR_PRECOLLECTION_STORE,
  CancelCollectorPrecollectionUseCase,
  CreateCollectorPrecollectionUseCase,
  GetCollectorPrecollectionDetailUseCase,
  ListCollectorPrecollectionsUseCase,
  ListMyCollectorPrecollectionsUseCase,
} from '../../application/collector-precollection/collector-precollection.use-cases';
import type {
  CollectorPrecollectionClock,
  CollectorPrecollectionStore,
} from '../../application/collector-precollection/collector-precollection.ports';
import { CollectorPrecollectionTypeOrmStore } from '../../infrastructure/database/typeorm/repositories/collector-precollection.typeorm-store';
import { CostaRicaClock } from '../../infrastructure/time/costa-rica.clock';
import { CollectorPrecollectionController } from './collector-precollection.controller';

@Module({
  controllers: [CollectorPrecollectionController],
  providers: [
    { provide: COLLECTOR_PRECOLLECTION_STORE, inject: [DataSource],
      useFactory: (source: DataSource) => new CollectorPrecollectionTypeOrmStore(source) },
    { provide: COLLECTOR_PRECOLLECTION_CLOCK, useClass: CostaRicaClock },
    { provide: CreateCollectorPrecollectionUseCase, inject: [COLLECTOR_PRECOLLECTION_STORE, COLLECTOR_PRECOLLECTION_CLOCK],
      useFactory: (store: CollectorPrecollectionStore, clock: CollectorPrecollectionClock) => new CreateCollectorPrecollectionUseCase(store, clock) },
    { provide: ListMyCollectorPrecollectionsUseCase, inject: [COLLECTOR_PRECOLLECTION_STORE, COLLECTOR_PRECOLLECTION_CLOCK],
      useFactory: (store: CollectorPrecollectionStore, clock: CollectorPrecollectionClock) => new ListMyCollectorPrecollectionsUseCase(store, clock) },
    { provide: ListCollectorPrecollectionsUseCase, inject: [COLLECTOR_PRECOLLECTION_STORE, COLLECTOR_PRECOLLECTION_CLOCK],
      useFactory: (store: CollectorPrecollectionStore, clock: CollectorPrecollectionClock) => new ListCollectorPrecollectionsUseCase(store, clock) },
    { provide: GetCollectorPrecollectionDetailUseCase, inject: [COLLECTOR_PRECOLLECTION_STORE],
      useFactory: (store: CollectorPrecollectionStore) => new GetCollectorPrecollectionDetailUseCase(store) },
    { provide: CancelCollectorPrecollectionUseCase, inject: [COLLECTOR_PRECOLLECTION_STORE],
      useFactory: (store: CollectorPrecollectionStore) => new CancelCollectorPrecollectionUseCase(store) },
  ],
})
export class CollectorPrecollectionModule {}
