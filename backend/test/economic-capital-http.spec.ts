import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { EconomicCapitalUseCase } from '../src/application/cash-movement/economic-capital.use-case';
import { ListCashMovementsUseCase, RecordManualCashMovementUseCase, ReverseCashMovementUseCase, SummarizeCashMovementsUseCase } from '../src/application/cash-movement/cash-movement.use-cases';
import { SecurityService } from '../src/application/security/security.service';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { CashMovementController } from '../src/presentation/cash-movement/cash-movement.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const identity = (permissions: string[], isSuperAdmin = false) => ({ id: id(1), username: 'test', fullName: 'Test',
  role: { id: id(2), code: 'TEST', name: 'Test', isSuperAdmin }, permissions, sessionId: id(3) });
const result = { period: '2026-09', fromDate: '2026-09-01', toDate: '2026-09-30', calendarDays: 30,
  openingEconomicBalance: '100.00', realCapitalDisbursed: '200.00', recoveredCapital: '50.00',
  periodAdjustments: '0.00',
  averageWorkingCapital: '175.00', capitalRotation: '1.1429', closingEconomicBalance: '250.00',
  dataStatus: 'COMPLETE' as const, warnings: [], daily: [] };

describe('economic capital HTTP boundary', () => {
  const execute = jest.fn(async () => result);
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'viewer') return identity(['cash-movements.view']);
    if (token === 'regular') return identity([]);
    if (token === 'super') return identity([], true);
    throw new SecurityUnauthorizedError();
  });
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [CashMovementController], providers: [
      { provide: EconomicCapitalUseCase, useValue: { execute } },
      { provide: SecurityService, useValue: { authenticate } },
      { provide: APP_GUARD, useClass: AuthenticationGuard },
      { provide: APP_GUARD, useClass: PermissionGuard },
      { provide: ListCashMovementsUseCase, useValue: {} },
      { provide: SummarizeCashMovementsUseCase, useValue: {} },
      { provide: RecordManualCashMovementUseCase, useValue: {} },
      { provide: ReverseCashMovementUseCase, useValue: {} },
    ] }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    close = () => app.close();
  });
  afterAll(async () => close?.());
  beforeEach(() => execute.mockReset().mockResolvedValue(result));

  const get = (query: string, token?: string) => fetch(`${base}/cash-movements/capital-rotation${query}`, {
    headers: { ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
  });

  it('requires authentication and cash-movements.view while preserving superadmin bypass', async () => {
    expect((await get('?period=2026-09')).status).toBe(401);
    expect((await get('?period=2026-09', 'regular')).status).toBe(403);
    expect((await get('?period=2026-09', 'viewer')).status).toBe(200);
    expect((await get('?period=2026-09', 'super')).status).toBe(200);
  });

  it('returns the requested audit contract and rejects malformed or extra query fields before execution', async () => {
    const response = await get('?period=2026-09', 'viewer');
    expect(await response.json()).toMatchObject({ periodo: '2026-09', cantidadDias: 30,
      capitalRealDesembolsadoPeriodo: '200.00', capitalRecuperadoPeriodo: '50.00', rotacionCapital: '1.1429' });
    execute.mockClear();
    for (const query of ['?period=2026-9', '?period=2026-13', '?period=2026-09&unexpected=1', ''])
      expect((await get(query, 'viewer')).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
