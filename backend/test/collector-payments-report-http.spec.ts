import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CollectorPaymentsReportUseCase } from '../src/application/payment/collector-payments-report.use-case';
import { CustomizePaymentPlanUseCase, PaymentContextUseCase, RegisterPaymentUseCase } from '../src/application/payment/payment.use-case';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const identity = (permissions: string[], isSuperAdmin = false) => ({ id: 'u', username: 'test', fullName: 'Test',
  role: { id: 'r', code: 'TEST', name: 'Test', isSuperAdmin }, permissions, sessionId: 's' });
const result = { filters: { fromDate: '2026-10-01', toDate: '2026-10-31' },
  summary: { paymentsCount: 0, totalReceived: '0.00', principalApplied: '0.00', interestApplied: '0.00' },
  collectors: [], options: { collectors: [], paymentMethods: [] } };

describe('collector payments report HTTP boundary', () => {
  const execute = jest.fn(async () => result);
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'manager') return identity(['payments.view']);
    if (token === 'collector') return identity(['customers.assigned.view']);
    if (token === 'super') return identity([], true);
    throw new SecurityUnauthorizedError();
  });
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [PaymentController], providers: [
      { provide: RegisterPaymentUseCase, useValue: {} }, { provide: PaymentContextUseCase, useValue: {} },
      { provide: CustomizePaymentPlanUseCase, useValue: {} }, { provide: CollectorPaymentsReportUseCase, useValue: { execute } },
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
  const get = (query: string, token?: string) => fetch(`${base}/payments/collector-report${query}`, {
    headers: { ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
  });

  it('allows payments.view and superadmin while denying unauthenticated users and collectors', async () => {
    const query = '?fromDate=2026-10-01&toDate=2026-10-31';
    expect((await get(query)).status).toBe(401);
    expect((await get(query, 'collector')).status).toBe(403);
    expect((await get(query, 'manager')).status).toBe(200);
    expect((await get(query, 'super')).status).toBe(200);
  });

  it('forwards strict filters and rejects malformed or unrelated fields before execution', async () => {
    const valid = '?fromDate=2026-10-01&toDate=2026-10-31&collectorId=11111111-1111-4111-8111-111111111111&paymentMethodId=22222222-2222-4222-8222-222222222222';
    expect((await get(valid, 'manager')).status).toBe(200);
    expect(execute).toHaveBeenLastCalledWith({ fromDate: '2026-10-01', toDate: '2026-10-31',
      collectorId: '11111111-1111-4111-8111-111111111111', paymentMethodId: '22222222-2222-4222-8222-222222222222' });
    execute.mockClear();
    for (const query of ['?fromDate=2026-10-01', '?fromDate=bad&toDate=2026-10-31',
      '?fromDate=2026-10-01&toDate=2026-10-31&collectorId=bad', '?fromDate=2026-10-01&toDate=2026-10-31&search=ana'])
      expect((await get(query, 'manager')).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
