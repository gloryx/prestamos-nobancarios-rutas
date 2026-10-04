import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CustomerFinancialAnalysisUseCase } from '../src/application/customer/customer-financial-analysis.use-case';
import { CustomerManagementUseCase, RegisterCustomerUseCase } from '../src/application/customer/customer.use-case';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { CustomerController } from '../src/presentation/customer/customer.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const identity = (permissions: string[], isSuperAdmin = false) => ({ id: id(1), username: 'test', fullName: 'Test',
  role: { id: id(2), code: 'TEST', name: 'Test', isSuperAdmin }, permissions, sessionId: id(3) });
const result = { customer: { id: id(4), identification: '123', fullName: 'Ana Perez' }, asOf: '2026-09-30',
  history: { firstEconomicDeploymentDate: '2026-09-01', calendarDays: 30, loanCount: 1, chainCount: 1, loansByStatus: { ACTIVE: 1 } },
  cashFlow: { realCashDisbursed: '100.00', paymentsReceived: '20.00' },
  economicCapital: { recovered: '15.00', pending: '85.00', capitalDays: '2850.00', averageWorkingCapital: '95.00' },
  capitalizedYield: { created: '0.00', recovered: '0.00', pending: '0.00' },
  realizedGain: { regularInterest: '5.00', recoveredCapitalizedYield: '0.00', total: '5.00' },
  contractualExposure: { outstandingPrincipal: '85.00', outstandingInterest: '15.00', total: '100.00' },
  profitability: { cumulativeReturnRate: '0.0500' },
  indicators: { historicalProfitability: '0.0526', equivalentThirtyDayRate: '0.0526', capitalRotation: '1.0526' },
  integrity: { status: 'COMPLETE' as const, warnings: [] } };

describe('customer financial analysis HTTP boundary', () => {
  const execute = jest.fn(async () => result);
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'viewer') return identity(['customers.analysis.view']);
    if (token === 'customer-viewer') return identity(['customers.view']);
    if (token === 'super') return identity([], true);
    throw new SecurityUnauthorizedError();
  });
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [CustomerController], providers: [
      { provide: CustomerFinancialAnalysisUseCase, useValue: { execute } },
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
  const get = (query: string, token?: string) => fetch(`${base}/customers/${id(4)}/financial-analysis${query}`, {
    headers: { ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
  });

  it('requires the dedicated permission and preserves the central superadmin bypass', async () => {
    expect((await get('')).status).toBe(401);
    expect((await get('', 'customer-viewer')).status).toBe(403);
    expect((await get('', 'viewer')).status).toBe(200);
    expect((await get('', 'super')).status).toBe(200);
  });

  it('returns the Spanish audit contract and forwards an explicit cutoff', async () => {
    const response = await get('?asOf=2026-09-30', 'viewer');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ fechaCorte: '2026-09-30',
      cliente: { id: id(4), identificacion: '123', nombreCompleto: 'Ana Perez' },
      gananciaRealizada: { interesRegular: '5.00', rendimientoCapitalizadoRecuperado: '0.00', total: '5.00' },
      exposicionContractual: { principalPendiente: '85.00', interesPendiente: '15.00', saldoTotal: '100.00' },
      profitability: { cumulativeReturnRate: '0.0500' },
      integridad: { estado: 'COMPLETO', advertencias: [] } }));
    expect(execute).toHaveBeenLastCalledWith(id(4), '2026-09-30');
  });

  it('rejects malformed and unexpected query fields before application execution', async () => {
    execute.mockClear();
    for (const query of ['?asOf=2026-9-30', '?unexpected=1']) expect((await get(query, 'viewer')).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects malformed customer identifiers before application execution', async () => {
    execute.mockClear();
    const response = await fetch(`${base}/customers/not-a-uuid/financial-analysis`, {
      headers: { cookie: `${SESSION_COOKIE}=viewer` },
    });
    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
