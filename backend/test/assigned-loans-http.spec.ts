import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AssignedLoansUseCase, type AssignedLoansReader } from '../src/application/loan/assigned-loans.use-case';
import { CreateLoanUseCase, ListActiveLoanCustomersUseCase, ListLoansUseCase } from '../src/application/loan/loan.use-case';
import { ListCancelledLoansUseCase } from '../src/application/loan/cancelled-loans.use-case';
import { MarkUncollectibleUseCase } from '../src/application/loan/mark-uncollectible.use-case';
import { ReactivateLoanUseCase } from '../src/application/loan/reactivate-loan.use-case';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { LoanController } from '../src/presentation/loan/loan.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const ownLoanId = '6616f9e6-b796-48b4-99b4-68af1d973797';
const foreignLoanId = '550e8400-e29b-41d4-a716-446655440000';
const identity = (code: string, permissions: string[]) => ({ id: `${code.toLowerCase()}-user`, username: code.toLowerCase(), fullName: code,
  role: { id: `${code.toLowerCase()}-role`, code, name: code, isSuperAdmin: false }, permissions, sessionId: `${code.toLowerCase()}-session` });

describe('assigned loans HTTP authorization', () => {
  const globalList = jest.fn(async () => ({ items: [], total: 0 }));
  const globalDetail = jest.fn(async (id: string) => ({ id }));
  const reader: jest.Mocked<AssignedLoansReader> = {
    resolveCollector: jest.fn(async () => true),
    list: jest.fn(async (query) => ({ items: [], total: 0, page: query.page, pageSize: query.pageSize })),
    detail: jest.fn(async (id) => id === ownLoanId ? { id, loanNumber: '42' } : null),
  } as unknown as jest.Mocked<AssignedLoansReader>;
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'collector') return identity('COLLECTOR', ['loans.assigned.view']);
    if (token === 'admin') return identity('ADMIN', ['loans.view']);
    throw new SecurityUnauthorizedError();
  });
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [LoanController], providers: [
      { provide: CreateLoanUseCase, useValue: { get: globalDetail } },
      { provide: ListLoansUseCase, useValue: { execute: globalList } },
      { provide: ListActiveLoanCustomersUseCase, useValue: {} },
      { provide: ListCancelledLoansUseCase, useValue: {} },
      { provide: MarkUncollectibleUseCase, useValue: {} },
      { provide: ReactivateLoanUseCase, useValue: {} },
      { provide: AssignedLoansUseCase, useValue: new AssignedLoansUseCase(reader) },
      { provide: SecurityService, useValue: { authenticate } },
      { provide: APP_GUARD, useClass: AuthenticationGuard },
      { provide: APP_GUARD, useClass: PermissionGuard },
    ] }).useMocker(() => ({})).compile();
    const app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    close = () => app.close();
  });

  afterAll(async () => close?.());
  beforeEach(() => { globalList.mockClear(); globalDetail.mockClear(); reader.list.mockClear(); reader.detail.mockClear(); });
  const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });

  it('allows assigned list and own detail but rejects a foreign loan', async () => {
    expect((await get('/loans/assigned', 'collector')).status).toBe(200);
    expect((await get(`/loans/assigned/${ownLoanId}`, 'collector')).status).toBe(200);
    expect((await get(`/loans/assigned/${foreignLoanId}`, 'collector')).status).toBe(403);
    expect(reader.list).toHaveBeenCalledWith(expect.anything(), { kind: 'COLLECTOR', collectorUserId: 'collector-user' });
  });

  it('does not let loans.assigned.view unlock global list or detail', async () => {
    expect((await get('/loans', 'collector')).status).toBe(403);
    expect((await get(`/loans/${ownLoanId}`, 'collector')).status).toBe(403);
    expect(globalList).not.toHaveBeenCalled();
    expect(globalDetail).not.toHaveBeenCalled();
  });

  it('preserves administrative global loan reads', async () => {
    expect((await get('/loans', 'admin')).status).toBe(200);
    expect((await get(`/loans/${ownLoanId}`, 'admin')).status).toBe(200);
    expect(globalList).toHaveBeenCalled();
    expect(globalDetail).toHaveBeenCalledWith(ownLoanId);
  });
});
