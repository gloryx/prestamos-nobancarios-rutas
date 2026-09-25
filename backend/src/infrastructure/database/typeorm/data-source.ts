import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { CantonOrmEntity, CustomerAddressOrmEntity, CustomerOrmEntity, DistrictOrmEntity, PaymentFrequencyOrmEntity, PaymentMethodOrmEntity, ProvinceOrmEntity, RouteOrmEntity, RoleOrmEntity, PermissionOrmEntity, RolePermissionOrmEntity, UserOrmEntity, UserSessionOrmEntity } from './entities';

config();

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required`);
  return value;
};

export const appDataSource = new DataSource({
  type: 'postgres',
  host: required('DB_HOST'),
  port: Number(process.env.DB_PORT ?? 5432),
  username: required('DB_USERNAME'),
  password: required('DB_PASSWORD'),
  database: required('DB_DATABASE'),
  entities: [ProvinceOrmEntity, CantonOrmEntity, DistrictOrmEntity, PaymentMethodOrmEntity, PaymentFrequencyOrmEntity, RouteOrmEntity, CustomerOrmEntity, CustomerAddressOrmEntity, RoleOrmEntity, PermissionOrmEntity, RolePermissionOrmEntity, UserOrmEntity, UserSessionOrmEntity],
  migrations: ['src/infrastructure/database/typeorm/migrations/*{.ts,.js}'],
  synchronize: false,
});
