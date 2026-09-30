import 'reflect-metadata';
import { BadRequestException, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import { ListCancelledLoansUseCase, CancelledLoansValidationError, CANCELLED_LOAN_SORTS } from '../src/application/loan/cancelled-loans.use-case';
import { ListLoansUseCase } from '../src/application/loan/loan.use-case';
import { CancelledLoansTypeormReader } from '../src/infrastructure/database/typeorm/repositories/cancelled-loans.reader';
import { LoanController } from '../src/presentation/loan/loan.controller';
import { CancelledLoansQueryDto } from '../src/presentation/loan/loan.dto';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

const query = { page: 1, pageSize: 10 };
const empty = { items: [], total: 0, cancelledLoansCount: 0, recoveredAmount: '0.00', realizedProfit: '0.00' };
const harness = (response: { items: unknown[]; total: number; cancelledLoansCount: number; recoveredAmount: string; realizedProfit: string } = empty) => {
  const db = { query: jest.fn().mockResolvedValue([response]) };
  return { db, reader: new CancelledLoansTypeormReader(db as never) };
};

describe('cancelled loan read boundary', () => {
  it('uses one parameterized statement for VALID-only per-loan money, operational MAX date, and all filtered totals before paging', async () => {
    const { db, reader } = harness();
    await reader.list({ ...query, search: 'Ana %', startDate: '2026-02-01', endDate: '2026-02-28' });
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("p.status = 'VALID' GROUP BY p.loan_id");
    expect(sql).toContain('MAX(p.payment_date) AS "cancelledDate"');
    expect(sql).toContain('SUM(p.amount) AS "totalRecovered"');
    expect(sql).toContain('SUM(p.interest_applied) AS "recoveredInterest"');
    expect(sql).not.toMatch(/p\.created_at|SUM\(l\.(principal|interest_amount|total_amount)\)|numeric\(18,2\)/);
    expect(sql).toContain("l.status = 'CANCELLED'");
    expect(sql).not.toMatch(/l\.status\s+(?:IN|=)\s*\(?\s*'(?:ACTIVE|REFINANCED|UNCOLLECTIBLE|ANNULLED)'/);
    expect(sql).toContain('LEFT JOIN payment_totals pa ON pa.loan_id = l.id');
    expect(sql).not.toMatch(/JOIN payments p ON p\.loan_id = l\.id/);
    expect(sql).toContain('COUNT(DISTINCT id)::int');
    expect(sql).toContain('COALESCE(SUM("totalRecovered"), 0.00)::text');
    expect(sql).toContain('COALESCE(SUM("recoveredInterest"), 0.00)::text');
    expect(sql).toContain('pa."cancelledDate" >= $2::date');
    expect(sql).toContain('pa."cancelledDate" <= $3::date');
    for (const field of ['l.loan_number::text', 'c.identification', 'c.primary_phone', 'c.secondary_phone', 'c.first_name', 'ca.exact_address']) expect(sql).toContain(field);
    expect(sql.indexOf('), totals AS (')).toBeLessThan(sql.indexOf('), page_rows AS ('));
    expect(sql).toContain('ORDER BY f."cancelledDate" DESC NULLS LAST, f."loanNumber" DESC, f.id ASC LIMIT $4 OFFSET $5');
    expect(params).toEqual(['%Ana %%', '2026-02-01', '2026-02-28', 10, 0]);
  });

  it('applies open-ended and same-day inclusive cancellation bounds to the same filtered rows and cards', async () => {
    const { db, reader } = harness();
    await reader.list({ ...query, startDate: '2026-02-12', endDate: '2026-02-12', search: '  Ana  ' });
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['%  Ana  %', '2026-02-12', '2026-02-12', 10, 0]);
    expect(sql).toContain('MAX(p.payment_date)');
    expect(sql).toContain('pa."cancelledDate" >= $2::date');
    expect(sql).toContain('pa."cancelledDate" <= $3::date');
    expect(sql).toMatch(/WHERE l\.status = 'CANCELLED'[\s\S]*?\), totals AS \([\s\S]*?FROM filtered[\s\S]*?\), page_rows AS \([\s\S]*?FROM filtered f/);
    await reader.list({ ...query, endDate: '2026-02-12' });
    expect(db.query.mock.calls[1][1]).toEqual(['2026-02-12', 10, 0]);
    expect(db.query.mock.calls[1][0]).not.toContain('pa."cancelledDate" >=');
    await reader.list({ ...query, startDate: '2026-02-12' });
    expect(db.query.mock.calls[2][1]).toEqual(['2026-02-12', 10, 0]);
    expect(db.query.mock.calls[2][0]).not.toContain('pa."cancelledDate" <=');
  });

  it.each(CANCELLED_LOAN_SORTS)('allowlists numeric/date/name/number sort %s in both directions with stable tie-breaks', async (sortBy) => {
    const { db, reader } = harness();
    for (const sortDirection of ['asc', 'desc'] as const) await reader.list({ ...query, sortBy, sortDirection });
    const expected: Record<typeof sortBy, string> = { loanNumber: 'f."loanNumber"', customer: 'LOWER(f."customerName")', startDate: 'f."startDate"',
      cancelledDate: 'f."cancelledDate"', principal: 'f.principal', recoveredInterest: 'f."recoveredInterest"', totalRecovered: 'f."totalRecovered"' };
    for (const [index, direction] of ['ASC', 'DESC'].entries()) {
      const [sql] = db.query.mock.calls[index] as [string];
      expect(sql).toContain(`ORDER BY ${expected[sortBy]} ${direction} NULLS LAST, f."loanNumber" DESC, f.id ASC LIMIT`);
      expect(sql).not.toContain('::float');
    }
  });

  it('keeps all 30 filtered loans in summary when page 2 has 10 rows, and keeps it on an out-of-range page', async () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ id: `loan-${index}`, loanNumber: `${index + 1}` }));
    const { db, reader } = harness({ items, total: 30, cancelledLoansCount: 30, recoveredAmount: '30000000000000000.25', realizedProfit: '10000000000000000.10' });
    const page = await reader.list({ ...query, page: 2 });
    expect(page.items).toHaveLength(10);
    expect(page).toMatchObject({ total: 30, page: 2, pageSize: 10, summary: { cancelledLoansCount: 30, recoveredAmount: '30000000000000000.25', realizedProfit: '10000000000000000.10' } });
    expect(db.query.mock.calls[0][1]).toEqual([10, 10]);
    db.query.mockResolvedValueOnce([{ items: [], total: 30, cancelledLoansCount: 30, recoveredAmount: '30000000000000000.25', realizedProfit: '10000000000000000.10' }]);
    expect(await reader.list({ ...query, page: 5 })).toMatchObject({ items: [], total: 30, summary: page.summary });
    expect(db.query.mock.calls[1][1]).toEqual([10, 40]);
  });

  it('returns zeros with no rows; preserves legacy null date and zero money without a bound; excludes reopened ACTIVE on refresh', async () => {
    const { db, reader } = harness();
    expect(await reader.list(query)).toMatchObject({ items: [], total: 0, summary: { cancelledLoansCount: 0, recoveredAmount: '0.00', realizedProfit: '0.00' } });
    const legacy = { id: 'loan-1', cancelledDate: null, totalRecovered: '0.00', recoveredInterest: '0.00' };
    db.query.mockResolvedValueOnce([{ items: [legacy], total: 1, cancelledLoansCount: 1, recoveredAmount: '0.00', realizedProfit: '0.00' }]);
    expect((await reader.list(query)).items[0]).toEqual(legacy);
    expect((await reader.list({ ...query, startDate: '2026-01-01' })).items).toEqual([]);
    expect((await reader.list(query)).total).toBe(0);
    expect(db.query.mock.calls.every(([sql]: [string]) => sql.includes("l.status = 'CANCELLED'"))).toBe(true);
  });

  it('validates real calendar days, inverted ranges, and unsafe pagination before any SQL', async () => {
    const { db, reader } = harness();
    const useCase = new ListCancelledLoansUseCase(reader);
    for (const invalid of [ { startDate: '2026-02-30' }, { endDate: '2025-02-29' }, { startDate: '2026-03-02', endDate: '2026-03-01' },
      { page: Number.MAX_SAFE_INTEGER + 1 }, { page: Number.MAX_SAFE_INTEGER }, { pageSize: 101 }, { sortBy: 'l.id; DROP TABLE loans' }, { sortDirection: 'ASC' } ]) {
      expect(() => useCase.execute({ ...query, ...invalid } as never)).toThrow(CancelledLoansValidationError);
    }
    expect(db.query).not.toHaveBeenCalled();
    await useCase.execute({ ...query, startDate: '2024-02-29', endDate: '2024-02-29' });
    await useCase.execute({ ...query, endDate: '2026-03-01' });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid DTO sort and dates; guards static route using loans.view and centralized superadmin bypass', async () => {
    expect(await validate(Object.assign(new CancelledLoansQueryDto(), { sortBy: 'status', sortDirection: 'ASC', startDate: '02/01/2026', page: '0' }))).toHaveLength(4);
    const handler = LoanController.prototype.cancelledLoans;
    expect(Reflect.getMetadata('path', handler)).toBe('cancelled');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['loans.view']);
    const guard = new PermissionGuard(new Reflector());
    const context = (permissions: string[], isSuperAdmin: boolean) => ({ getHandler: () => handler, getClass: () => LoanController,
      switchToHttp: () => ({ getRequest: () => ({ currentUser: { permissions, role: { isSuperAdmin } } }) }) }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(context([], false))).toThrow(ForbiddenException);
    expect(guard.canActivate(context(['loans.view'], false))).toBe(true);
    expect(guard.canActivate(context([], true))).toBe(true);
    const execute = jest.fn().mockRejectedValue(new CancelledLoansValidationError('Invalid date'));
    const controller = new LoanController({} as never, {} as never, {} as never, { execute } as never, {} as never, {} as never);
    await expect(controller.cancelledLoans({ startDate: '2026-02-30' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves the existing ACTIVE loan SQL and count contract unchanged', async () => {
    const db = { query: jest.fn(async (sql: string) => sql.startsWith('SELECT COUNT') ? [{ total: 1 }] : []) };
    await new ListLoansUseCase(db as never).execute({ page: 1, pageSize: 20 });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls.every(([sql]) => sql.includes("l.status = 'ACTIVE'"))).toBe(true);
  });
});
