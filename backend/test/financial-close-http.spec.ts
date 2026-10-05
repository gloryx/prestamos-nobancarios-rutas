import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FinancialCloseUseCases } from '../src/application/financial-close/financial-close.use-cases';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { FinancialCloseController } from '../src/presentation/financial-close/financial-close.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const identity = (permissions: string[], superadmin = false) => ({ id: 'actor', username: 'test', fullName: 'Test', role: { id: 'role', code: 'TEST', name: 'Test', isSuperAdmin: superadmin }, permissions, sessionId: 'session' });
describe('financial close HTTP boundary', () => {
  let base: string; let close: () => Promise<void>;
  const preview = jest.fn(async (period) => ({ period, modelVersion: 2, sections: [] }));
  const confirm = jest.fn(async (period) => ({ id: 'close', period, modelVersion: 2, sections: [] }));
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'viewer') return identity(['financial-closes.view']);
    if (token === 'confirmer') return identity(['financial-closes.confirm']);
    if (token === 'super') return identity([], true);
    if (token === 'regular') return identity([]);
    throw new SecurityUnauthorizedError();
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [FinancialCloseController], providers: [
      { provide: FinancialCloseUseCases, useValue: { preview, confirm, list: jest.fn(), detail: jest.fn() } },
      { provide: SecurityService, useValue: { authenticate } }, { provide: APP_GUARD, useClass: AuthenticationGuard },
      { provide: APP_GUARD, useClass: PermissionGuard },
    ] }).compile();
    const app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`; close = () => app.close();
  });
  afterAll(async () => close());
  const request = (path: string, token?: string, init: RequestInit = {}) => fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(token && { cookie: `${SESSION_COOKIE}=${token}` }), ...init.headers } });
  it('uses independent centralized view/confirm permissions and superadmin bypass', async () => {
    expect((await request('/financial-closes/preview?period=2026-01')).status).toBe(401);
    expect((await request('/financial-closes/preview?period=2026-01', 'regular')).status).toBe(403);
    expect((await request('/financial-closes/preview?period=2026-01', 'viewer')).status).toBe(200);
    expect((await request('/financial-closes', 'viewer', { method: 'POST', body: JSON.stringify({ period: '2026-01' }) })).status).toBe(403);
    expect((await request('/financial-closes', 'confirmer', { method: 'POST', body: JSON.stringify({ period: '2026-01' }) })).status).toBe(201);
    expect((await request('/financial-closes', 'super', { method: 'POST', body: JSON.stringify({ period: '2026-01' }) })).status).toBe(201);
  });
  it('validates period input at the transport boundary', async () => {
    expect((await request('/financial-closes/preview?period=2026-1', 'viewer')).status).toBe(400);
    expect((await request('/financial-closes', 'confirmer', { method: 'POST', body: JSON.stringify({ period: '2026-01', extra: true }) })).status).toBe(400);
  });
});
