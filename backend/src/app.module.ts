import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as Joi from 'joi';
import { HealthController } from './presentation/health/health.controller';
import { CantonOrmEntity, CustomerAddressOrmEntity, CustomerOrmEntity, DistrictOrmEntity, PaymentFrequencyOrmEntity, PaymentMethodOrmEntity, ProvinceOrmEntity, RouteOrmEntity, RoleOrmEntity, PermissionOrmEntity, RolePermissionOrmEntity, UserOrmEntity, UserSessionOrmEntity } from './infrastructure/database/typeorm/entities';
import { TerritorialModule } from './presentation/territorial/territorial.module';
import { PaymentMethodModule } from './presentation/payment-method/payment-method.module';
import { PaymentFrequencyModule } from './presentation/payment-frequency/payment-frequency.module';
import { RouteModule } from './presentation/route/route.module';
import { CustomerModule } from './presentation/customer/customer.module';
import { SecurityModule } from './presentation/security/security.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
        PORT: Joi.number().port().default(3000),
        DB_HOST: Joi.string().required(),
        DB_PORT: Joi.number().port().default(5432),
        DB_USERNAME: Joi.string().required(),
        DB_PASSWORD: Joi.string().allow('').required(),
         DB_DATABASE: Joi.string().required(),
         AUTH_SESSION_TTL_HOURS: Joi.number().positive().default(12),
         FRONTEND_ORIGIN: Joi.string().uri().default('http://localhost:5173'),
         BOOTSTRAP_ADMIN_USERNAME: Joi.string().default('admin'),
         BOOTSTRAP_ADMIN_PASSWORD: Joi.string().allow('').default(''),
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('DB_HOST'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.getOrThrow<string>('DB_USERNAME'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_DATABASE'),
         autoLoadEntities: true,
         entities: [ProvinceOrmEntity, CantonOrmEntity, DistrictOrmEntity, PaymentMethodOrmEntity, PaymentFrequencyOrmEntity, RouteOrmEntity, CustomerOrmEntity, CustomerAddressOrmEntity, RoleOrmEntity, PermissionOrmEntity, RolePermissionOrmEntity, UserOrmEntity, UserSessionOrmEntity],
        synchronize: false,
      }),
    }),
    TerritorialModule, PaymentMethodModule, PaymentFrequencyModule, RouteModule, CustomerModule, SecurityModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
