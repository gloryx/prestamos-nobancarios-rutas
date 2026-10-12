import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { LoanRefinancingUseCase } from '../src/application/loan-refinancing/refinancing.use-case';
import {
  LoanRefinancingAnnulmentUseCase,
  RefinancingAnnulmentConflictError,
  RefinancingAnnulmentNotFoundError,
} from '../src/application/loan-refinancing/refinancing-annulment.use-case';
import { SecurityService } from '../src/application/security/security.service';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { LoanRefinancingController } from '../src/presentation/loan-refinancing/loan-refinancing.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { PERMISSIONS, SESSION_COOKIE } from '../src/shared/constants/security';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const actorId = uuid(1), refinancingId = uuid(2), annulmentId = uuid(3);
const identity = (permissions: string[], isSuperAdmin = false) => ({ id: actorId, username: 'test', fullName: 'Test',
  role: { id: uuid(9), code: 'TEST', name: 'Test', isSuperAdmin }, permissions, sessionId: uuid(8) });

describe('refinancing annulment HTTP API and RBAC', () => {
  const annulled = jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }));
  const annullable = jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }));
  const detail = jest.fn(async () => ({ annulmentId, refinancingId }));
  const paymentMethods = jest.fn(async () => [{ id: uuid(4), name: 'Cash' }]);
  const annul = jest.fn(async () => ({ annulmentId, refinancingId }));
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'viewer') return identity(['loans.refinance.view']);
    if (token === 'annuller') return identity(['loans.refinance.annul']);
    if (token === 'super') return identity([], true);
    throw new SecurityUnauthorizedError();
  });
  let base: string; let close: () => Promise<void>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [LoanRefinancingController], providers: [
      { provide: LoanRefinancingUseCase, useValue: {} },
      { provide: LoanRefinancingAnnulmentUseCase, useValue: { annulled, annullable, detail, annul, paymentMethods } },
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
  beforeEach(() => { annulled.mockClear(); annullable.mockClear(); detail.mockClear(); annul.mockClear(); });
  const get = (path: string, token?: string) => fetch(`${base}/loan-refinancings/${path}`, {
    headers: { ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
  });
  const post = (body: unknown, token?: string) => fetch(`${base}/loan-refinancings/${refinancingId}/annul`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
    body: JSON.stringify(body),
  });

  it('publishes all query endpoints under view permission and preserves superadmin bypass', async () => {
    expect(PERMISSIONS.filter(([code]) => code === 'loans.refinance.annul')).toHaveLength(1);
    for (const path of ['annulled', 'annullable', 'annulment-payment-methods', `annulments/${annulmentId}`]) {
      expect((await get(path)).status).toBe(401);
      expect((await get(path, 'annuller')).status).toBe(403);
      expect((await get(path, 'viewer')).status).toBe(200);
      expect((await get(path, 'super')).status).toBe(200);
    }
    expect((await get('annullable?page=2&pageSize=10&search=Ana&dateFrom=2026-09-01&effectiveDate=2026-10-08&sortBy=customer&sortDir=asc', 'viewer')).status).toBe(200);
    expect(annullable).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 10, search: 'Ana',
      dateFrom: '2026-09-01', effectiveDate: '2026-10-08', sortBy: 'customer', sortDir: 'asc' }));
    expect((await get('annullable?sortBy=createdBy', 'viewer')).status).toBe(400);
    expect(detail).toHaveBeenCalledWith(annulmentId);
  });

  it('requires the dedicated command permission and validates type-specific request fields', async () => {
    const correction = { annulmentType: 'DATA_CORRECTION', disbursementResolution: 'NOT_DELIVERED',
      reason: 'Incorrect refinancing', idempotencyKey: 'annul-key' };
    expect((await post(correction)).status).toBe(401);
    expect((await post(correction, 'viewer')).status).toBe(403);
    expect((await post(correction, 'annuller')).status).toBe(201);
    expect((await post({ annulmentType: 'CASH_REFUND', effectiveDate: '2026-10-08', reason: 'Customer refund',
      disbursementResolution: 'RETURNED_IN_FULL', refundPaymentMethodId: uuid(4), idempotencyKey: 'refund-key' }, 'super')).status).toBe(201);
    expect(annul).toHaveBeenCalledWith(refinancingId, correction, actorId);
    for (const body of [{ ...correction, extra: true }, { ...correction, annulmentType: 'OTHER' },
      { ...correction, reason: 'short' }, { ...correction, idempotencyKey: 'bad\nkey' },
      { ...correction, effectiveDate: '2026-10-08' }, { ...correction, refundPaymentMethodId: uuid(4) },
      { ...correction, disbursementResolution: 'RETURNED_IN_FULL' },
      { annulmentType: 'CASH_REFUND', disbursementResolution: 'NOT_DELIVERED', effectiveDate: '2026-10-08',
        reason: 'Customer refund', idempotencyKey: 'refund-key' },
      { annulmentType: 'CASH_REFUND', reason: 'Customer refund', idempotencyKey: 'refund-key' }]) {
      expect((await post(body, 'annuller')).status).toBe(400);
    }
  });

  it('maps typed command and detail failures without leaking unexpected errors', async () => {
    detail.mockRejectedValueOnce(new RefinancingAnnulmentNotFoundError('Missing annulment'));
    expect((await get(`annulments/${annulmentId}`, 'viewer')).status).toBe(404);
    annul.mockRejectedValueOnce(new RefinancingAnnulmentConflictError('Blocked', 'VALID_SUCCESSOR_PAYMENT'));
    const blocked = await post({ annulmentType: 'DATA_CORRECTION', reason: 'Incorrect refinancing',
      disbursementResolution: 'NOT_DELIVERED', idempotencyKey: 'annul-key' }, 'annuller');
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ reasonCode: 'VALID_SUCCESSOR_PAYMENT' });
  });
});
