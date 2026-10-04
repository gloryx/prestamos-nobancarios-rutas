import { Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CUSTOMER_REPOSITORY, type CustomerRepository } from '../../application/customer/customer.repository';
import { FILE_STORAGE, type FileStorage } from '../../application/customer/file-storage';
import { CustomerManagementUseCase, RegisterCustomerUseCase } from '../../application/customer/customer.use-case';
import { CUSTOMER_FINANCIAL_ANALYSIS_READER, CustomerFinancialAnalysisUseCase, type CustomerFinancialAnalysisReader } from '../../application/customer/customer-financial-analysis.use-case';
import { CUSTOMER_STATISTICS_READER, CustomerStatisticsUseCase, type CustomerStatisticsReader } from '../../application/customer/customer-statistics.use-case';
import { CantonOrmEntity, CustomerAddressOrmEntity, CustomerOrmEntity, DistrictOrmEntity, ProvinceOrmEntity } from '../../infrastructure/database/typeorm/entities';
import { CustomerTypeOrmRepository } from '../../infrastructure/database/typeorm/repositories/customer.typeorm-repository';
import { CustomerFinancialAnalysisTypeOrmReader } from '../../infrastructure/database/typeorm/repositories/customer-financial-analysis.reader';
import { CustomerStatisticsTypeOrmReader } from '../../infrastructure/database/typeorm/repositories/customer-statistics.reader';
import { LocalFileStorage } from '../../infrastructure/storage/local-file.storage';
import { CustomerController } from './customer.controller';
@Module({ imports: [TypeOrmModule.forFeature([CustomerOrmEntity, CustomerAddressOrmEntity, DistrictOrmEntity, CantonOrmEntity, ProvinceOrmEntity])], controllers: [CustomerController], providers: [
  { provide: CUSTOMER_REPOSITORY, inject: [getRepositoryToken(CustomerOrmEntity), getRepositoryToken(CustomerAddressOrmEntity)], useFactory: (customers: Repository<CustomerOrmEntity>, addresses: Repository<CustomerAddressOrmEntity>) => new CustomerTypeOrmRepository(customers, addresses) },
  { provide: FILE_STORAGE, useFactory: () => new LocalFileStorage() },
  { provide: CUSTOMER_FINANCIAL_ANALYSIS_READER, inject: [DataSource], useFactory: (source: DataSource) => new CustomerFinancialAnalysisTypeOrmReader(source) },
  { provide: CustomerFinancialAnalysisUseCase, inject: [CUSTOMER_FINANCIAL_ANALYSIS_READER], useFactory: (reader: CustomerFinancialAnalysisReader) => new CustomerFinancialAnalysisUseCase(reader) },
  { provide: CUSTOMER_STATISTICS_READER, inject: [DataSource], useFactory: (source: DataSource) => new CustomerStatisticsTypeOrmReader(source) },
  { provide: CustomerStatisticsUseCase, inject: [CUSTOMER_STATISTICS_READER], useFactory: (reader: CustomerStatisticsReader) => new CustomerStatisticsUseCase(reader) },
  { provide: RegisterCustomerUseCase, inject: [CUSTOMER_REPOSITORY, FILE_STORAGE, getRepositoryToken(DistrictOrmEntity)], useFactory: (repository: CustomerRepository, storage: FileStorage, districts: Repository<DistrictOrmEntity>) => new RegisterCustomerUseCase(repository, storage, async (code) => Boolean(await districts.findOneBy({ code })) ) },
  { provide: CustomerManagementUseCase, inject: [CUSTOMER_REPOSITORY, FILE_STORAGE, getRepositoryToken(DistrictOrmEntity)], useFactory: (repository: CustomerRepository, storage: FileStorage, districts: Repository<DistrictOrmEntity>) => new CustomerManagementUseCase(repository, storage, async (code) => Boolean(await districts.findOneBy({ code })) ) },
] })
export class CustomerModule {}
