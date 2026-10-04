import { Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CollectorUseCases } from '../../application/collector/collector.use-cases';
import { COLLECTOR_STATISTICS_READER, CollectorStatisticsUseCase, type CollectorStatisticsReader } from '../../application/collector/collector-statistics.use-case';
import { COLLECTOR_REPOSITORY, type CollectorRepository } from '../../application/collector/collector.repository';
import { FILE_STORAGE, type FileStorage } from '../../application/customer/file-storage';
import { CollectorOrmEntity, UserOrmEntity } from '../../infrastructure/database/typeorm/entities';
import { CollectorTypeOrmRepository } from '../../infrastructure/database/typeorm/repositories/collector.typeorm-repository';
import { CollectorStatisticsTypeOrmReader } from '../../infrastructure/database/typeorm/repositories/collector-statistics.reader';
import { LocalFileStorage } from '../../infrastructure/storage/local-file.storage';
import { CollectorController } from './collector.controller';

@Module({ imports: [TypeOrmModule.forFeature([CollectorOrmEntity, UserOrmEntity])], controllers: [CollectorController], providers: [
  { provide: COLLECTOR_REPOSITORY, inject: [getRepositoryToken(CollectorOrmEntity), getRepositoryToken(UserOrmEntity)], useFactory: (collectors: Repository<CollectorOrmEntity>, users: Repository<UserOrmEntity>) => new CollectorTypeOrmRepository(collectors, users) },
  { provide: FILE_STORAGE, useFactory: () => new LocalFileStorage() },
  { provide: COLLECTOR_STATISTICS_READER, inject: [DataSource], useFactory: (source: DataSource) => new CollectorStatisticsTypeOrmReader(source) },
  { provide: CollectorStatisticsUseCase, inject: [COLLECTOR_STATISTICS_READER], useFactory: (reader: CollectorStatisticsReader) => new CollectorStatisticsUseCase(reader) },
  { provide: CollectorUseCases, inject: [COLLECTOR_REPOSITORY, FILE_STORAGE], useFactory: (repository: CollectorRepository, storage: FileStorage) => new CollectorUseCases(repository, storage) },
] })
export class CollectorModule {}
