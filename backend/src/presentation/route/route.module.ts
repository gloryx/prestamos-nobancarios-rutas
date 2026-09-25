import { Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ROUTE_REPOSITORY, type RouteRepository } from '../../application/route/route.repository';
import { ChangeRouteStatusUseCase, CreateRouteUseCase, GetRouteUseCase, ListRoutesUseCase, UpdateRouteUseCase } from '../../application/route/route.use-cases';
import { RouteOrmEntity } from '../../infrastructure/database/typeorm/entities';
import { RouteTypeOrmRepository } from '../../infrastructure/database/typeorm/repositories/route.typeorm-repository';
import { RouteController } from './route.controller';

@Module({ imports: [TypeOrmModule.forFeature([RouteOrmEntity])], controllers: [RouteController], providers: [
  { provide: ROUTE_REPOSITORY, inject: [getRepositoryToken(RouteOrmEntity)], useFactory: (repository: Repository<RouteOrmEntity>) => new RouteTypeOrmRepository(repository) },
  ...[ListRoutesUseCase, GetRouteUseCase, CreateRouteUseCase, UpdateRouteUseCase, ChangeRouteStatusUseCase].map((useCase) => ({ provide: useCase, inject: [ROUTE_REPOSITORY], useFactory: (repository: RouteRepository) => new useCase(repository) })),
] })
export class RouteModule {}
