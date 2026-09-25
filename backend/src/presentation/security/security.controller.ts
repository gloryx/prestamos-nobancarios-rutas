import { BadRequestException, Body, ConflictException, Controller, Get, HttpException, NotFoundException, Param, Patch, Post, Put, Query, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentIdentity } from '../../domain/security/security.types';
import { SecurityService } from '../../application/security/security.service';
import { SecurityConflictError, SecurityNotFoundError, SecurityRateLimitError, SecurityUnauthorizedError, SecurityValidationError } from '../../application/security/security.errors';
import { CurrentUser, Public, RequirePermissions } from './security.decorators';
import { AssignRoleDto, ChangePasswordDto, CreateUserDto, LoginDto, ResetPasswordDto, RolePermissionsDto, UpdateUserDto, UserQueryDto, UserStatusDto } from './security.dto';
import { SESSION_COOKIE } from '../../shared/constants/security';

const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/' });
const mapError = (error: unknown): never => { if (error instanceof SecurityRateLimitError) throw new HttpException('Demasiados intentos de inicio de sesión.', 429); if (error instanceof SecurityUnauthorizedError) throw new UnauthorizedException('Usuario o contraseña inválidos.'); if (error instanceof SecurityConflictError) throw new ConflictException('No se pudo guardar el usuario.'); if (error instanceof SecurityNotFoundError) throw new NotFoundException(); if (error instanceof SecurityValidationError) throw new BadRequestException(error.message); throw error; };

@Controller('auth')
export class AuthController {
  constructor(private readonly security: SecurityService) {}
  @Public() @Post('login') async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) { try { const result = await this.security.login(body.username, body.password); response.cookie(SESSION_COOKIE, result.token, { ...cookieOptions(), maxAge: Number(process.env.AUTH_SESSION_TTL_HOURS ?? 12) * 3600000 }); return this.security.profile(result.identity); } catch (error) { return mapError(error); } }
  @Post('logout') async logout(@CurrentUser() identity: CurrentIdentity, @Res({ passthrough: true }) response: Response) { await this.security.logout(identity); response.clearCookie(SESSION_COOKIE, cookieOptions()); return { success: true }; }
  @Get('me') me(@CurrentUser() identity: CurrentIdentity) { return this.security.profile(identity); }
  @Post('change-password') async change(@CurrentUser() identity: CurrentIdentity, @Body() body: ChangePasswordDto) { try { await this.security.changePassword(identity, body.currentPassword, body.newPassword); return { success: true }; } catch (error) { return mapError(error); } }
}

@Controller('users')
export class UsersController {
  constructor(private readonly security: SecurityService) {}
  @RequirePermissions('users.view') @Get() list(@Query() query: UserQueryDto) { return this.security.listUsers({ search: query.search, status: query.status, roleId: query.roleId, page: Math.max(1, Number(query.page ?? 1)), pageSize: Math.min(100, Math.max(1, Number(query.pageSize ?? 20))) }); }
  @RequirePermissions('users.view') @Get(':id') async detail(@Param('id') id: string) { try { return await this.security.getUser(id); } catch (error) { return mapError(error); } }
  @RequirePermissions('users.create') @Post() async create(@Body() body: CreateUserDto, @CurrentUser() actor: CurrentIdentity) { try { return await this.security.createUser(body, actor); } catch (error) { return mapError(error); } }
  @RequirePermissions('users.update') @Patch(':id') async update(@Param('id') id: string, @Body() body: UpdateUserDto) { try { return await this.security.updateUser(id, body); } catch (error) { return mapError(error); } }
  @RequirePermissions('users.status.change') @Patch(':id/status') async status(@Param('id') id: string, @Body() body: UserStatusDto) { try { return await this.security.changeUserStatus(id, body.isActive); } catch (error) { return mapError(error); } }
  @RequirePermissions('users.role.assign') @Patch(':id/role') async role(@Param('id') id: string, @Body() body: AssignRoleDto, @CurrentUser() actor: CurrentIdentity) { try { return await this.security.assignRole(id, body.roleId, actor); } catch (error) { return mapError(error); } }
  @RequirePermissions('users.password.reset') @Post(':id/reset-password') async reset(@Param('id') id: string, @Body() body: ResetPasswordDto) { try { await this.security.resetPassword(id, body.password); return { success: true }; } catch (error) { return mapError(error); } }
}

@Controller('roles')
export class RolesController {
  constructor(private readonly security: SecurityService) {}
  @RequirePermissions('roles.view') @Get() roles() { return this.security.roles(); }
  @RequirePermissions('roles.view') @Get(':id/permissions') async rolePermissions(@Param('id') id: string) { try { return await this.security.rolePermissions(id); } catch (error) { return mapError(error); } }
  @RequirePermissions('roles.permissions.update') @Put(':id/permissions') async update(@Param('id') id: string, @Body() body: RolePermissionsDto) { try { return await this.security.replaceRolePermissions(id, body.permissionCodes); } catch (error) { return mapError(error); } }
}

@Controller('permissions')
export class PermissionsController { constructor(private readonly security: SecurityService) {} @RequirePermissions('roles.view') @Get() permissions() { return this.security.permissions(); } }
