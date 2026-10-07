import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CollectorFinancialSummaryForbiddenError, CollectorFinancialSummaryUseCase } from '../src/application/collector/collector-financial-summary.use-case';
import { CollectorStatisticsUseCase } from '../src/application/collector/collector-statistics.use-case';
import { CollectorUseCases } from '../src/application/collector/collector.use-cases';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { CollectorController } from '../src/presentation/collector/collector.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const summary = { totalPlaced: '0.00', totalOutstanding: '0.00', realizedGain: '0.00', activeLoansCount: 0 };
const identity = (id: string, permissions: string[], isSuperAdmin = false) => ({ id, username: id, fullName: id, sessionId: `${id}-session`,
  role: { id: 'role', code: 'COLLECTOR', name: 'Collector', isSuperAdmin }, permissions });

describe('collector financial summary HTTP boundary', () => {
  const execute = jest.fn(async (actor: ReturnType<typeof identity>) => {
    if (actor.id === 'invalid') throw new CollectorFinancialSummaryForbiddenError('Inactive collector');
    return summary;
  });
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'valid') return identity('valid', ['collectors.financial-summary.view']);
    if (token === 'invalid') return identity('invalid', ['collectors.financial-summary.view']);
    if (token === 'wrong-permission') return identity('valid', ['loans.assigned.view']);
    throw new SecurityUnauthorizedError();
  });
  let base: string; let close: () => Promise<void>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [CollectorController], providers: [
      { provide: CollectorUseCases, useValue: {} }, { provide: CollectorStatisticsUseCase, useValue: {} },
      { provide: CollectorFinancialSummaryUseCase, useValue: { execute } }, { provide: SecurityService, useValue: { authenticate } },
      { provide: APP_GUARD, useClass: AuthenticationGuard }, { provide: APP_GUARD, useClass: PermissionGuard },
    ] }).compile();
    const app = module.createNestApplication(); await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`; close = () => app.close();
  });
  afterAll(async () => close?.());
  beforeEach(() => execute.mockClear());
  const get = (path: string, token?: string) => fetch(`${base}${path}`, { headers: { ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) } });

  it('requires authentication and only the dedicated permission', async () => {
    expect((await get('/collectors/me/financial-summary')).status).toBe(401);
    expect((await get('/collectors/me/financial-summary', 'wrong-permission')).status).toBe(403);
    expect((await get('/collectors/me/financial-summary', 'valid')).status).toBe(200);
  });

  it('maps an invalid collector to 403 and derives identity only from authentication', async () => {
    expect((await get('/collectors/me/financial-summary', 'invalid')).status).toBe(403);
    const response = await get('/collectors/me/financial-summary?collectorId=someone-else', 'valid');
    expect(response.status).toBe(200);
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'valid' }));
  });
});
