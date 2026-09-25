import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CurrentIdentity } from '../../domain/security/security.types';
import { PERMISSIONS_KEY, PUBLIC_KEY } from './security.decorators';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    const identity = context.switchToHttp().getRequest<{ currentUser?: CurrentIdentity }>().currentUser;
    if (identity?.role.isSuperAdmin) return true;
    if (required.some((permission) => identity?.permissions.includes(permission))) return true;
    throw new ForbiddenException();
  }
}
