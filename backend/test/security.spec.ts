import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { CustomerController } from '../src/presentation/customer/customer.controller';
import { PaymentMethodController } from '../src/presentation/payment-method/payment-method.controller';
import { PaymentFrequencyController } from '../src/presentation/payment-frequency/payment-frequency.controller';
import { RouteController } from '../src/presentation/route/route.controller';
import { PERMISSIONS } from '../src/shared/constants/security';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';

const context = (handler: object, request: Record<string, unknown>): ExecutionContext => ({ getHandler: () => handler, getClass: () => Object, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext);
const identity = (permissions: string[], isSuperAdmin = false) => ({ id: 'u', username: 'u', fullName: 'U', role: { id: 'r', code: 'R', name: 'R', isSuperAdmin }, permissions, sessionId: 's' });

describe('security guards and permission metadata', () => {
  it('rejects an unauthenticated protected request', async () => {
    const auth = { authenticate: jest.fn().mockRejectedValue(new SecurityUnauthorizedError()) };
    const guard = new AuthenticationGuard(new Reflector(), auth as never);
    await expect(guard.canActivate(context(() => undefined, { headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('bypasses permissions for superadmins and rejects missing permissions', () => {
    const reflector = new Reflector(); const guard = new PermissionGuard(reflector);
    const handler = function handler() {};
    Reflect.defineMetadata(PERMISSIONS_KEY, ['customers.update'], handler);
    expect(guard.canActivate(context(handler, { currentUser: identity([], true) }))).toBe(true);
    expect(() => guard.canActivate(context(handler, { currentUser: identity(['customers.view']) }))).toThrow(ForbiddenException);
  });

  it('uses the current permission set on every request', () => {
    const reflector = new Reflector(); const guard = new PermissionGuard(reflector); const handler = function handler() {};
    Reflect.defineMetadata(PERMISSIONS_KEY, ['customers.update'], handler);
    const request = { currentUser: identity(['customers.update']) };
    expect(guard.canActivate(context(handler, request))).toBe(true);
    request.currentUser = identity(['customers.view']);
    expect(() => guard.canActivate(context(handler, request))).toThrow(ForbiddenException);
  });

  it('registers the exact customer and catalog permission codes', () => {
    const codes = new Set(PERMISSIONS.map(([code]) => code));
    expect(codes).toEqual(new Set([
      'territorial.view', 'payment-methods.view', 'payment-methods.create', 'payment-methods.update', 'payment-methods.status.change', 'payment-methods.export',
      'payment-frequencies.view', 'payment-frequencies.create', 'payment-frequencies.update', 'payment-frequencies.status.change', 'payment-frequencies.export',
      'routes.view', 'routes.create', 'routes.update', 'routes.status.change', 'routes.export',
      'customers.view', 'customers.create', 'customers.update', 'customers.status.change', 'customers.summary.view', 'customers.files.view', 'customers.export',
      'users.view', 'users.create', 'users.update', 'users.status.change', 'users.password.reset', 'users.role.assign', 'roles.view', 'roles.permissions.update',
    ]));
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CustomerController.prototype.list)).toEqual(['customers.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CustomerController.prototype.summary)).toEqual(['customers.summary.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CustomerController.prototype.file)).toEqual(['customers.files.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CustomerController.prototype.create)).toEqual(['customers.create']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CustomerController.prototype.update)).toEqual(['customers.update']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CustomerController.prototype.status)).toEqual(['customers.status.change']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentMethodController.prototype.updateOne)).toEqual(['payment-methods.update']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentFrequencyController.prototype.changeStatus)).toEqual(['payment-frequencies.status.change']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, RouteController.prototype.createOne)).toEqual(['routes.create']);
  });
});
