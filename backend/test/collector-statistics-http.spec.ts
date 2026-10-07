import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CollectorStatisticsUseCase } from '../src/application/collector/collector-statistics.use-case';
import { CollectorUseCases } from '../src/application/collector/collector.use-cases';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { CollectorController } from '../src/presentation/collector/collector.controller';
import { CollectorFinancialSummaryUseCase } from '../src/application/collector/collector-financial-summary.use-case';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const identity = (permissions: string[], isSuperAdmin = false) => ({ id: 'u', username: 'test', fullName: 'Test',
  role: { id: 'r', code: 'TEST', name: 'Test', isSuperAdmin }, permissions, sessionId: 's' });
const result = { period: { year: 2026, month: null }, summary: {}, byCollector: [], paymentMethods: [], evolution: [] };

describe('collector statistics HTTP boundary', () => {
  const execute = jest.fn(async () => result);
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'payments') return identity(['payments.view']);
    if (token === 'collectors') return identity(['collectors.view']);
    if (token === 'super') return identity([], true);
    throw new SecurityUnauthorizedError();
  });
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [CollectorController], providers: [
      { provide: CollectorStatisticsUseCase, useValue: { execute } },
      { provide: CollectorUseCases, useValue: {} },
      { provide: CollectorFinancialSummaryUseCase, useValue: {} },
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
  const get = (query: string, token?: string) => fetch(`${base}/collectors/statistics${query}`, {
    headers: { ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
  });

  it('reuses payments.view and preserves the central superadmin bypass', async () => {
    expect((await get('')).status).toBe(401);
    expect((await get('', 'collectors')).status).toBe(403);
    expect((await get('', 'payments')).status).toBe(200);
    expect((await get('', 'super')).status).toBe(200);
  });

  it('forwards strict optional year and month filters', async () => {
    const response = await get('?year=2026&month=2', 'payments');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(execute).toHaveBeenLastCalledWith('2026', '2');
  });

  it('rejects malformed periods and unrelated query fields before execution', async () => {
    execute.mockClear();
    for (const query of ['?year=26', '?year=2026.0', '?month=0', '?month=01', '?month=13', '?search=ana'])
      expect((await get(query, 'payments')).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
