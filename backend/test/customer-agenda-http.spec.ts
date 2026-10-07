import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CustomerAgendaUseCase } from '../src/application/customer/customer-agenda.use-case';
import { CustomerManagementUseCase, RegisterCustomerUseCase } from '../src/application/customer/customer.use-case';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { CustomerController } from '../src/presentation/customer/customer.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const result = { summary: { total: 0, assigned: 0, unassigned: 0, withoutRoute: 0, routeWithoutCollector: 0, invalidRoute: 0, invalidCollector: 0 },
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }, options: { collectors: [], routes: [], provinces: [], cantons: [], districts: [] }, items: [] };
const identity = (code: string, permissions: string[], isSuperAdmin = false) => ({ id: `${code.toLowerCase()}-user`, username: code.toLowerCase(), fullName: code,
  role: { id: `${code.toLowerCase()}-role`, code, name: code, isSuperAdmin }, permissions, sessionId: 's' });

describe('customer agenda HTTP boundary', () => {
  const execute = jest.fn(async () => result);
  const detail = jest.fn(async () => ({ id: 'detail' }));
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'manager') return identity('GESTOR', ['customers.view']);
    if (token === 'collector') return identity('COLLECTOR', ['customers.assigned.view']);
    if (token === 'super') return identity('ADMIN', [], true);
    throw new SecurityUnauthorizedError();
  });
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [CustomerController], providers: [
      { provide: CustomerAgendaUseCase, useValue: { execute } },
      { provide: RegisterCustomerUseCase, useValue: {} }, { provide: CustomerManagementUseCase, useValue: { detail } },
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
  beforeEach(() => { execute.mockClear(); detail.mockClear(); });
  const get = (query = '', token?: string) => fetch(`${base}/customers/agenda${query}`, {
    headers: { ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
  });

  it('accepts the existing global or scoped customer permission and preserves superadmin bypass', async () => {
    expect((await get()).status).toBe(401);
    expect((await get('', 'collector')).status).toBe(200);
    expect((await get('', 'manager')).status).toBe(200);
    expect((await get('', 'super')).status).toBe(200);
    expect(execute).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ id: 'admin-user', role: expect.objectContaining({ isSuperAdmin: true }) }));
  });

  it('declares /customers/agenda before /customers/:id and never dispatches it as a UUID detail', async () => {
    expect((await get('', 'manager')).status).toBe(200);
    expect(execute).toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });

  it('transforms and forwards the complete validated query contract', async () => {
    const collectorId = '11111111-1111-4111-8111-111111111111';
    const routeId = '22222222-2222-4222-8222-222222222222';
    const response = await get(`?search=Ana&collectorId=${collectorId}&routeId=${routeId}&provinceCode=1&cantonCode=101&districtCode=10101&assignmentStatus=UNASSIGNED&page=2&pageSize=50`, 'manager');
    expect(response.status).toBe(200);
    expect(execute).toHaveBeenLastCalledWith({ search: 'Ana', collectorId, routeId, provinceCode: 1,
      cantonCode: 101, districtCode: 10101, assignmentStatus: 'UNASSIGNED', page: 2, pageSize: 50 },
    expect.objectContaining({ id: 'gestor-user', role: expect.objectContaining({ code: 'GESTOR' }) }));
  });

  it('forwards manipulated collector filters with the authenticated COLLECTOR identity for backend scoping', async () => {
    const collectorId = '11111111-1111-4111-8111-111111111111';
    const routeId = '22222222-2222-4222-8222-222222222222';
    const response = await get(`?collectorId=${collectorId}&routeId=${routeId}&search=Outside&assignmentStatus=UNASSIGNED&page=9`, 'collector');
    expect(response.status).toBe(200);
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ collectorId, routeId, search: 'Outside',
      assignmentStatus: 'UNASSIGNED', page: 9 }), expect.objectContaining({ id: 'collector-user', role: expect.objectContaining({ code: 'COLLECTOR' }) }));
  });

  it('rejects malformed UUIDs, territory, status, page sizes and unknown fields before execution', async () => {
    for (const query of ['?collectorId=no', '?routeId=no', '?provinceCode=0', '?cantonCode=1.5',
      '?districtCode=x', '?assignmentStatus=INVALID_ROUTE', '?page=0', '?pageSize=25', '?customerId=11111111-1111-4111-8111-111111111111', '?unexpected=1']) {
      execute.mockClear();
      expect((await get(query, 'manager')).status).toBe(400);
      expect(execute).not.toHaveBeenCalled();
    }
  });
});
