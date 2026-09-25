import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionOrmEntity, RoleOrmEntity, RolePermissionOrmEntity, UserOrmEntity, UserSessionOrmEntity } from '../../infrastructure/database/typeorm/entities';
import { AuthController, PermissionsController, RolesController, UsersController } from './security.controller';
import { AuthenticationGuard } from './auth.guard';
import { PermissionGuard } from './permission.guard';
import { SECURITY_REPOSITORY, PASSWORD_HASHER, SECURE_TOKEN_GENERATOR, SecurityRepository } from '../../application/security/security.ports';
import { SecurityService } from '../../application/security/security.service';
import { SecurityTypeOrmRepository } from '../../infrastructure/database/typeorm/repositories/security.typeorm-repository';
import { Argon2PasswordHasher } from '../../infrastructure/security/argon2-password-hasher';
import { CryptoTokenGenerator } from '../../infrastructure/security/crypto-token-generator';

@Module({ imports: [TypeOrmModule.forFeature([UserOrmEntity, UserSessionOrmEntity, RoleOrmEntity, PermissionOrmEntity, RolePermissionOrmEntity])], controllers: [AuthController, UsersController, RolesController, PermissionsController], providers: [
  { provide: SECURITY_REPOSITORY, useClass: SecurityTypeOrmRepository },
  { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
  { provide: SECURE_TOKEN_GENERATOR, useClass: CryptoTokenGenerator },
  { provide: SecurityService, inject: [SECURITY_REPOSITORY, PASSWORD_HASHER, SECURE_TOKEN_GENERATOR], useFactory: (repository: SecurityRepository, hasher: Argon2PasswordHasher, tokens: CryptoTokenGenerator) => new SecurityService(repository, hasher, tokens, Number(process.env.AUTH_SESSION_TTL_HOURS ?? 12)) },
  { provide: APP_GUARD, useClass: AuthenticationGuard }, { provide: APP_GUARD, useClass: PermissionGuard },
], exports: [SecurityService] })
export class SecurityModule {}
