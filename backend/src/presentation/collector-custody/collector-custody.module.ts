import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { COLLECTOR_CUSTODY_CLOCK, COLLECTOR_CUSTODY_STORE, RecordCollectorCustodyUseCase,
  ViewCollectorCustodyUseCase } from '../../application/collector-custody/collector-custody.use-cases';
import type { CollectorCustodyClock, CollectorCustodyStore } from '../../application/collector-custody/collector-custody.ports';
import { CollectorCustodyTypeOrmStore } from '../../infrastructure/database/typeorm/repositories/collector-custody.typeorm-store';
import { CostaRicaClock } from '../../infrastructure/time/costa-rica.clock';
import { CollectorCustodyController } from './collector-custody.controller';

@Module({ controllers: [CollectorCustodyController], providers: [
  { provide: COLLECTOR_CUSTODY_CLOCK, useClass: CostaRicaClock },
  { provide: COLLECTOR_CUSTODY_STORE, inject: [DataSource], useFactory: (source: DataSource) => new CollectorCustodyTypeOrmStore(source) },
  { provide: ViewCollectorCustodyUseCase, inject: [COLLECTOR_CUSTODY_STORE], useFactory: (store: CollectorCustodyStore) => new ViewCollectorCustodyUseCase(store) },
  { provide: RecordCollectorCustodyUseCase, inject: [COLLECTOR_CUSTODY_STORE, COLLECTOR_CUSTODY_CLOCK],
    useFactory: (store: CollectorCustodyStore, clock: CollectorCustodyClock) => new RecordCollectorCustodyUseCase(store, clock) },
] })
export class CollectorCustodyModule {}
