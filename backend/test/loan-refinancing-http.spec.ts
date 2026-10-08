import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { LoanRefinancingUseCase, RefinancingConflictError, RefinancingNotFoundError } from '../src/application/loan-refinancing/refinancing.use-case';
import type { RefinancingOperation } from '../src/application/loan-refinancing/refinancing.port';
import { SecurityService } from '../src/application/security/security.service';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { LoanRefinancingController } from '../src/presentation/loan-refinancing/loan-refinancing.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { PERMISSIONS, SESSION_COOKIE } from '../src/shared/constants/security';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const actor = uuid(2), origin = uuid(1);
const operation = (): RefinancingOperation => ({ id: uuid(6), originLoanId: origin, originLoanNumber: '100',
  newLoanId: uuid(7), newLoanNumber: '150', originStatus: 'REFINANCED', newStatus: 'ACTIVE',
  originStartDate: '2026-09-01', newStartDate: '2026-09-30', customerId: uuid(5), customerName: 'Customer One',
  customerIdentification: '123', refinancingDate: '2026-09-30', createdAt: new Date('2026-09-30T12:00:00Z'),
  createdByUserId: actor, createdByName: 'Operator', observations: 'TERMS AGREED',
  paymentFrequencyId: uuid(8), paymentFrequencyName: 'Monthly', intervalUnit: 'MONTH', intervalValue: 1,
  preferredPaymentMethodId: uuid(9), preferredPaymentMethodName: 'Cash',
  disbursementPaymentMethodName: null, disbursementId: null, cashMovementId: null,
  disbursementAmount: null, disbursementDate: null, disbursementMethodId: null,
  cashAmount: null, cashDate: null, cashMethodId: null, cashDirection: null, cashConcept: null,
  outstandingPrincipalTransferred: '120000.00', capitalizedOutstandingInterest: '30000.00',
  newMoneyDisbursed: '0.00', newContractualPrincipal: '150000.00', newInterestAmount: '40000.00',
  newContractualTotal: '190000.00' });
const identity = (permissions: string[], isSuperAdmin = false) => ({ id: actor, username: 'test', fullName: 'Test',
  role: { id: uuid(3), code: 'TEST', name: 'Test', isSuperAdmin }, permissions, sessionId: uuid(4) });

describe('refinancing HTTP boundary and RBAC', () => {
  const list = jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }));
  const preview = jest.fn(async () => ({ eligible: true, loanId: origin }));
  const search = jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 }));
  const confirm = jest.fn(async () => operation());
  const detail = jest.fn(async () => operation());
  const chain = jest.fn(async () => ({ rootLoanId: origin, terminalLoanId: uuid(7),
    customer: { id: uuid(5), fullName: 'Customer One', identification: '123' },
    loans: [{ loanId: origin }, { loanId: uuid(7) }], transitions: [{ refinancingId: uuid(6) }],
    summary: { loanCount: 2, refinancingCount: 1 } }));
  const chainsForCustomer = jest.fn(async () => ({ customer: { id: uuid(5), fullName: 'Customer One', identification: '123' },
    chains: [] }));
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'viewer') return identity(['loans.refinance.view']);
    if (token === 'operator') return identity(['loans.refinance.create']);
    if (token === 'regular') return identity(['loans.view', 'loans.create']);
    if (token === 'super') return identity([], true);
    throw new SecurityUnauthorizedError();
  });
  let base: string; let close: () => Promise<void>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [LoanRefinancingController], providers: [
      { provide: LoanRefinancingUseCase, useValue: { list, search, preview, confirm, detail, chain, chainsForCustomer } },
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
  beforeEach(() => { list.mockClear(); search.mockClear(); preview.mockClear(); confirm.mockClear(); detail.mockClear(); chain.mockClear(); chainsForCustomer.mockClear(); });

  const get = (path: string, token?: string) => fetch(`${base}/loan-refinancings/${path}`, {
    headers: { ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
  });
  const body = () => ({ originLoanId: origin, refinancingDate: '2026-09-30', newMoney: '0.00',
    newInterestAmount: '40000.00', paymentFrequencyId: uuid(8), preferredPaymentMethodId: uuid(9),
    plan: [{ sequence: 1, dueDate: '2026-10-30', pendingAmount: '190000.00' }],
    baseline: 'a'.repeat(64), idempotencyKey: 'refinancing-key' });
  const post = (value: unknown, token?: string) => fetch(`${base}/loan-refinancings`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) }, body: JSON.stringify(value) });

  it('publishes a paginated operation list under view permission without changing candidate/detail routes', async () => {
    expect((await get('', undefined)).status).toBe(401);
    expect((await get('', 'operator')).status).toBe(403);
    expect((await get('', 'regular')).status).toBe(403);
    const empty = await get('', 'viewer');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    expect(list).toHaveBeenCalledWith({ search: undefined, customerId: undefined, dateFrom: undefined,
      dateTo: undefined, page: 1, pageSize: 20 });
    const filtered = await get(`?page=2&pageSize=10&search=Ana&customerId=${uuid(5)}&dateFrom=2026-10-01&dateTo=2026-10-02`, 'viewer');
    expect(filtered.status).toBe(200);
    expect(list).toHaveBeenLastCalledWith({ search: 'Ana', customerId: uuid(5), dateFrom: '2026-10-01',
      dateTo: '2026-10-02', page: 2, pageSize: 10 });
    expect((await get('', 'super')).status).toBe(200);
    expect((await get('loans', 'viewer')).status).toBe(200);
    expect((await get(uuid(6), 'viewer')).status).toBe(200);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('rejects malformed list query fields at the HTTP boundary without invoking the use case', async () => {
    for (const path of ['?page=0', '?pageSize=100', `?search=${'x'.repeat(121)}`,
      '?customerId=not-a-uuid', '?dateFrom=2026/10/01', '?dateTo=02-10-2026', '?unexpected=1']) {
      expect((await get(path, 'viewer')).status).toBe(400);
    }
    expect(list).not.toHaveBeenCalled();
  });

  it('shares loans.refinance.view across the existing loan chain and new customer chains route', async () => {
    for (const path of [`loans/${origin}/chain`, `customers/${uuid(5)}/chains`]) {
      expect((await get(path)).status).toBe(401);
      expect((await get(path, 'operator')).status).toBe(403);
      expect((await get(path, 'regular')).status).toBe(403);
      expect((await get(path, 'viewer')).status).toBe(200);
      expect((await get(path, 'super')).status).toBe(200);
    }
    expect(chain).toHaveBeenCalledWith(origin);
    expect(chainsForCustomer).toHaveBeenCalledWith(uuid(5));
    expect((await get('customers/not-a-uuid/chains', 'viewer')).status).toBe(400);
    expect((await get('loans/not-a-uuid/chain', 'viewer')).status).toBe(400);
    const empty = await get(`customers/${uuid(5)}/chains`, 'viewer');
    expect(await empty.json()).toMatchObject({ customer: { id: uuid(5) }, chains: [] });
    expect((await get('loans', 'viewer')).status).toBe(200);
  });

  it('maps missing chains and structural integrity errors without leaking unexpected details', async () => {
    chain.mockRejectedValueOnce(new RefinancingNotFoundError('The loan has no refinancing chain.'));
    expect((await get(`loans/${origin}/chain`, 'viewer')).status).toBe(404);
    chainsForCustomer.mockRejectedValueOnce(new RefinancingConflictError('The graph is inconsistent.', 'CHAIN_INTEGRITY_ERROR'));
    const conflicted = await get(`customers/${uuid(5)}/chains`, 'viewer');
    expect(conflicted.status).toBe(409);
    expect(await conflicted.json()).toMatchObject({ reasonCode: 'CHAIN_INTEGRITY_ERROR' });
  });

  it('registers two distinct technical permissions without granting them to default roles', async () => {
    expect(PERMISSIONS.filter(([code]) => code.startsWith('loans.refinance.'))).toHaveLength(2);
    expect((await get(`loans/${origin}/preview`)).status).toBe(401);
    expect((await get('loans', 'regular')).status).toBe(403);
    expect((await get(`loans/${origin}/preview`, 'regular')).status).toBe(403);
    expect((await post(body(), 'regular')).status).toBe(403);
    expect((await post(body(), 'viewer')).status).toBe(403);
    expect((await get(`loans/${origin}/preview`, 'viewer')).status).toBe(200);
    expect((await get(`loans/${origin}/preview?refinancingDate=2026-09-26`, 'viewer')).status).toBe(200);
    expect(preview).toHaveBeenLastCalledWith(origin, '2026-09-26');
    expect((await get(`loans/${origin}/preview?refinancingDate=invalid`, 'viewer')).status).toBe(400);
    expect((await get('loans?page=1&pageSize=20&search=Customer', 'viewer')).status).toBe(200);
    expect(search).toHaveBeenCalledWith({ search: 'Customer', page: 1, pageSize: 20 });
    expect((await get(`loans/${origin}/chain`, 'viewer')).status).toBe(200);
    const saved = await get(uuid(6), 'viewer');
    expect(saved.status).toBe(200);
    const detailBody = await saved.json();
    const created = await post(body(), 'operator');
    expect(created.status).toBe(201);
    const result = await created.json();
    expect(result).toEqual(detailBody);
    expect(result).toMatchObject({ refinancingId: uuid(6), originLoan: { id: origin, loanNumber: '100', status: 'REFINANCED' },
      newLoan: { id: uuid(7), loanNumber: '150', status: 'ACTIVE' },
      financialComposition: { outstandingPrincipalTransferred: '120000.00', capitalizedOutstandingInterest: '30000.00',
        newMoneyDisbursed: '0.00', newContractualPrincipal: '150000.00', newInterestAmount: '40000.00',
        newContractualTotal: '190000.00' }, newContract: { disbursementPaymentMethod: null }, disbursement: null });
    expect(result.customer).toEqual({ id: uuid(5), fullName: 'Customer One', identification: '123' });
    expect(result.createdBy).toEqual({ id: actor, fullName: 'Operator' });
    expect(result.id).toBeUndefined();
    expect((await post(body(), 'super')).status).toBe(201);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining(body()), actor);
  });

  it('rejects untrusted monetary composition, old plan fields and invalid UUIDs', async () => {
    for (const forbidden of ['outstandingPrincipalTransferred', 'capitalizedOutstandingInterest', 'newContractualPrincipal', 'cantidad_pagos']) {
      expect((await post({ ...body(), [forbidden]: '1.00' }, 'operator')).status).toBe(400);
    }
    expect((await post({ ...body(), disbursementPaymentMethodId: 'bad' }, 'operator')).status).toBe(400);
    expect((await get('loans/not-a-uuid/preview', 'viewer')).status).toBe(400);
    for (const path of ['loans?page=0', 'loans?pageSize=100', `loans?search=${'a'.repeat(121)}`]) {
      expect((await get(path, 'viewer')).status).toBe(400);
    }
    expect(confirm).not.toHaveBeenCalled();
  });

  it('returns the disbursement method and linked movement for positive new money', async () => {
    confirm.mockResolvedValueOnce({ ...operation(), newMoneyDisbursed: '50000.00',
      newContractualPrincipal: '200000.00', newContractualTotal: '240000.00',
      disbursementId: uuid(10), disbursementMethodId: uuid(11), disbursementPaymentMethodName: 'Transfer',
      disbursementAmount: '50000.00', disbursementDate: '2026-09-30', cashMovementId: uuid(12),
      cashAmount: '50000.00', cashDate: '2026-09-30', cashMethodId: uuid(11),
      cashDirection: 'OUTFLOW', cashConcept: 'REFINANCING_NEW_MONEY_DISBURSEMENT' });
    const result = await post({ ...body(), newMoney: '50000.00', disbursementPaymentMethodId: uuid(11),
      plan: [{ sequence: 1, dueDate: '2026-10-30', pendingAmount: '240000.00' }] }, 'operator');
    expect(result.status).toBe(201);
    expect(await result.json()).toMatchObject({ financialComposition: {
      outstandingPrincipalTransferred: '120000.00', capitalizedOutstandingInterest: '30000.00',
      newMoneyDisbursed: '50000.00', newContractualPrincipal: '200000.00', newContractualTotal: '240000.00' },
    newContract: { disbursementPaymentMethod: { id: uuid(11), name: 'Transfer' } },
    disbursement: { id: uuid(10), cashMovementId: uuid(12) } });
  });

  it('maps business conflicts and does not leak unexpected SQL errors', async () => {
    confirm.mockRejectedValueOnce(new RefinancingConflictError('stale preview', 'STALE_DATA'));
    const stale = await post(body(), 'operator');
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reasonCode: 'STALE_DATA' });
    confirm.mockRejectedValueOnce(new RefinancingConflictError('historical balance', 'HISTORICAL_BALANCE_CONFLICT'));
    const historical = await post(body(), 'operator');
    expect(historical.status).toBe(409);
    expect(await historical.json()).toMatchObject({ reasonCode: 'HISTORICAL_BALANCE_CONFLICT' });
    confirm.mockRejectedValueOnce(new Error('private SQL detail'));
    const error = await post(body(), 'operator');
    expect(error.status).toBe(500);
    expect(JSON.stringify(await error.json())).not.toContain('private SQL detail');
  });
});
