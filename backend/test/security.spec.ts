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
       'routes.view', 'routes.create', 'routes.update', 'routes.status.change', 'routes.export', 'routes.assign.collectors', 'routes.assign.customers',
       'customers.view', 'customers.create', 'customers.update', 'customers.status.change', 'customers.summary.view', 'customers.files.view', 'customers.export', 'customers.assigned.view', 'customers.site.view', 'customers.site.capture', 'customers.site.replace', 'customers.site.replace.authorize',
       'users.view', 'users.create', 'users.update', 'users.status.change', 'users.password.reset', 'users.role.assign', 'roles.view', 'roles.permissions.update',
       'collectors.view', 'collectors.create', 'collectors.update', 'collectors.status.change', 'collectors.user.assign', 'collectors.photo.view',
       'financial-opening.view', 'financial-opening.perform', 'cash-movements.view', 'cash-movements.create', 'cash-movements.reverse', 'cash-movements.export',
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

describe('customer generic PATCH site boundary', () => {
  const actor = (permissions: string[], isSuperAdmin = false) => ({ id: 'u', username: 'u', fullName: 'U', role: { id: 'r', code: 'R', name: 'R', isSuperAdmin }, permissions, sessionId: 's' });
  const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0]), mimetype: 'image/jpeg', size: 4 } as Express.Multer.File;

  it('rejects scoped site updates instead of allowing the generic customer PATCH to bypass site authorization', async () => {
    const update = jest.fn();
    const controller = new CustomerController({} as never, { update } as never);

    await expect(controller.update('customer-1', { latitude: '9.9', longitude: '-84.1' }, {}, actor(['customers.update']) as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps the generic site edit path for broad admins and superadmins', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'customer-1' });
    const controller = new CustomerController({} as never, { update } as never);

    await controller.update('customer-1', { latitude: '9.9', longitude: '-84.1' }, { propertyPhoto: [file] }, actor(['customers.update', 'customers.view']) as never);
    expect(update).toHaveBeenCalledWith('customer-1', expect.objectContaining({ latitude: 9.9, longitude: -84.1, propertyPhoto: file }));
    await controller.update('customer-1', { latitude: '9.9', longitude: '-84.1' }, { propertyPhoto: [file] }, actor(['customers.update'], true) as never);
    expect(update).toHaveBeenCalledTimes(2);
  });
});
