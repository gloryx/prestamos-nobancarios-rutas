import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CreateLoanUseCase, ListLoansUseCase, ListActiveLoanCustomersUseCase } from '../src/application/loan/loan.use-case';
import { ListCancelledLoansUseCase } from '../src/application/loan/cancelled-loans.use-case';
import { MarkUncollectibleUseCase } from '../src/application/loan/mark-uncollectible.use-case';
import { ReactivateLoanUseCase } from '../src/application/loan/reactivate-loan.use-case';
import { ListOverdueLoansUseCase } from '../src/application/loan/overdue-loans.use-case';
import { ListUncollectibleLoansUseCase } from '../src/application/loan/uncollectible-loans.use-case';
import { EditLoanUseCase } from '../src/application/loan/edit-loan.use-case';
import { GetLoanEditContextUseCase } from '../src/application/loan/loan-edit-context.use-case';
import { ListAnnulledLoansUseCase, ANNULLED_LOANS_READER, AnnulledLoansIntegrityError } from '../src/application/loan/annulled-loans.use-case';
import { AnnulLoanUseCase, ANNUL_LOAN_WRITER, AnnulLoanConflictError, AnnulLoanNotFoundError, AnnulLoanIntegrityError } from '../src/application/loan/annul-loan.use-case';
import { LOAN_FINANCIAL_TOTALS_READER } from '../src/application/loan/loan-financial-totals.reader';
import { SecurityService } from '../src/application/security/security.service';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { LoanController } from '../src/presentation/loan/loan.controller';
import { LoanModule } from '../src/presentation/loan/loan.module';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { PERMISSIONS, SESSION_COOKIE } from '../src/shared/constants/security';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const actor = id(2); const loan = id(1);
const body = () => ({ idempotencyKey: 'annul-key', reason: '  Not delivered  ', disbursementResolution: 'NOT_DELIVERED' });
const identity = (permissions: string[], isSuperAdmin = false) => ({ id: actor, username: 'test', fullName: 'Test',
  role: { id: id(3), code: 'TEST', name: 'Test', isSuperAdmin }, permissions, sessionId: id(4) });

describe('Loan annulment HTTP and central authorization', () => {
  const list = jest.fn(); const annul = jest.fn();
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'reader') return identity(['loans.view']);
    if (token === 'annuller') return identity(['loans.status.annul']);
    if (token === 'super') return identity([], true);
    throw new SecurityUnauthorizedError();
  });
  let base: string; let close: () => Promise<void>;
  beforeAll(async () => {
    const prior = [CreateLoanUseCase, ListLoansUseCase, ListActiveLoanCustomersUseCase, ListCancelledLoansUseCase,
      MarkUncollectibleUseCase, ReactivateLoanUseCase, ListOverdueLoansUseCase, ListUncollectibleLoansUseCase,
      EditLoanUseCase, GetLoanEditContextUseCase];
    const module = await Test.createTestingModule({ controllers: [LoanController], providers: [
      ...prior.map((provide) => ({ provide, useValue: {} })),
      { provide: ListAnnulledLoansUseCase, useValue: { execute: list } },
      { provide: AnnulLoanUseCase, useValue: { execute: annul } },
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
  beforeEach(() => { list.mockReset().mockResolvedValue({ items: [], summary: { total: 0 } });
    annul.mockReset().mockResolvedValue({ loanId: loan, status: 'ANNULLED' }); });
  const get = (path: string, token?: string) => fetch(`${base}/loans/${path}`, { headers: { ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) } });
  const post = (draft: unknown = body(), token?: string, loanId = loan) => fetch(`${base}/loans/${loanId}/annul`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
    body: JSON.stringify(draft),
  });

  it('registers both GETs and POST on the existing module and dynamic permission catalog only', () => {
    expect(PERMISSIONS.filter(([code]) => code === 'loans.status.annul')).toHaveLength(1);
    for (const [handler, path, method, permission] of [
      ['annullableLoans', 'annullable', RequestMethod.GET, 'loans.view'],
      ['annulledLoansList', 'annulled', RequestMethod.GET, 'loans.view'],
      ['annulLoan', ':id/annul', RequestMethod.POST, 'loans.status.annul'],
    ] as const) {
      const fn = LoanController.prototype[handler];
      expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(method);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toEqual([permission]);
    }
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, LoanModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find((p) => p.provide === ListAnnulledLoansUseCase)?.inject).toEqual([ANNULLED_LOANS_READER]);
    expect(providers.find((p) => p.provide === AnnulLoanUseCase)?.inject).toEqual([ANNUL_LOAN_WRITER, LOAN_FINANCIAL_TOTALS_READER]);
    expect(providers.find((p) => p.provide === ANNUL_LOAN_WRITER)?.inject).toEqual([DataSource]);
  });

  it('rejects unauthenticated and unrelated permission, permits superadmin without a role grant', async () => {
    expect((await get('annullable')).status).toBe(401);
    expect((await get('annulled', 'annuller')).status).toBe(403);
    expect((await post(body(), 'reader')).status).toBe(403);
    expect((await get('annullable', 'reader')).status).toBe(200);
    expect((await get('annulled', 'super')).status).toBe(200);
    expect((await post(body(), 'annuller')).status).toBe(201);
    expect((await post(body(), 'super')).status).toBe(201);
    expect(annul).toHaveBeenCalledWith(loan, body(), actor);
  });

  it('passes bound query fields and rejects unknown body, malformed route UUID, and invalid resolution/reason', async () => {
    expect((await get('annullable?page=2&pageSize=10&search=Ana&startDate=2026-09-01', 'reader')).status).toBe(200);
    expect(list).toHaveBeenCalledWith('annullable', expect.objectContaining({ page: 2, pageSize: 10, search: 'Ana', startDate: '2026-09-01' }));
    for (const field of ['status', 'principal', 'amount', 'cashId', 'loanId'])
      expect((await post({ ...body(), [field]: 'invalid' }, 'annuller')).status).toBe(400);
    for (const draft of [{ ...body(), reason: ' '.repeat(8) }, { ...body(), reason: 'x'.repeat(501) },
      { ...body(), disbursementResolution: 'MONEY_STILL_WITH_CUSTOMER' }, { ...body(), idempotencyKey: 'bad\nkey' }])
      expect((await post(draft, 'annuller')).status).toBe(400);
    expect((await post(body(), 'annuller', 'not-a-uuid')).status).toBe(400);
    expect(annul).not.toHaveBeenCalled();
  });

  it('maps typed 404/409/500 and hides unexpected failures', async () => {
    for (const [ErrorType, status] of [[AnnulLoanNotFoundError, 404], [AnnulLoanConflictError, 409],
      [AnnulLoanIntegrityError, 500]] as const) {
      annul.mockRejectedValueOnce(new ErrorType('Typed failure'));
      expect((await post(body(), 'annuller')).status).toBe(status);
    }
    list.mockRejectedValueOnce(new AnnulledLoansIntegrityError('private ledger detail'));
    const integrity = await get('annulled', 'reader');
    expect(integrity.status).toBe(500); expect(JSON.stringify(await integrity.json())).not.toContain('private ledger detail');
    annul.mockRejectedValueOnce(new Error('private SQL detail'));
    const unexpected = await post(body(), 'annuller');
    expect(unexpected.status).toBe(500); expect(JSON.stringify(await unexpected.json())).not.toContain('private SQL detail');
  });
});
