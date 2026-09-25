import { Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListCantonsUseCase, ListDistrictsUseCase, ListProvincesUseCase } from '../../application/territorial/territorial.use-cases';
import { TERRITORIAL_REPOSITORY, type TerritorialRepository } from '../../application/territorial/territorial.repository';
import { CantonOrmEntity, DistrictOrmEntity, ProvinceOrmEntity } from '../../infrastructure/database/typeorm/entities';
import { TerritorialTypeOrmRepository } from '../../infrastructure/database/typeorm/repositories/territorial.typeorm-repository';
import { TerritorialController } from './territorial.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ProvinceOrmEntity, CantonOrmEntity, DistrictOrmEntity])],
  controllers: [TerritorialController],
  providers: [
    {
      provide: ListProvincesUseCase,
      inject: [TERRITORIAL_REPOSITORY],
      useFactory: (repository: TerritorialRepository) => new ListProvincesUseCase(repository),
    },
    {
      provide: ListCantonsUseCase,
      inject: [TERRITORIAL_REPOSITORY],
      useFactory: (repository: TerritorialRepository) => new ListCantonsUseCase(repository),
    },
    {
      provide: ListDistrictsUseCase,
      inject: [TERRITORIAL_REPOSITORY],
      useFactory: (repository: TerritorialRepository) => new ListDistrictsUseCase(repository),
    },
    {
      provide: TERRITORIAL_REPOSITORY,
      inject: [getRepositoryToken(ProvinceOrmEntity), getRepositoryToken(CantonOrmEntity), getRepositoryToken(DistrictOrmEntity)],
      useFactory: (provinces: Repository<ProvinceOrmEntity>, cantons: Repository<CantonOrmEntity>, districts: Repository<DistrictOrmEntity>) => new TerritorialTypeOrmRepository(provinces, cantons, districts),
    },
  ],
})
export class TerritorialModule {}
