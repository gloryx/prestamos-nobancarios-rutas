import 'reflect-metadata';
import { BadRequestException, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import { ListOverdueLoansUseCase, OVERDUE_LOAN_SORTS, OVERDUE_LOANS_READER, OverdueLoansValidationError,
  type OverdueCandidate, type OverdueSnapshot } from '../src/application/loan/overdue-loans.use-case';
import { evaluateUncollectibleEligibilityFromSnapshot, EvaluateUncollectibleEligibilityUseCase } from '../src/application/loan/uncollectible-eligibility.use-case';
import { cents, evaluateLoanFinancialIntegrity } from '../src/domain/loan/loan-financial-integrity';
import { ListLoansUseCase } from '../src/application/loan/loan.use-case';
import { LoanFinancialBatchTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-batch.reader';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { UncollectibleEligibilityTypeormReader } from '../src/infrastructure/database/typeorm/repositories/uncollectible-eligibility.reader';
import { OverdueLoansTypeormReader } from '../src/infrastructure/database/typeorm/repositories/overdue-loans.reader';
import { LoanController } from '../src/presentation/loan/loan.controller';
import { OverdueLoansQueryDto } from '../src/presentation/loan/loan.dto';
import { LoanModule } from '../src/presentation/loan/loan.module';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
type Fact = OverdueCandidate & { status: string; primaryPhone: string; secondaryPhone: string; plan: Array<{ id: string; dueDate: string; sequence: number; pendingAmount: string }>;
  payments: Array<{ status: string; amount: string; principalApplied: string; interestApplied: string }> };
const fact = (n: number): Fact => ({ loanId: id(n), loanNumber: String(n), customerId: id(n + 100), identification: `DOC-${n}`,
  fullName: `Customer ${n}`, primaryPhone: `8888-${n}`, secondaryPhone: `7777-${n}`, status: 'ACTIVE',
  startDate: '2025-12-01', firstRowId: id(n + 200), firstOverdueDueDate: '2026-01-01', firstOverdueAmount: '100.00',
  principal: '100.00', interestAmount: '20.00', totalAmount: '120.00',
  plan: [{ id: id(n + 200), dueDate: '2026-01-01', sequence: 1, pendingAmount: '100.00' }],
  payments: [{ status: 'VALID', amount: '20.00', principalApplied: '15.00', interestApplied: '5.00' }] });
const query = { page: 1, pageSize: 10 };

// Execute the SELECT shapes against raw facts, so changing LATERAL ordering, status, or VALID filters breaks behavior.
function harness(facts: Fact[] = [fact(1)], today = '2026-02-01') {
  const manager = { query: jest.fn(async (sql: string, parameters: unknown[]): Promise<unknown[]> => {
    if (!/^SELECT\b/.test(sql) || /\b(?:UPDATE|INSERT|DELETE|FOR UPDATE)\b/i.test(sql)) throw new Error('Not a read-only SELECT.');
    if (sql.includes('JOIN LATERAL')) {
      if (!sql.includes("l.status = 'ACTIVE'") || !sql.includes('pe.pending_amount > 0') ||
        !sql.includes('pe.loan_id = l.id') || !sql.includes('JOIN customers c ON c.id = l.customer_id') ||
        !sql.includes('ORDER BY pe.due_date ASC, pe.sequence ASC, pe.id ASC LIMIT 1') ||
        !sql.includes('first.due_date < $1::date')) throw new Error('Invalid candidate selection.');
      const search = sql.includes('ILIKE') ? String(parameters[1]).slice(1, -1).toLowerCase() : undefined;
      if (search && ['l.loan_number::text', 'c.identification', 'c.primary_phone', 'c.secondary_phone', 'c.first_name'].some((field) => !sql.includes(field))) throw new Error('Missing search field.');
      const lower = sql.match(/first\.due_date >= \$(\d+)::date/);
      const upper = sql.match(/first\.due_date <= \$(\d+)::date/);
      return facts.filter((row) => row.status === 'ACTIVE').flatMap((row) => {
        const first = row.plan.filter((entry) => cents(entry.pendingAmount) > 0n).sort((a, b) =>
          a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence || a.id.localeCompare(b.id))[0];
        if (!first || first.dueDate >= parameters[0]! || (lower && first.dueDate < parameters[Number(lower[1]) - 1]!) ||
          (upper && first.dueDate > parameters[Number(upper[1]) - 1]!)) return [];
        if (search && ![row.loanNumber, row.identification, row.fullName, row.primaryPhone, row.secondaryPhone]
          .some((value) => value.toLowerCase().includes(search))) return [];
        return [{ loanId: row.loanId, loanNumber: row.loanNumber, customerId: row.customerId,
          identification: row.identification, fullName: row.fullName, startDate: row.startDate, principal: row.principal,
          interestAmount: row.interestAmount, totalAmount: row.totalAmount, firstRowId: first.id,
          firstOverdueDueDate: first.dueDate, firstOverdueAmount: first.pendingAmount }];
      });
    }
    if (!sql.includes('= ANY($1::uuid[])') || !Array.isArray(parameters[0])) throw new Error('Unbounded financial query.');
    const selected = facts.filter((row) => (parameters[0] as string[]).includes(row.loanId));
    if (sql.includes('FROM loans')) return selected.map((row) => ({ id: row.loanId, principal: row.principal,
      interestAmount: row.interestAmount, totalAmount: row.totalAmount }));
    if (sql.includes('FROM payments')) {
      if (!sql.includes("status = 'VALID'") || !sql.includes('GROUP BY loan_id') || !sql.includes('COUNT(*) FILTER')) throw new Error('Invalid financial payment selection.');
      return selected.flatMap((row) => {
        const valid = row.payments.filter((payment) => payment.status === 'VALID');
        const sum = (key: 'amount' | 'principalApplied' | 'interestApplied') => money(valid.reduce((total, payment) => total + cents(payment[key]), 0n));
        return valid.length ? [{ loanId: row.loanId, paidAmount: sum('amount'), paidPrincipal: sum('principalApplied'),
          paidInterest: sum('interestApplied'), invalidCount: valid.filter((payment) => cents(payment.amount) <= 0n ||
            cents(payment.principalApplied) < 0n || cents(payment.interestApplied) < 0n ||
            cents(payment.amount) !== cents(payment.principalApplied) + cents(payment.interestApplied)).length }] : [];
      });
    }
    if (sql.includes('FROM payment_plan_entries')) {
      if (!sql.includes('pending_amount > 0') || !sql.includes('GROUP BY loan_id')) throw new Error('Invalid financial plan selection.');
      return selected.flatMap((row) => {
        const positive = row.plan.filter((entry) => cents(entry.pendingAmount) > 0n);
        return positive.length ? [{ loanId: row.loanId, pendingAmount: money(positive.reduce((sum, entry) => sum + cents(entry.pendingAmount), 0n)) }] : [];
      });
    }
    throw new Error('Unexpected SELECT.');
  }) };
  const ds = { transaction: jest.fn(async (isolation: string, callback: (tx: typeof manager) => Promise<unknown>) => {
    expect(isolation).toBe('REPEATABLE READ');
    return callback(manager);
  }) };
  const warn = jest.fn();
  const reader = new OverdueLoansTypeormReader(ds as never, new LoanFinancialBatchTypeormReader());
  const useCase = new ListOverdueLoansUseCase(reader, () => today, warn);
  return { manager, ds, warn, reader, list: (filters: Partial<typeof query> & Record<string, unknown> = {}) => useCase.execute({ ...query, ...filters }) };
}

describe('overdue ACTIVE loan read slice', () => {
  it('selects only first positive plan row ordered by date, sequence, id, and keeps that row amount (not plan sum)', async () => {
    const loan = fact(1);
    loan.fullName = 'Ana Maria'; loan.loanNumber = '9007199254740993'; loan.identification = 'A-1';
    loan.plan = [
      { id: id(300), dueDate: '2025-01-01', sequence: 1, pendingAmount: '0.00' },
      { id: id(303), dueDate: '2026-01-01', sequence: 3, pendingAmount: '10.00' },
      { id: id(302), dueDate: '2026-01-01', sequence: 2, pendingAmount: '10.00' },
      { id: id(301), dueDate: '2026-01-01', sequence: 2, pendingAmount: '30.00' },
      { id: id(304), dueDate: '2026-12-01', sequence: 4, pendingAmount: '50.00' },
    ];
    loan.payments.push({ status: 'ANNULLED', amount: '70.00', principalApplied: '60.00', interestApplied: '10.00' });
    const { list, manager, ds } = harness([loan]);
    expect(await list()).toEqual({ items: [{ loanId: id(1), loanNumber: loan.loanNumber,
      customer: { id: loan.customerId, identification: 'A-1', fullName: 'Ana Maria' }, startDate: loan.startDate,
      firstOverdueDueDate: '2026-01-01', firstOverdueAmount: '30.00', principal: '100.00', interestAmount: '20.00',
      totalAmount: '120.00', recoveredAmount: '20.00', financialBalance: '100.00', status: 'ACTIVE', canMarkUncollectible: true }],
      total: 1, page: 1, pageSize: 10,
      summary: { total: 1, lentAmount: '100.00', recoveredAmount: '20.00', pendingAmount: '100.00' } });
    expect(ds.transaction).toHaveBeenCalledTimes(1);
    expect(manager.query).toHaveBeenCalledTimes(4);
    expect(manager.query.mock.calls[0][1]).toEqual(['2026-02-01']);
    for (const [, params] of manager.query.mock.calls.slice(1)) expect(params).toEqual([[id(1)]]);
    expect(manager.query.mock.calls[0][0]).toContain('first.due_date::text AS "firstOverdueDueDate"');
    expect(manager.query.mock.calls[0][0]).toContain('first.pending_amount::text AS "firstOverdueAmount"');
  });

  it('runs one snapshot and four SELECTs for all candidates, filters invalid finance before paging, logs count once without PII', async () => {
    const facts = Array.from({ length: 30 }, (_, index) => fact(index + 1));
    const invalid = fact(31); invalid.plan[0].pendingAmount = '99.00';
    const cancelled = fact(32); cancelled.status = 'CANCELLED';
    const today = fact(33); today.plan[0].dueDate = '2026-02-01';
    const historicalZero = fact(34); historicalZero.plan = [
      { id: id(340), sequence: 1, dueDate: '2025-01-01', pendingAmount: '0.00' },
      { id: id(341), sequence: 2, dueDate: '2026-12-01', pendingAmount: '100.00' }];
    const { list, manager, warn } = harness([...facts, invalid, cancelled, today, historicalZero]);
    const page = await list({ page: 2, pageSize: 10 });
    expect(page).toMatchObject({ total: 30, page: 2, pageSize: 10,
      summary: { total: 30, lentAmount: '3000.00', recoveredAmount: '600.00', pendingAmount: '3000.00' } });
    expect(page.items).toHaveLength(10);
    expect(page.items[0].loanNumber).toBe('11');
    expect(manager.query).toHaveBeenCalledTimes(4);
    expect(manager.query.mock.calls.slice(1).every(([, params]) => (params[0] as string[]).length === 31)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(1);
    const out = await list({ page: 5 });
    expect(out.items).toEqual([]);
    expect(out.summary).toEqual(page.summary);
    expect(out.total).toBe(30);
  });

  it('evaluates today once and returns zero summary for an empty ACTIVE candidate set without extra batch queries', async () => {
    const { manager, reader, warn } = harness([]);
    const clock = jest.fn().mockReturnValueOnce('2026-02-01').mockReturnValue('2026-02-02');
    const result = await new ListOverdueLoansUseCase(reader, clock, warn).execute(query);
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 10,
      summary: { total: 0, lentAmount: '0.00', recoveredAmount: '0.00', pendingAmount: '0.00' } });
    expect(clock).toHaveBeenCalledTimes(1);
    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(manager.query.mock.calls[0][1]).toEqual(['2026-02-01']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('filters number, identification, composed name and both phones; date bounds independently and inclusively target FIRST positive due date', async () => {
    const ana = fact(1); ana.fullName = 'Ana Maria Soto'; ana.identification = 'SPECIAL-1';
    const ben = fact(2); ben.firstOverdueDueDate = ben.plan[0].dueDate = '2026-01-02';
    const { list, manager } = harness([ana, ben]);
    for (const search of ['1', 'special-1', 'ana maria', '8888-1', '7777-1']) {
      expect((await list({ search: `  ${search}  ` })).total).toBe(1);
      expect(manager.query.mock.calls.at(-4)?.[1]).toEqual(['2026-02-01', `%${search}%`]);
    }
    expect((await list({ startDate: '2026-01-02' })).items.map((row) => row.loanId)).toEqual([id(2)]);
    expect((await list({ endDate: '2026-01-01' })).items.map((row) => row.loanId)).toEqual([id(1)]);
    expect((await list({ startDate: '2026-01-01', endDate: '2026-01-01' })).total).toBe(1);
    expect(manager.query.mock.calls.at(-4)?.[1]).toEqual(['2026-02-01', '2026-01-01', '2026-01-01']);
    expect((await list({ startDate: '2026-01-03' })).summary).toEqual({ total: 0, lentAmount: '0.00', recoveredAmount: '0.00', pendingAmount: '0.00' });
    expect(manager.query.mock.calls.slice(-1)[0][0]).toContain('FROM payment_plan_entries');
  });

  it.each(OVERDUE_LOAN_SORTS)('sorts %s both ways using exact numeric/date/case-folded comparisons and numeric number then id ties', async (sortBy) => {
    const candidates = [fact(1), fact(2), fact(3)];
    candidates[0].loanNumber = '10'; candidates[1].loanNumber = candidates[2].loanNumber = '2';
    candidates[0].fullName = 'alice'; candidates[1].fullName = 'ZOE'; candidates[2].fullName = 'zoe';
    candidates[0].startDate = '2026-01-03'; candidates[1].startDate = candidates[2].startDate = '2025-01-01';
    candidates[0].firstOverdueDueDate = '2026-01-03'; candidates[1].firstOverdueDueDate = candidates[2].firstOverdueDueDate = '2026-01-01';
    candidates[0].principal = '90071992547409.91'; candidates[1].principal = candidates[2].principal = '2.00';
    const financial = new Map(candidates.map((row, index) => {
      const paidAmount = ['0.01', '2.00', '2.00'][index];
      const interestAmount = '0.09'; const totalAmount = money(cents(row.principal) + cents(interestAmount));
      const validTotals = { paidAmount, paidPrincipal: paidAmount === '0.01' ? '0.00' : '2.00',
        paidInterest: paidAmount === '0.01' ? '0.01' : '0.00', invalidCount: 0 };
      const pendingPlanAmount = money(cents(totalAmount) - cents(paidAmount));
      const financialSnapshot = { principal: row.principal, interestAmount, totalAmount, validTotals, pendingPlanAmount };
      return [row.loanId, { loanId: row.loanId, financialSnapshot,
        integrityResult: evaluateLoanFinancialIntegrity(financialSnapshot, validTotals, cents(pendingPlanAmount)) }] as const;
    }));
    const snapshot: OverdueSnapshot = { candidates, financial };
    const useCase = new ListOverdueLoansUseCase({ read: jest.fn().mockResolvedValue(snapshot) }, () => '2026-02-01', jest.fn());
    const asc = await useCase.execute({ ...query, sortBy, sortDir: 'asc' });
    const desc = await useCase.execute({ ...query, sortBy, sortDir: 'desc' });
    const first = ['customer', 'recoveredAmount'].includes(sortBy) ? id(1) : id(2);
    expect(asc.items.map((row) => row.loanId)).toEqual(first === id(1) ? [id(1), id(2), id(3)] : [id(2), id(3), id(1)]);
    expect(desc.items.map((row) => row.loanId)).toEqual(first === id(1) ? [id(2), id(3), id(1)] : [id(1), id(2), id(3)]);
  });

  it('keeps bigint cents exact beyond MAX_SAFE_INTEGER for items and complete summary', async () => {
    const huge = fact(1); huge.principal = '90071992547409.91'; huge.interestAmount = '0.09'; huge.totalAmount = '90071992547410.00';
    huge.payments = [{ status: 'VALID', amount: '0.01', principalApplied: '0.00', interestApplied: '0.01' }];
    huge.plan[0].pendingAmount = '90071992547409.99';
    expect(await harness([huge]).list()).toMatchObject({ items: [{ firstOverdueAmount: '90071992547409.99',
      principal: '90071992547409.91', recoveredAmount: '0.01', financialBalance: '90071992547409.99' }],
      summary: { lentAmount: '90071992547409.91', recoveredAmount: '0.01', pendingAmount: '90071992547409.99' } });
  });

  it('orders adjacent loan numbers beyond Number.MAX_SAFE_INTEGER without converting them to numbers', async () => {
    const loans = [fact(1), fact(2), fact(3)];
    loans[0].loanNumber = '9007199254740993';
    loans[1].loanNumber = '9007199254740992';
    loans[2].loanNumber = '9007199254740994';
    const { list } = harness(loans);
    expect((await list({ sortBy: 'loanNumber' })).items.map((row) => row.loanId)).toEqual([id(2), id(1), id(3)]);
    expect((await list({ sortBy: 'loanNumber', sortDir: 'desc' })).items.map((row) => row.loanId)).toEqual([id(3), id(1), id(2)]);
  });

  it('shares the pure decision and precedence with the unchanged individual evaluator for due today, invalid finance and inactive status', async () => {
    const loan = fact(1);
    const first = { id: loan.plan[0].id, dueDate: loan.plan[0].dueDate, pendingAmount: loan.plan[0].pendingAmount };
    const integrity = evaluateLoanFinancialIntegrity(loan, { paidAmount: '20.00', paidPrincipal: '15.00', paidInterest: '5.00', invalidCount: 0 }, 10000n);
    const individual = new EvaluateUncollectibleEligibilityUseCase(new LoanFinancialTotalsTypeormReader(), new UncollectibleEligibilityTypeormReader());
    const executor = { query: jest.fn(async (sql: string) => sql.includes('FROM loans WHERE') ? [{ id: loan.loanId, status: 'ACTIVE', principal: loan.principal,
      interestAmount: loan.interestAmount, totalAmount: loan.totalAmount }] : sql.includes('FROM payments WHERE')
      ? [{ paidAmount: '20.00', paidPrincipal: '15.00', paidInterest: '5.00', invalidCount: 0 }]
        : sql.includes('SUM(pending_amount)') ? [{ pendingAmount: '100.00' }] : [first]) };
    expect(await individual.evaluate(executor as never, loan.loanId, '2026-02-01')).toEqual(
      evaluateUncollectibleEligibilityFromSnapshot(loan.loanId, 'ACTIVE', 10000n, first, integrity, '2026-02-01'));
    expect(evaluateUncollectibleEligibilityFromSnapshot(loan.loanId, 'ACTIVE', 10000n, { ...first, dueDate: '2026-02-01' }, integrity, '2026-02-01').blockingReason).toBe('LOAN_NOT_OVERDUE');
    expect(evaluateUncollectibleEligibilityFromSnapshot(loan.loanId, 'CANCELLED', 10000n, first, integrity, '2026-02-01').blockingReason).toBe('LOAN_NOT_ACTIVE');
    expect(evaluateUncollectibleEligibilityFromSnapshot(loan.loanId, 'ACTIVE', 9900n, first, { ...integrity, valid: false }, '2026-02-01').blockingReason).toBe('FINANCIAL_INTEGRITY_ERROR');
    expect(evaluateUncollectibleEligibilityFromSnapshot(loan.loanId, 'ACTIVE', 0n, null, { ...integrity, financialBalance: 0n }, '2026-02-01').blockingReason).toBe('NO_OUTSTANDING_BALANCE');
  });

  it('validates DTO, calendar, inverted dates, sort and safe bounded pagination without SQL, and preserves failures on corrupted facts', async () => {
    expect(await validate(Object.assign(new OverdueLoansQueryDto(), { page: '0', pageSize: '100', sortBy: 'status', sortDir: 'ASC', startDate: '02/01/2026' }))).toHaveLength(5);
    const { list, manager } = harness();
    for (const invalid of [{ startDate: '2026-02-30' }, { endDate: '2025-02-29' },
      { startDate: '2026-03-02', endDate: '2026-03-01' }, { page: 0 }, { page: Number.MAX_SAFE_INTEGER },
      { pageSize: 100 }, { sortBy: 'l.id' }, { sortDir: 'ASC' }]) {
      await expect(list(invalid)).rejects.toThrow(OverdueLoansValidationError);
    }
    expect(manager.query).not.toHaveBeenCalled();
    await list({ startDate: '2024-02-29', endDate: '2024-02-29' });
    const corrupt = harness();
    const originalQuery = corrupt.manager.query.getMockImplementation()!;
    corrupt.manager.query.mockImplementation(async (sql, params) => sql.includes('FROM payments')
      ? [{ loanId: id(1), paidAmount: 'NaN', paidPrincipal: '0', paidInterest: '0', invalidCount: 0 }]
      : originalQuery(sql, params));
    await expect(corrupt.list()).rejects.toThrow('Invalid loan financial batch payment totals.');
    const missing = new ListOverdueLoansUseCase({ read: async () => ({ candidates: [fact(1)], financial: new Map() }) });
    await expect(missing.execute(query)).rejects.toThrow('Missing overdue loan financial projection.');
    const sqlFailure = { transaction: jest.fn(async (_: string, cb: (m: unknown) => Promise<unknown>) => cb({ query: jest.fn().mockRejectedValue(new Error('SQL unavailable')) })) };
    await expect(new ListOverdueLoansUseCase(new OverdueLoansTypeormReader(sqlFailure as never)).execute(query)).rejects.toThrow('SQL unavailable');
  });

  it('registers the static route ahead of detail, retains other endpoints and ACTIVE list, and uses central loans.view/superadmin guard', async () => {
    const handler = LoanController.prototype.overdueLoans;
    expect(Reflect.getMetadata('path', handler)).toBe('overdue');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['loans.view']);
    const methods = Object.getOwnPropertyNames(LoanController.prototype);
    expect(methods.indexOf('overdueLoans')).toBeLessThan(methods.indexOf('detail'));
    for (const other of ['listLoans', 'cancelledLoans', 'detail']) expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype[other as keyof LoanController])).toEqual(['loans.view']);
    expect(Reflect.getMetadata('path', LoanController.prototype.detail)).toBe(':id');
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, LoanModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find((entry) => entry.provide === ListOverdueLoansUseCase)?.inject).toEqual([OVERDUE_LOANS_READER]);
    const guard = new PermissionGuard(new Reflector());
    const context = (permissions: string[], isSuperAdmin: boolean) => ({ getHandler: () => handler, getClass: () => LoanController,
      switchToHttp: () => ({ getRequest: () => ({ currentUser: { permissions, role: { isSuperAdmin } } }) }) }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(context([], false))).toThrow(ForbiddenException);
    expect(guard.canActivate(context(['loans.view'], false))).toBe(true);
    expect(guard.canActivate(context([], true))).toBe(true);
    const execute = jest.fn().mockRejectedValue(new OverdueLoansValidationError('Bad range'));
    const controller = new LoanController({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, { execute } as never);
    await expect(controller.overdueLoans({ startDate: '2026-03-02', endDate: '2026-03-01' })).rejects.toBeInstanceOf(BadRequestException);
    execute.mockResolvedValueOnce({ items: [] });
    await controller.overdueLoans({});
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
    const db = { query: jest.fn(async (sql: string) => sql.startsWith('SELECT COUNT') ? [{ total: 0 }] : []) };
    await new ListLoansUseCase(db as never).execute({ page: 1, pageSize: 20 });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls.every(([sql]) => sql.includes("l.status = 'ACTIVE'"))).toBe(true);
  });
});
