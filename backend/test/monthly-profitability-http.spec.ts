import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ListCashMovementsUseCase, RecordManualCashMovementUseCase, ReverseCashMovementUseCase,
  SummarizeCashMovementsUseCase } from '../src/application/cash-movement/cash-movement.use-cases';
import { MonthlyProfitabilityUseCase } from '../src/application/cash-movement/monthly-profitability.use-case';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { CashMovementController } from '../src/presentation/cash-movement/cash-movement.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const identity = (permissions: string[], isSuperAdmin = false) => ({ id: id(1), username: 'test', fullName: 'Test',
  role: { id: id(2), code: 'TEST', name: 'Test', isSuperAdmin }, permissions, sessionId: id(3) });
const summaryResult = { period: '2026-09', fromDate: '2026-09-01', toDate: '2026-09-30', calendarDays: 30,
  gain: { total: '40.00', normal: '10.00', refinancings: '30.00', refinancingRegularInterest: '20.00', recoveredCapitalizedYield: '10.00' },
  capital: { openingEconomicBalance: '100.00', realDisbursedInPeriod: '52.00', economicRecoveredInPeriod: '80.00',
    closingEconomicBalance: '72.00', capitalDays: '3000.00', averageWorkingCapital: '100.00' },
  indicators: { periodProfitability: '0.4000', equivalentThirtyDayRate: '0.4000', capitalRotation: '0.5200' },
  integrity: { status: 'COMPLETE' as const, warnings: [] } };

describe('monthly profitability HTTP boundary', () => {
  const summary = jest.fn(async () => summaryResult);
  const normal = jest.fn(async () => ({ items: [{ loanId: 'N1' }], total: 1, page: 1, pageSize: 20, totalPages: 1,
    summary: { realizedInterest: '10.00' } }));
  const refinancings = jest.fn(async () => ({ items: [{ rootLoanId: 'A' }], total: 1, page: 1, pageSize: 20, totalPages: 1,
    summary: { regularInterestRealized: '20.00', capitalizedYieldRecovered: '10.00', economicGain: '30.00' } }));
  const payments = jest.fn(async () => ({ items: [{ paymentId: 'P1' }], total: 1, page: 1, pageSize: 20, totalPages: 1 }));
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
      { provide: MonthlyProfitabilityUseCase, useValue: { summary, normal, refinancings, payments } },
      { provide: SecurityService, useValue: { authenticate } },
      { provide: APP_GUARD, useClass: AuthenticationGuard }, { provide: APP_GUARD, useClass: PermissionGuard },
      { provide: ListCashMovementsUseCase, useValue: {} }, { provide: SummarizeCashMovementsUseCase, useValue: {} },
      { provide: RecordManualCashMovementUseCase, useValue: {} }, { provide: ReverseCashMovementUseCase, useValue: {} },
    ] }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    close = () => app.close();
  });
  afterAll(async () => close?.());

  const get = (path: string, token?: string) => fetch(`${base}/cash-movements/profitability${path}`, {
    headers: { ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
  });

  it('protects the summary and zoom resources with the existing permission and superadmin bypass', async () => {
    for (const path of ['?period=2026-09', '/normal?period=2026-09', '/refinancings?period=2026-09', '/payments?period=2026-09']) {
      expect((await get(path)).status).toBe(401);
      expect((await get(path, 'regular')).status).toBe(403);
      expect((await get(path, 'viewer')).status).toBe(200);
      expect((await get(path, 'super')).status).toBe(200);
    }
  });

  it('returns the monthly summary without embedding zoom collections', async () => {
    const response = await get('?period=2026-09', 'viewer');
    expect(await response.json()).toEqual({ periodo: '2026-09', fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', cantidadDias: 30,
      ganancia: { total: '40.00', normal: '10.00', refinanciamientos: '30.00', interesRegularRefinanciamientos: '20.00',
        rendimientoCapitalizadoRecuperado: '10.00' },
      capital: { saldoEconomicoInicial: '100.00', desembolsadoRealPeriodo: '52.00', recuperadoEconomicoPeriodo: '80.00',
        saldoEconomicoFinal: '72.00', capitalDays: '3000.00', capitalPromedioTrabajando: '100.00' },
      indicadores: { rentabilidadPeriodo: '0.4000', tasaEquivalente30Dias: '0.4000', rotacionCapital: '0.5200' },
      integridad: { estado: 'COMPLETO', advertencias: [] } });
  });

  it('validates period, pagination, source and unexpected fields before zoom execution', async () => {
    payments.mockClear();
    expect((await get('/payments?period=2026-09&page=2&pageSize=10&source=REFINANCING', 'viewer')).status).toBe(200);
    expect(payments).toHaveBeenLastCalledWith('2026-09', { page: 2, pageSize: 10 },
      { source: 'REFINANCING', loanId: undefined, rootLoanId: undefined });
    for (const query of ['?period=2026-9', '?period=2026-09&page=0', '?period=2026-09&pageSize=100',
      '?period=2026-09&source=OTHER', '?period=2026-09&unexpected=1']) {
      expect((await get(`/payments${query}`, 'viewer')).status).toBe(400);
    }
    expect((await get('/normal?period=2026-09&source=REFINANCING', 'viewer')).status).toBe(400);
  });

  it('validates and forwards normal and terminal statuses independently', async () => {
    normal.mockClear(); refinancings.mockClear();
    const normalResponse = await get('/normal?period=2026-09&page=2&pageSize=10&status=CANCELLED', 'viewer');
    expect(normalResponse.status).toBe(200);
    expect(await normalResponse.json()).toMatchObject({ summary: { realizedInterest: '10.00' } });
    expect(normal).toHaveBeenLastCalledWith('2026-09', { page: 2, pageSize: 10 }, { status: 'CANCELLED' });
    const refinancingResponse = await get('/refinancings?period=2026-09&terminalStatus=ACTIVE', 'viewer');
    expect(refinancingResponse.status).toBe(200);
    expect(await refinancingResponse.json()).toMatchObject({ summary: { regularInterestRealized: '20.00',
      capitalizedYieldRecovered: '10.00', economicGain: '30.00' } });
    expect(refinancings).toHaveBeenLastCalledWith('2026-09', { page: 1, pageSize: 20 }, { terminalStatus: 'ACTIVE' });
    for (const path of ['/normal?period=2026-09&status=OTHER',
      '/refinancings?period=2026-09&terminalStatus=OTHER',
      '/normal?period=2026-09&terminalStatus=ACTIVE', '/refinancings?period=2026-09&status=ACTIVE'])
      expect((await get(path, 'viewer')).status).toBe(400);
  });
});
