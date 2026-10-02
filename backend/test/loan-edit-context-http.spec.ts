import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { APP_GUARD } from '@nestjs/core';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CreateLoanUseCase, ListActiveLoanCustomersUseCase, ListLoansUseCase } from '../src/application/loan/loan.use-case';
import { ListCancelledLoansUseCase } from '../src/application/loan/cancelled-loans.use-case';
import { MarkUncollectibleUseCase } from '../src/application/loan/mark-uncollectible.use-case';
import { ReactivateLoanUseCase } from '../src/application/loan/reactivate-loan.use-case';
import { ListOverdueLoansUseCase } from '../src/application/loan/overdue-loans.use-case';
import { ListUncollectibleLoansUseCase } from '../src/application/loan/uncollectible-loans.use-case';
import { EditLoanUseCase } from '../src/application/loan/edit-loan.use-case';
import { GetLoanEditContextUseCase, LOAN_EDIT_CONTEXT_READER, LoanEditContextConflictError,
  LoanEditContextNotFoundError } from '../src/application/loan/loan-edit-context.use-case';
import { LOAN_FINANCIAL_TOTALS_READER } from '../src/application/loan/loan-financial-totals.reader';
import { ListPaymentFrequenciesUseCase, GetPaymentFrequencyUseCase, CreatePaymentFrequencyUseCase,
  UpdatePaymentFrequencyUseCase, ChangePaymentFrequencyStatusUseCase } from '../src/application/payment-frequency/payment-frequency.use-cases';
import { ListPaymentMethodsUseCase, GetPaymentMethodUseCase, CreatePaymentMethodUseCase,
  UpdatePaymentMethodUseCase, ChangePaymentMethodStatusUseCase } from '../src/application/payment-method/payment-method.use-cases';
import { SecurityUnauthorizedError } from '../src/application/security/security.errors';
import { SecurityService } from '../src/application/security/security.service';
import { LoanController } from '../src/presentation/loan/loan.controller';
import { LoanModule } from '../src/presentation/loan/loan.module';
import { PaymentFrequencyController } from '../src/presentation/payment-frequency/payment-frequency.controller';
import { PaymentMethodController } from '../src/presentation/payment-method/payment-method.controller';
import { AuthenticationGuard } from '../src/presentation/security/auth.guard';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { SESSION_COOKIE } from '../src/shared/constants/security';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const response = { loan: { id: id(1), loanNumber: '1', customer: { id: id(2), identification: '123', fullName: 'Jane' },
  status: 'ACTIVE', principal: '100.00', interestAmount: '20.00', totalAmount: '120.00', startDate: '2026-09-01',
  paymentFrequencyId: id(3), paymentFrequencyName: 'Daily', preferredPaymentMethodId: id(4), preferredPaymentMethodName: 'Cash', observations: null },
baseline: { interestAmount: '20.00', paymentFrequencyId: id(3), preferredPaymentMethodId: id(4), observations: null,
  financialBalance: '120.00', plan: [{ id: id(5), dueDate: '2026-10-01', pendingAmount: '120.00' }] },
paymentFrequencyOptions: [{ id: id(3), name: 'Daily', active: true }],
preferredPaymentMethodOptions: [{ id: id(4), name: 'Cash', active: true }] };

describe('GET /loans/:id/edit-context HTTP and RBAC', () => {
  const execute = jest.fn().mockResolvedValue(response);
  const authenticate = jest.fn(async (token?: string) => {
    if (token === 'editor') return { id: id(6), role: { isSuperAdmin: false }, permissions: ['loans.update'] };
    if (token === 'viewer') return { id: id(7), role: { isSuperAdmin: false }, permissions: ['loans.view'] };
    if (token === 'super') return { id: id(8), role: { isSuperAdmin: true }, permissions: [] };
    throw new SecurityUnauthorizedError();
  });
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const loanDependencies = [CreateLoanUseCase, ListLoansUseCase, ListActiveLoanCustomersUseCase,
      ListCancelledLoansUseCase, MarkUncollectibleUseCase, ReactivateLoanUseCase, ListOverdueLoansUseCase,
      ListUncollectibleLoansUseCase, EditLoanUseCase];
    const catalogDependencies = [ListPaymentFrequenciesUseCase, GetPaymentFrequencyUseCase, CreatePaymentFrequencyUseCase,
      UpdatePaymentFrequencyUseCase, ChangePaymentFrequencyStatusUseCase, ListPaymentMethodsUseCase,
      GetPaymentMethodUseCase, CreatePaymentMethodUseCase, UpdatePaymentMethodUseCase, ChangePaymentMethodStatusUseCase];
    const module = await Test.createTestingModule({ controllers: [LoanController, PaymentFrequencyController, PaymentMethodController],
      providers: [...loanDependencies.map((provide) => ({ provide, useValue: {} })),
        ...catalogDependencies.map((provide) => ({ provide, useValue: { execute: jest.fn().mockResolvedValue([]) } })),
        { provide: GetLoanEditContextUseCase, useValue: { execute } },
        { provide: SecurityService, useValue: { authenticate } },
        { provide: APP_GUARD, useClass: AuthenticationGuard }, { provide: APP_GUARD, useClass: PermissionGuard }],
    }).compile();
    const app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    close = () => app.close();
  });
  afterAll(async () => { await close?.(); });
  beforeEach(() => { execute.mockReset().mockResolvedValue(response); authenticate.mockClear(); });
  const get = (path = `/loans/${id(1)}/edit-context`, token?: string) => fetch(`${baseUrl}${path}`,
    { headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {} });

  it('registers only loans.update on the new GET and keeps catalog GET permissions unchanged', () => {
    const method = LoanController.prototype.getEditContext;
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(':id/edit-context');
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['loans.update']);
    for (const catalog of [PaymentFrequencyController, PaymentMethodController]) {
      const permission = catalog === PaymentFrequencyController ? 'payment-frequencies.view' : 'payment-methods.view';
      expect(Reflect.getMetadata(PERMISSIONS_KEY, catalog.prototype.listAll)).toEqual([permission]);
    }
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, LoanModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find((entry) => entry.provide === LOAN_EDIT_CONTEXT_READER)?.inject)
      .toEqual([DataSource, LOAN_FINANCIAL_TOTALS_READER]);
    expect(providers.find((entry) => entry.provide === GetLoanEditContextUseCase)?.inject).toEqual([LOAN_EDIT_CONTEXT_READER]);
  });

  it('grants loans.update alone and superadmin, not catalog or loans.view access', async () => {
    const allowed = await get(undefined, 'editor');
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual(response);
    expect(execute).toHaveBeenCalledWith(id(1));
    for (const path of ['/payment-frequencies', '/payment-methods', `/loans/${id(1)}`])
      expect((await get(path, 'editor')).status).toBe(403);
    expect((await get(undefined, 'super')).status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('rejects missing authentication, missing update permission and an invalid UUID before reading', async () => {
    expect((await get()).status).toBe(401);
    expect((await get(undefined, 'viewer')).status).toBe(403);
    expect((await get('/loans/invalid-uuid/edit-context', 'editor')).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([[LoanEditContextNotFoundError, 404], [LoanEditContextConflictError, 409]])
  ('maps %p to %i', async (ErrorType, status) => {
    execute.mockRejectedValueOnce(new ErrorType('Typed snapshot failure'));
    const result = await get(undefined, 'editor');
    expect(result.status).toBe(status);
    expect(await result.json()).toMatchObject({ message: 'Typed snapshot failure' });
  });

  it('sanitizes unexpected failures', async () => {
    execute.mockRejectedValueOnce(new Error('private SQL detail'));
    const result = await get(undefined, 'editor');
    expect(result.status).toBe(500);
    expect(JSON.stringify(await result.json())).not.toContain('private SQL detail');
  });
});
