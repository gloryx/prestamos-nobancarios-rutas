import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SecurityService } from '../../application/security/security.service';
import { CurrentIdentity } from '../../domain/security/security.types';
import { SecurityUnauthorizedError } from '../../application/security/security.errors';
import { UnauthorizedException } from '@nestjs/common';
import { PUBLIC_KEY } from './security.decorators';
import { Request } from 'express';
import { SESSION_COOKIE } from '../../shared/constants/security';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: SecurityService) {}
  async canActivate(context: ExecutionContext) { if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true; const request = context.switchToHttp().getRequest<Request & { currentUser: CurrentIdentity }>(); const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`)); try { request.currentUser = await this.auth.authenticate(cookie?.slice(SESSION_COOKIE.length + 1)); return true; } catch (error) { if (error instanceof SecurityUnauthorizedError) throw new UnauthorizedException(); throw error; } }
}
