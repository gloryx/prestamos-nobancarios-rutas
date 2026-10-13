import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AssignedLoansForbiddenError, AssignedLoansIntegrityError, AssignedLoansUseCase, type AssignedLoansReader } from '../src/application/loan/assigned-loans.use-case';
import { AssignedLoansTypeormReader } from '../src/infrastructure/database/typeorm/repositories/assigned-loans.reader';
import { LoanController } from '../src/presentation/loan/loan.controller';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { PATH_METADATA } from '@nestjs/common/constants';

const actor = (id = 'collector-user') => ({ id, username: 'collector', fullName: 'Collector', sessionId: 'session', permissions: ['loans.assigned.view'],
  role: { id: 'role', code: 'COLLECTOR', name: 'Collector', isSuperAdmin: false } });
const query = { page: 1, pageSize: 20, status: 'ALL' as const, search: ' Ana ', sortBy: 'customer' as const, sortOrder: 'asc' as const };

describe('assigned loans collector scope', () => {
  it('derives list and direct detail scope only from the authenticated collector user', async () => {
    const reader = { resolveCollector: jest.fn(async (_userId: string) => true), list: jest.fn(async (input, _userId: string) => ({ items: [], total: 0, page: input.page, pageSize: input.pageSize })), detail: jest.fn(async (id: string, _userId: string) => id === 'own' ? { id } : null) } as unknown as jest.Mocked<AssignedLoansReader>;
    const useCase = new AssignedLoansUseCase(reader);
    await expect(useCase.list(query, actor())).resolves.toMatchObject({ total: 0 });
    expect(reader.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'Ana', status: 'ACTIVE' }), { kind: 'COLLECTOR', collectorUserId: 'collector-user' });
    await expect(useCase.detail('own', actor())).resolves.toEqual({ id: 'own' });
    await expect(useCase.detail('foreign', actor())).rejects.toBeInstanceOf(AssignedLoansForbiddenError);
    expect(reader.detail).toHaveBeenNthCalledWith(2, 'foreign', { kind: 'COLLECTOR', collectorUserId: 'collector-user' });
  });

  it('rejects missing/inactive collector profiles and never reaches reads', async () => {
    const reader = { resolveCollector: jest.fn(async (_userId: string) => false), list: jest.fn(), detail: jest.fn() } as unknown as jest.Mocked<AssignedLoansReader>;
    const useCase = new AssignedLoansUseCase(reader);
    await expect(useCase.list(query, actor('inactive'))).rejects.toBeInstanceOf(AssignedLoansForbiddenError);
    expect(reader.list).not.toHaveBeenCalled();
  });

  it('preserves the centralized superadmin bypass without resolving a collector profile', async () => {
    const reader = { resolveCollector: jest.fn(), list: jest.fn(async (input) => ({ items: [], total: 0, page: input.page, pageSize: input.pageSize })), detail: jest.fn() } as unknown as jest.Mocked<AssignedLoansReader>;
    const superadmin = { ...actor('admin'), role: { id: 'admin-role', code: 'ADMIN', name: 'Admin', isSuperAdmin: true } };
    await new AssignedLoansUseCase(reader).list(query, superadmin);
    expect(reader.resolveCollector).not.toHaveBeenCalled();
    expect(reader.list).toHaveBeenCalledWith(expect.anything(), { kind: 'ALL' });
  });

  it('applies current multi-route ownership before search, filters, count and pagination', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const manager = { query: jest.fn(async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return sql.includes('COUNT(*)') ? [{ total: 2 }] : []; }) };
    const source = { query: jest.fn(async () => [{ '?column?': 1 }]), transaction: jest.fn(async (_level: string, run: (value: typeof manager) => unknown) => run(manager)) };
    const totals = { readValidTotals: jest.fn() };
    const reader = new AssignedLoansTypeormReader(source as unknown as DataSource, totals);
    await expect(reader.resolveCollector('collector-user')).resolves.toBe(true);
    await expect(reader.list({ ...query, status: 'ACTIVE', frequencyId: 'frequency', fromDate: '2026-01-01', toDate: '2026-12-31' }, { kind: 'COLLECTOR', collectorUserId: 'collector-user' })).resolves.toMatchObject({ total: 2 });
    for (const call of calls) {
      expect(call.sql).toContain('cra.ended_at IS NULL');
      expect(call.sql).toContain('ca.ended_at IS NULL');
      expect(call.sql).toContain('r.is_active=true');
      expect(call.sql).toContain('sc.id=l.customer_id');
      expect(call.sql).toContain('l.status =');
      expect(call.sql).toContain('ILIKE');
      expect(call.params[0]).toBe('collector-user');
    }
    expect(calls[0].sql).toContain('COUNT(*)');
    expect(calls[1].sql).toContain('LIMIT');
    expect(calls[1].sql).toContain("p.status='VALID'");
    expect(calls[1].sql).toContain('LEFT JOIN LATERAL');
    expect(calls[1].sql).toContain('next_due.due_date');
  });

  it('enriches assigned detail with canonical balance, pending reservations and active capture methods', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const manager = { query: jest.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('FROM loans l')) return [{ id: 'own', loanNumber: '42', status: 'ACTIVE', startDate: '2026-01-01',
        principal: '90.00', interestAmount: '10.00', totalAmount: '100.00', observations: null, updatedAt: new Date(),
        customerId: 'customer', customerName: 'Ana', identification: '1', paymentFrequencyId: 'frequency', frequencyName: 'Weekly',
        intervalUnit: 'DAY', intervalValue: 7, createdByName: 'Admin', preferredPaymentMethodId: 'cash',
        preferredPaymentMethod: 'Cash', disbursementPaymentMethod: 'Cash', pendingTotal: '80.00' }];
      if (sql.includes('FROM payment_plan_entries')) return [{ id: 'entry', sequence: 1, dueDate: '2026-01-08', pendingAmount: '80.00' }];
      if (sql.includes("FROM payments WHERE loan_id=$1 AND status='VALID'")) return [{ id: 'payment', amount: '20.00', paymentDate: '2026-01-02', status: 'VALID' }];
      if (sql.includes('FROM payment_applications pa')) return [{ paymentId: 'payment', planEntryId: 'entry', sequence: 1,
        amountApplied: '20.00', carriedForwardAmount: '0.00', carriedToPlanEntryId: null, sourceDueDate: '2026-01-08', createdAt: new Date() }];
      if (sql.includes('FROM collector_precollections')) return [{ amount: '15.00' }];
      if (sql.includes('FROM payment_methods')) return [{ id: 'cash', name: 'Cash' }];
      return [];
    }) };
    const source = { transaction: jest.fn(async (_level: string, run: (value: typeof manager) => unknown) => run(manager)) };
    const totals = { readValidTotals: jest.fn(async () => ({ paidAmount: '20.00', paidPrincipal: '18.00', paidInterest: '2.00', invalidCount: 0 })) };
    const detail = await new AssignedLoansTypeormReader(source as unknown as DataSource, totals).detail('own',
      { kind: 'COLLECTOR', collectorUserId: 'collector-user' });

    expect(detail).toMatchObject({ financialBalance: '80.00', reservedPrecollections: '15.00', operationalBalance: '65.00',
      activePaymentMethods: [{ id: 'cash', name: 'Cash' }], validPayments: [{ id: 'payment',
        applications: [{ planEntryId: 'entry', sequence: 1, amountApplied: '20.00' }] }] });
    expect(totals.readValidTotals).toHaveBeenCalledWith(manager, 'own');
    expect(calls.find(({ sql }) => sql.includes('FROM collector_precollections'))?.sql).toContain("status IN ('RECORDED','SUBMITTED')");
    expect(calls.find(({ sql }) => sql.includes('FROM payment_methods'))?.sql).toContain('is_active=true');
    const scopedRead = calls.find(({ sql }) => sql.includes('FROM loans l'))!;
    expect(scopedRead.sql).toContain('cra.ended_at IS NULL');
    expect(scopedRead.sql).toContain('ca.ended_at IS NULL');
    expect(scopedRead.params).toEqual(['own', 'collector-user']);
  });

  it('fails closed when reservations exceed the canonical financial balance', async () => {
    const manager = { query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM loans l')) return [{ id: 'own', principal: '90.00', interestAmount: '10.00', totalAmount: '100.00' }];
      if (sql.includes('FROM payment_plan_entries')) return [{ pendingAmount: '80.00' }];
      if (sql.includes('FROM collector_precollections')) return [{ amount: '81.00' }];
      return [];
    }) };
    const source = { transaction: jest.fn(async (_level: string, run: (value: typeof manager) => unknown) => run(manager)) };
    const totals = { readValidTotals: jest.fn(async () => ({ paidAmount: '20.00', paidPrincipal: '18.00', paidInterest: '2.00', invalidCount: 0 })) };
    await expect(new AssignedLoansTypeormReader(source as unknown as DataSource, totals).detail('own', { kind: 'ALL' }))
      .rejects.toBeInstanceOf(AssignedLoansIntegrityError);
  });

  it('uses permissions and an active collector profile instead of direct role comparisons', async () => {
    const reader = { resolveCollector: jest.fn(async () => true), list: jest.fn(async (input) => ({ items: [], total: 0, page: input.page, pageSize: input.pageSize })), detail: jest.fn() } as unknown as jest.Mocked<AssignedLoansReader>;
    const customRoleActor = { ...actor(), role: { id: 'operations-role', code: 'OPERATIONS', name: 'Operations', isSuperAdmin: false } };
    await expect(new AssignedLoansUseCase(reader).list(query, customRoleActor)).resolves.toMatchObject({ total: 0 });
    expect(reader.resolveCollector).toHaveBeenCalledWith('collector-user');
    expect(AssignedLoansUseCase.prototype['collectorScope'].toString()).not.toContain('role.code');
  });

  it('protects assigned endpoints with the narrow permission and leaves administrative reads unchanged', () => {
    expect(Reflect.getMetadata(PATH_METADATA, LoanController.prototype.assignedLoans)).toBe('assigned');
    expect(Reflect.getMetadata(PATH_METADATA, LoanController.prototype.assignedLoanDetail)).toBe('assigned/:id');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype.assignedLoans)).toEqual(['loans.assigned.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype.assignedLoanDetail)).toEqual(['loans.assigned.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype.listLoans)).toEqual(['loans.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype.detail)).toEqual(['loans.view']);
  });
});
