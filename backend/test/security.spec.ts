import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { PERMISSIONS_KEY, PUBLIC_KEY } from '../src/presentation/security/security.decorators';
import { CustomerController } from '../src/presentation/customer/customer.controller';
import { PaymentMethodController } from '../src/presentation/payment-method/payment-method.controller';
import { PaymentFrequencyController } from '../src/presentation/payment-frequency/payment-frequency.controller';
import { RouteController } from '../src/presentation/route/route.controller';
import { COLLECTION_MANAGER_DEFAULTS, COLLECTOR_DEFAULTS, PERMISSIONS } from '../src/shared/constants/security';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { AuthController } from '../src/presentation/security/security.controller';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { SecurityService } from '../src/application/security/security.service';
import { SESSION_COOKIE } from '../src/shared/constants/security';

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

  it('authenticates /auth/me for non-superadmins without making it public or granting payment access', async () => {
    const manager = identity(['payments.view']);
    manager.role.code = 'COLLECTION_MANAGER';
    const authenticate = jest.fn().mockImplementation(async (token?: string) => {
      if (!token) throw new SecurityUnauthorizedError();
      return manager;
    });
    const auth = new AuthenticationGuard(new Reflector(), { authenticate } as never);
    const permissions = new PermissionGuard(new Reflector());
    const request: Record<string, unknown> = { headers: { cookie: `${SESSION_COOKIE}=valid-session` } };
    const me = context(AuthController.prototype.me, request);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AuthController.prototype.me)).toEqual([]);
    expect(Reflect.getMetadata(PUBLIC_KEY, AuthController.prototype.me)).toBeUndefined();
    expect(await auth.canActivate(me)).toBe(true);
    expect(authenticate).toHaveBeenCalledWith('valid-session');
    expect(permissions.canActivate(me)).toBe(true);
    expect(permissions.canActivate(context(AuthController.prototype.logout, request))).toBe(true);
    expect(permissions.canActivate(context(AuthController.prototype.change, request))).toBe(true);
    const profile = new SecurityService({} as never, {} as never, {} as never, 12).profile(manager);
    expect(profile.permissions).toEqual(['payments.view']);
    const loans = context(PaymentController.prototype.loans, request);
    expect(permissions.canActivate(loans)).toBe(true);
    const collector = identity([]);
    collector.role.code = 'COLLECTOR';
    request.currentUser = collector;
    expect(permissions.canActivate(me)).toBe(true);
    expect(() => permissions.canActivate(loans)).toThrow(ForbiddenException);
    expect(() => permissions.canActivate(context(() => undefined, request))).toThrow(ForbiddenException);
    request.currentUser = identity([], true);
    expect(permissions.canActivate(loans)).toBe(true);
    const unauthenticated = context(AuthController.prototype.me, { headers: {} });
    await expect(auth.canActivate(unauthenticated)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(() => permissions.canActivate(unauthenticated)).toThrow(ForbiddenException);
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
          'financial-opening.view', 'financial-opening.perform', 'cash-movements.view', 'cash-movements.create', 'cash-movements.reverse', 'cash-movements.export', 'loans.view', 'loans.create', 'loans.update', 'loans.export', 'loans.status.uncollectible', 'loans.status.reactivate', 'payments.view', 'payments.create', 'payments.annul', 'payments.plan.customize',
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

  it('keeps loans.update in the dynamic catalog without granting a role access or exposing a PATCH route', () => {
    expect(PERMISSIONS.filter(([code]) => code === 'loans.update')).toEqual([['loans.update', 'Editar préstamos', 'PRÉSTAMOS']]);
    expect(COLLECTION_MANAGER_DEFAULTS).not.toContain('loans.update');
    expect(COLLECTOR_DEFAULTS).not.toContain('loans.update');
    const guard = new PermissionGuard(new Reflector());
    const futureHandler = () => undefined;
    Reflect.defineMetadata(PERMISSIONS_KEY, ['loans.update'], futureHandler);
    expect(() => guard.canActivate(context(futureHandler, { currentUser: identity(['loans.view']) }))).toThrow(ForbiddenException);
    expect(guard.canActivate(context(futureHandler, { currentUser: identity(['loans.update']) }))).toBe(true);
    expect(guard.canActivate(context(futureHandler, { currentUser: identity([], true) }))).toBe(true);
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
