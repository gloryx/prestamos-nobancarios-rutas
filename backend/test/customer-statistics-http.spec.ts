import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CustomerStatisticsUseCase } from '../src/application/customer/customer-statistics.use-case';
import { CustomerManagementUseCase, RegisterCustomerUseCase } from '../src/application/customer/customer.use-case';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { CustomerController } from '../src/presentation/customer/customer.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const identity = (permissions: string[], isSuperAdmin = false) => ({ id: 'u', username: 'test', fullName: 'Test',
  role: { id: 'r', code: 'TEST', name: 'Test', isSuperAdmin }, permissions, sessionId: 's' });
const result = {
  year: 2026,
  summary: { totalCustomers: 3, customersWithActiveDebt: 1, customersWithoutCurrentDebt: 1,
    customersWithUncollectibleDebt: 1, customersWithRefinancingHistory: 1,
    customersWithCancelledLoans: 1, customersWithAnnulledLoans: 1,
    customersWithMultipleLoans: 1, averageLoansPerCustomer: 1.33,
    newCustomersInYear: 3, newCustomersCurrentMonth: 1 },
  currentSituation: { activeDebt: 1, uncollectibleOnly: 1, noCurrentDebt: 1 },
  monthlyNewCustomers: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, newCustomers: index < 3 ? 1 : 0 })),
};

describe('customer statistics HTTP boundary', () => {
  const execute = jest.fn(async () => result);
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'summary') return identity(['customers.summary.view']);
    if (token === 'analysis') return identity(['customers.analysis.view']);
    if (token === 'super') return identity([], true);
    throw new SecurityUnauthorizedError();
  });
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [CustomerController], providers: [
      { provide: CustomerStatisticsUseCase, useValue: { execute } },
      { provide: RegisterCustomerUseCase, useValue: {} }, { provide: CustomerManagementUseCase, useValue: {} },
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
  const get = (query: string, token?: string) => fetch(`${base}/customers/statistics${query}`, {
    headers: { ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
  });

  it('requires customers.summary.view and preserves the central superadmin bypass', async () => {
    expect((await get('')).status).toBe(401);
    expect((await get('', 'analysis')).status).toBe(403);
    expect((await get('', 'summary')).status).toBe(200);
    expect((await get('', 'super')).status).toBe(200);
  });

  it('returns the aggregate contract and forwards year without list/search parameters', async () => {
    const response = await get('?year=2026', 'summary');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(execute).toHaveBeenLastCalledWith('2026');
  });

  it('uses the current year when omitted', async () => {
    expect((await get('', 'summary')).status).toBe(200);
    expect(execute).toHaveBeenLastCalledWith(undefined);
  });

  it('rejects malformed years, search and unexpected query fields before execution', async () => {
    execute.mockClear();
    for (const query of ['?year=26', '?year=2026.0', '?year=0000', '?search=ana', '?unexpected=1'])
      expect((await get(query, 'summary')).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
