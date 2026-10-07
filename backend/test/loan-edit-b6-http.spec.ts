import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CreateLoanUseCase, ListActiveLoanCustomersUseCase, ListLoansUseCase } from '../src/application/loan/loan.use-case';
import { ListCancelledLoansUseCase } from '../src/application/loan/cancelled-loans.use-case';
import { MarkUncollectibleUseCase } from '../src/application/loan/mark-uncollectible.use-case';
import { ReactivateLoanUseCase } from '../src/application/loan/reactivate-loan.use-case';
import { ListOverdueLoansUseCase } from '../src/application/loan/overdue-loans.use-case';
import { ListUncollectibleLoansUseCase } from '../src/application/loan/uncollectible-loans.use-case';
import { EditLoanUseCase, LoanEditConflictError, LoanEditNotFoundError, LoanEditValidationError } from '../src/application/loan/edit-loan.use-case';
import { GetLoanEditContextUseCase } from '../src/application/loan/loan-edit-context.use-case';
import { LoanEditInputError, normalizeLoanEditCommand } from '../src/application/loan/loan-edit.command';
import { LOAN_FINANCIAL_TOTALS_READER } from '../src/application/loan/loan-financial-totals.reader';
import { PaymentConflictError, PaymentValidationError } from '../src/application/payment/payment.errors';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { LoanEditIdempotencyConflictError, LoanEditIdempotencyInputError } from '../src/infrastructure/database/typeorm/repositories/loan-edit-operations.repository';
import { LoanController } from '../src/presentation/loan/loan.controller';
import { LoanModule } from '../src/presentation/loan/loan.module';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const loan = id(1);
const actor = id(2);
const receipt = { operationId: id(6), loanId: loan, createdAt: new Date('2026-09-30T12:00:00.000Z') };
const body = () => ({ idempotencyKey: 'edit-key', baseline: { interestAmount: '20.00', paymentFrequencyId: id(3),
  preferredPaymentMethodId: id(4), observations: ' Original ', financialBalance: '120.00',
  plan: [{ id: id(5), dueDate: '2026-10-01', pendingAmount: '120.00' }] },
changes: { interestAmount: '30.00', observations: ' Revised ' },
plan: [{ id: id(5), dueDate: '2026-10-01', pendingAmount: '130.00' }] });
const identity = (permissions: string[], isSuperAdmin = false) => ({ id: actor, username: 'test', fullName: 'Test',
  role: { id: id(7), code: 'TEST', name: 'Test', isSuperAdmin }, permissions, sessionId: id(8) });

describe('PATCH /loans/:id HTTP boundary', () => {
  const execute = jest.fn().mockResolvedValue(receipt);
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'admin') return identity(['loans.update']);
    if (token === 'super') return identity([], true);
    if (token === 'viewer') return identity(['loans.view']);
    throw new SecurityUnauthorizedError();
  });
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const dependencies = [CreateLoanUseCase, ListLoansUseCase, ListActiveLoanCustomersUseCase, ListCancelledLoansUseCase,
      MarkUncollectibleUseCase, ReactivateLoanUseCase, ListOverdueLoansUseCase, ListUncollectibleLoansUseCase];
    const module = await Test.createTestingModule({ controllers: [LoanController], providers: [
      ...dependencies.map((provide) => ({ provide, useValue: {} })),
      { provide: EditLoanUseCase, useValue: { execute } },
      { provide: GetLoanEditContextUseCase, useValue: { execute: jest.fn() } },
      { provide: SecurityService, useValue: { authenticate } },
      { provide: APP_GUARD, useClass: AuthenticationGuard }, { provide: APP_GUARD, useClass: PermissionGuard },
    ] }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    close = () => app.close();
  });
  afterAll(async () => { await close?.(); });
  beforeEach(() => { execute.mockReset().mockResolvedValue(receipt); authenticate.mockClear(); });

  const patch = (data: unknown = body(), token?: string, loanId = loan) => fetch(`${baseUrl}/loans/${loanId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...(token && { cookie: `${SESSION_COOKIE}=${token}` }) },
    body: JSON.stringify(data),
  });

  it('preserves all nine prior routes and wires only the new permissioned PATCH through the existing totals reader', () => {
    const existing = [
      ['customerOptions', 'loans.create', RequestMethod.GET], ['listLoans', 'loans.view', RequestMethod.GET],
      ['cancelledLoans', 'loans.view', RequestMethod.GET], ['overdueLoans', 'loans.view', RequestMethod.GET],
      ['uncollectibleLoans', 'loans.view', RequestMethod.GET], ['createLoan', 'loans.create', RequestMethod.POST],
      ['markAsUncollectible', 'loans.status.uncollectible', RequestMethod.POST],
      ['reactivate', 'loans.status.reactivate', RequestMethod.POST], ['detail', 'loans.view', RequestMethod.GET],
    ] as const;
    const routes = Object.getOwnPropertyNames(LoanController.prototype).filter((name) => name !== 'constructor' &&
      Reflect.hasOwnMetadata(PATH_METADATA, LoanController.prototype[name as keyof LoanController]));
    expect(routes).toEqual([existing[0][0], 'assignedLoans', 'assignedLoanDetail', existing[1][0], 'activeLoanSummary', 'exportActiveLoans', ...existing.slice(2, 5).map(([name]) => name), 'annullableLoans', 'annulledLoansList',
      ...existing.slice(5, 8).map(([name]) => name), 'annulLoan', 'detail', 'editLoan', 'getEditContext']);
    for (const [name, permission, method] of existing) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype[name])).toEqual([permission]);
      expect(Reflect.getMetadata(METHOD_METADATA, LoanController.prototype[name])).toBe(method);
    }
    expect(Reflect.getMetadata(PATH_METADATA, LoanController.prototype.editLoan)).toBe(':id');
    expect(Reflect.getMetadata(METHOD_METADATA, LoanController.prototype.editLoan)).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype.editLoan)).toEqual(['loans.update']);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, LoanModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find((entry) => entry.provide === EditLoanUseCase)?.inject).toEqual([DataSource, LOAN_FINANCIAL_TOTALS_READER]);
  });

  it('normalizes the financial edit using the route ID and authenticated actor and returns the exact stored receipt on fresh/replay', async () => {
    const draft = body();
    const first = await patch(draft, 'admin');
    const replay = await patch(draft, 'admin');
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    const expected = { operationId: receipt.operationId, loanId: loan, createdAt: receipt.createdAt.toISOString() };
    expect(await first.json()).toEqual(expected);
    expect(await replay.json()).toEqual(expected);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, normalizeLoanEditCommand(draft, loan, actor));
    expect(execute.mock.calls[0][0]).toMatchObject({ actorId: actor, loanId: loan, changes: { interestAmount: 3000n },
      baseline: { interestAmount: 2000n, financialBalance: 12000n }, plan: [{ id: id(5), pendingAmount: 13000n }] });
  });

  it('rejects missing authentication and unrelated permission; permits an authorized identity and superadmin bypass', async () => {
    expect((await patch()).status).toBe(401);
    expect((await patch(body(), 'viewer')).status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
    expect((await patch(body(), 'admin')).status).toBe(200);
    expect((await patch(body(), 'super')).status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each(['principal', 'startDate', 'status', 'actorId'])('rejects forbidden body field %s before calling the use case', async (field) => {
    const result = await patch({ ...body(), [field]: 'untrusted' }, 'admin');
    expect(result.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects forbidden nested fields, malformed dates, missing baseline and invalid route UUID before executing', async () => {
    for (const draft of [
      { ...body(), changes: { ...body().changes, principal: '1.00' } },
      { ...body(), baseline: { ...body().baseline, startDate: '2026-09-01' } },
      { ...body(), plan: [{ ...body().plan[0], loanId: id(9) }] },
      { ...body(), plan: [{ ...body().plan[0], dueDate: '2026-02-30' }] },
      { ...body(), baseline: undefined },
    ]) expect((await patch(draft, 'admin')).status).toBe(400);
    expect((await patch(body(), 'admin', 'invalid-uuid')).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    [LoanEditInputError, 400], [LoanEditValidationError, 400], [LoanEditIdempotencyInputError, 400],
    [PaymentValidationError, 400], [LoanEditNotFoundError, 404], [LoanEditConflictError, 409],
    [LoanEditIdempotencyConflictError, 409], [PaymentConflictError, 409],
  ])('maps typed %p to HTTP %i', async (ErrorType, status) => {
    execute.mockRejectedValueOnce(new ErrorType('Typed edit failure'));
    const response = await patch(body(), 'admin');
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ message: 'Typed edit failure' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('sanitizes unexpected failures instead of leaking internal details', async () => {
    execute.mockRejectedValueOnce(new Error('private internal detail'));
    const response = await patch(body(), 'admin');
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private internal detail');
  });
});
