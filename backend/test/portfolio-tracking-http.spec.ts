import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PortfolioTrackingUseCase } from '../src/application/payment/portfolio-tracking.use-case';
import { PaymentValidationError } from '../src/application/payment/payment.errors';
import { CustomizePaymentPlanUseCase, PaymentContextUseCase, RegisterPaymentUseCase } from '../src/application/payment/payment.use-case';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const identity = (permissions: string[], isSuperAdmin = false) => ({ id: 'u', username: 'test', fullName: 'Test',
  role: { id: 'r', code: 'TEST', name: 'Test', isSuperAdmin }, permissions, sessionId: 's' });
const result = { position: 0, total: 0, hasPrevious: false, hasNext: false, loan: null };

describe('portfolio tracking HTTP boundary', () => {
  const execute = jest.fn(async () => result);
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'payments') return identity(['payments.view']);
    if (token === 'loans') return identity(['loans.view']);
    if (token === 'super') return identity([], true);
    throw new SecurityUnauthorizedError();
  });
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [PaymentController], providers: [
      { provide: RegisterPaymentUseCase, useValue: {} }, { provide: PaymentContextUseCase, useValue: {} },
      { provide: CustomizePaymentPlanUseCase, useValue: {} }, { provide: PortfolioTrackingUseCase, useValue: { execute } },
      { provide: SecurityService, useValue: { authenticate } },
      { provide: APP_GUARD, useClass: AuthenticationGuard }, { provide: APP_GUARD, useClass: PermissionGuard },
    ] }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    close = () => app.close();
  });
  afterAll(async () => close?.());
  beforeEach(() => execute.mockReset().mockResolvedValue(result));
  const get = (query: string, token?: string) => fetch(`${base}/payments/portfolio-tracking${query}`, {
    headers: { ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
  });

  it('requires payments.view and preserves the central superadmin bypass', async () => {
    expect((await get('')).status).toBe(401);
    expect((await get('', 'loans')).status).toBe(403);
    expect((await get('', 'payments')).status).toBe(200);
    expect((await get('', 'super')).status).toBe(200);
  });

  it('forwards combined operational filters and position with server-side defaults', async () => {
    expect((await get('?search=Mar%C3%ADa&status=ACTIVE&collectionStatus=OVERDUE&position=7', 'payments')).status).toBe(200);
    expect(execute).toHaveBeenLastCalledWith({ search: 'María', status: 'ACTIVE', collectionStatus: 'OVERDUE', position: 7 });
    expect((await get('', 'payments')).status).toBe(200);
    expect(execute).toHaveBeenLastCalledWith({ search: '', status: 'ALL', collectionStatus: 'ALL', position: 1 });
  });

  it('rejects historical statuses, invalid collection filters, positions and unknown fields', async () => {
    execute.mockClear();
    for (const query of ['?status=CANCELLED', '?status=ANNULLED', '?collectionStatus=COLLECTED', '?position=0', '?position=1.5', '?page=1'])
      expect((await get(query, 'payments')).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('maps application validation through the existing payment error boundary', async () => {
    execute.mockRejectedValueOnce(new PaymentValidationError('Invalid portfolio query.'));
    expect((await get('', 'payments')).status).toBe(400);
  });
});
