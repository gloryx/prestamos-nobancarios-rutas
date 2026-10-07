import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CustomerManagementUseCase, RegisterCustomerUseCase } from '../src/application/customer/customer.use-case';
import { CustomerSiteUseCases } from '../src/application/customer-site/customer-site.use-cases';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { CustomerSiteController } from '../src/presentation/customer-site/customer-site.controller';
import { CustomerController } from '../src/presentation/customer/customer.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const customerId = '6616f9e6-b796-48b4-99b4-68af1d973797';
const identity = (code: string, permissions: string[]) => ({ id: `${code.toLowerCase()}-user`, username: code.toLowerCase(), fullName: code,
  role: { id: `${code.toLowerCase()}-role`, code, name: code, isSuperAdmin: false }, permissions, sessionId: `${code.toLowerCase()}-session` });

describe('customer HTTP route precedence', () => {
  const assignedResult = { items: [{ id: customerId, fullName: 'Ana Mora' }], total: 1, page: 1, pageSize: 20, totalPages: 1, routes: [] };
  const assignedCustomers = jest.fn(async () => assignedResult);
  const list = jest.fn(async () => ({ items: [], total: 0 }));
  const detail = jest.fn(async (id: string) => ({ customer: { id } }));
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'collector') return identity('COLLECTOR', ['customers.assigned.view']);
    if (token === 'admin') return identity('ADMIN', ['customers.view']);
    if (token === 'office') return identity('OFFICE', ['customers.view']);
    throw new SecurityUnauthorizedError();
  });
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CustomerSiteController, CustomerController],
      providers: [
        { provide: CustomerSiteUseCases, useValue: { assignedCustomers } },
        { provide: RegisterCustomerUseCase, useValue: {} },
        { provide: CustomerManagementUseCase, useValue: { detail, list } },
        { provide: SecurityService, useValue: { authenticate } },
        { provide: APP_GUARD, useClass: AuthenticationGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    close = () => app.close();
  });

  afterAll(async () => close?.());
  beforeEach(() => { assignedCustomers.mockClear(); detail.mockClear(); list.mockClear(); });
  const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });

  it('routes GET /customers/assigned to the scoped assigned-customer endpoint, never to detail', async () => {
    const response = await get('/customers/assigned', 'collector');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(assignedResult);
    expect(assignedCustomers).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }), expect.objectContaining({ id: 'collector-user' }));
    expect(detail).not.toHaveBeenCalled();
  });

  it.each(['admin', 'office'])('routes a valid customer UUID to detail for %s without changing authorization', async (token) => {
    const response = await get(`/customers/${customerId}`, token);
    expect(response.status).toBe(200);
    expect(detail).toHaveBeenCalledWith(customerId);
    expect(assignedCustomers).not.toHaveBeenCalled();
  });

  it('does not let a collector scoped permission unlock global customer routes', async () => {
    expect((await get('/customers', 'collector')).status).toBe(403);
    expect((await get(`/customers/${customerId}`, 'collector')).status).toBe(403);
    expect(list).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID customer id with 400 before querying customer persistence', async () => {
    const response = await get('/customers/valor-no-uuid', 'admin');
    expect(response.status).toBe(400);
    expect(detail).not.toHaveBeenCalled();
    expect(assignedCustomers).not.toHaveBeenCalled();
  });
});
