import { Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerSiteUseCases } from '../../application/customer-site/customer-site.use-cases';
import { CUSTOMER_SITE_REPOSITORY, CustomerSiteRepository } from '../../application/customer-site/customer-site.repository';
import { FILE_STORAGE, FileStorage } from '../../application/customer/file-storage';
import { CollectorRouteAssignmentOrmEntity, CustomerAddressOrmEntity, CustomerOrmEntity, CustomerRouteAssignmentOrmEntity, CustomerSiteUpdateAuthorizationOrmEntity, RouteOrmEntity, UserOrmEntity } from '../../infrastructure/database/typeorm/entities';
import { CustomerSiteTypeOrmRepository } from '../../infrastructure/database/typeorm/repositories/customer-site.typeorm-repository';
import { LocalFileStorage } from '../../infrastructure/storage/local-file.storage';
import { CustomerSiteController } from './customer-site.controller';
import { AssignmentController } from './assignment.controller';
@Module({ imports: [TypeOrmModule.forFeature([CustomerOrmEntity, CustomerAddressOrmEntity, CustomerRouteAssignmentOrmEntity, CollectorRouteAssignmentOrmEntity, CustomerSiteUpdateAuthorizationOrmEntity, RouteOrmEntity, UserOrmEntity])], controllers: [CustomerSiteController, AssignmentController], providers: [
  { provide: CUSTOMER_SITE_REPOSITORY, inject: [getRepositoryToken(CustomerOrmEntity), getRepositoryToken(CustomerAddressOrmEntity), getRepositoryToken(CustomerRouteAssignmentOrmEntity), getRepositoryToken(CollectorRouteAssignmentOrmEntity), getRepositoryToken(CustomerSiteUpdateAuthorizationOrmEntity), getRepositoryToken(UserOrmEntity), getRepositoryToken(RouteOrmEntity)], useFactory: (customers: Repository<CustomerOrmEntity>, addresses: Repository<CustomerAddressOrmEntity>, customerAssignments: Repository<CustomerRouteAssignmentOrmEntity>, collectorAssignments: Repository<CollectorRouteAssignmentOrmEntity>, authorizations: Repository<CustomerSiteUpdateAuthorizationOrmEntity>, users: Repository<UserOrmEntity>, routes: Repository<RouteOrmEntity>) => new CustomerSiteTypeOrmRepository(customers, addresses, customerAssignments, collectorAssignments, authorizations, users, routes) },
  { provide: FILE_STORAGE, useFactory: () => new LocalFileStorage() },
  { provide: CustomerSiteUseCases, inject: [CUSTOMER_SITE_REPOSITORY, FILE_STORAGE], useFactory: (repository: CustomerSiteRepository, storage: FileStorage) => new CustomerSiteUseCases(repository, storage) },
] }) export class CustomerSiteModule {}
