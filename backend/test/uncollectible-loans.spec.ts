import 'reflect-metadata';
import { BadRequestException, ForbiddenException, InternalServerErrorException, type ExecutionContext } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import { cents } from '../src/domain/loan/loan-financial-integrity';
import { ListUncollectibleLoansUseCase, UNCOLLECTIBLE_LOAN_SORTS, UNCOLLECTIBLE_LOANS_READER,
  UncollectibleLoansIntegrityError, UncollectibleLoansValidationError } from '../src/application/loan/uncollectible-loans.use-case';
import { LoanFinancialBatchTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-batch.reader';
import { UncollectibleLoansTypeormReader } from '../src/infrastructure/database/typeorm/repositories/uncollectible-loans.reader';
import { LoanController } from '../src/presentation/loan/loan.controller';
import { UncollectibleLoansQueryDto } from '../src/presentation/loan/loan.dto';
import { LoanModule } from '../src/presentation/loan/loan.module';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
type Event = { sequence: number; kind: 'CREATED' | 'TRANSITION'; from: string | null; to: string; at: string;
  reason: string | null; actor: string | null; id: string };
type Fact = { loanId: string; loanNumber: string; status: string; customerId: string; identification: string; fullName: string;
  primaryPhone: string; secondaryPhone: string; startDate: string; principal: string; interestAmount: string; totalAmount: string;
  plan: string; payments: Array<{ status: string; amount: string; principalApplied: string; interestApplied: string }>; events: Event[] };
const event = (sequence: number, from: string | null, to: string, at: string, reason: string | null = 'Declaration', actor: string | null = id(999)): Event =>
  ({ sequence, kind: from === null ? 'CREATED' : 'TRANSITION', from, to, at, reason, actor, id: id(1000 + sequence) });
const fact = (n: number): Fact => ({ loanId: id(n), loanNumber: String(n), status: 'UNCOLLECTIBLE', customerId: id(n + 100),
  identification: `DOC-${n}`, fullName: `Customer ${n}`, primaryPhone: `8888-${n}`, secondaryPhone: `7777-${n}`,
  startDate: '2025-12-01', principal: '100.00', interestAmount: '20.00', totalAmount: '120.00', plan: '100.00',
  payments: [{ status: 'VALID', amount: '20.00', principalApplied: '15.00', interestApplied: '5.00' }],
  events: [event(1, null, 'ACTIVE', '2025-12-01T12:00:00.000000Z', null),
    event(2, 'ACTIVE', 'UNCOLLECTIBLE', '2026-01-02T05:59:59.123456Z')] });
const query = { page: 1, pageSize: 10 };
const businessDate = (at: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(at));
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

// Simulate the candidate SELECT and the existing real three-SELECT batch adapter without a database.
function harness(facts: Fact[] = [fact(1)]) {
  const manager = { query: jest.fn(async (sql: string, parameters: unknown[]): Promise<unknown[]> => {
    if (!/^SELECT\b/.test(sql) || /\b(?:UPDATE|INSERT|DELETE|FOR UPDATE)\b/i.test(sql)) throw new Error('Not a read-only SELECT.');
    if (sql.includes('LEFT JOIN LATERAL')) {
      if (!sql.includes("l.status = 'UNCOLLECTIBLE'") || !sql.includes('JOIN customers c ON c.id = l.customer_id') ||
        !sql.includes("h.event_kind = 'TRANSITION'") || !sql.includes('h.loan_id = l.id') ||
        !sql.includes('ORDER BY h.event_sequence DESC LIMIT 1') ||
        !sql.includes("event.changed_at AT TIME ZONE 'UTC'") ||
        !sql.includes('HH24:MI:SS.US"Z"') ||
        !sql.includes("(event.changed_at AT TIME ZONE 'America/Costa_Rica')::date") ||
        sql.includes('event.to_status =') || sql.includes('event.from_status =')) throw new Error('Invalid causal candidate SQL.');
      const search = sql.includes('ILIKE') ? String(parameters[0]).slice(1, -1).toLowerCase() : undefined;
      if (search && ['l.loan_number::text', 'c.identification', 'c.first_name', 'c.middle_name', 'c.first_last_name',
        'c.second_last_name', 'c.primary_phone', 'c.secondary_phone'].some((field) => !sql.includes(field))) throw new Error('Missing search field.');
      return facts.filter((row) => row.status === 'UNCOLLECTIBLE' && (!search ||
        [row.loanNumber, row.identification, row.fullName, row.primaryPhone, row.secondaryPhone]
          .some((field) => field.toLowerCase().includes(search)))).map((row) => {
        const latest = row.events.filter((entry) => entry.kind === 'TRANSITION').sort((a, b) => b.sequence - a.sequence)[0];
        return { loanId: row.loanId, loanNumber: row.loanNumber, customerId: row.customerId, identification: row.identification,
          fullName: row.fullName, startDate: row.startDate, principal: row.principal, interestAmount: row.interestAmount,
          totalAmount: row.totalAmount, eventId: latest?.id ?? null, fromStatus: latest?.from ?? null, toStatus: latest?.to ?? null,
          uncollectibleAt: latest?.at ?? null, uncollectibleBusinessDate: latest ? businessDate(latest.at) : null,
          uncollectibleReason: latest?.reason ?? null, changedByUserId: latest?.actor ?? null };
      });
    }
    if (!sql.includes('= ANY($1::uuid[])') || !Array.isArray(parameters[0])) throw new Error('Unbounded batch query.');
    const selected = facts.filter((row) => (parameters[0] as string[]).includes(row.loanId));
    if (sql.includes('FROM loans')) return selected.map((row) => ({ id: row.loanId, principal: row.principal,
      interestAmount: row.interestAmount, totalAmount: row.totalAmount }));
    if (sql.includes('FROM payments')) {
      if (!sql.includes("status = 'VALID'") || !sql.includes('GROUP BY loan_id') || !sql.includes('COUNT(*) FILTER')) throw new Error('Invalid payment batch.');
      return selected.flatMap((row) => {
        const valid = row.payments.filter((payment) => payment.status === 'VALID');
        const sum = (key: 'amount' | 'principalApplied' | 'interestApplied') => money(valid.reduce((total, payment) => total + cents(payment[key]), 0n));
        return valid.length ? [{ loanId: row.loanId, paidAmount: sum('amount'), paidPrincipal: sum('principalApplied'),
          paidInterest: sum('interestApplied'), invalidCount: valid.filter((payment) => cents(payment.amount) <= 0n ||
            cents(payment.amount) !== cents(payment.principalApplied) + cents(payment.interestApplied)).length }] : [];
      });
    }
    if (sql.includes('FROM payment_plan_entries')) {
      if (!sql.includes('pending_amount > 0') || !sql.includes('GROUP BY loan_id')) throw new Error('Invalid plan batch.');
      return selected.map((row) => ({ loanId: row.loanId, pendingAmount: row.plan }));
    }
    throw new Error('Unexpected SELECT.');
  }) };
  const ds = { transaction: jest.fn(async (isolation: string, callback: (tx: typeof manager) => Promise<unknown>) => {
    expect(isolation).toBe('REPEATABLE READ'); return callback(manager);
  }) };
  const reader = new UncollectibleLoansTypeormReader(ds as never, new LoanFinancialBatchTypeormReader());
  const useCase = new ListUncollectibleLoansUseCase(reader);
  return { manager, ds, reader, list: (filters: Record<string, unknown> = {}) => useCase.execute({ ...query, ...filters }) };
}

describe('current uncollectible loan read slice', () => {
  it('returns the exact event instant and Costa Rica business date, real null metadata, VALID-only finance and complete totals', async () => {
    const loan = fact(1); loan.fullName = 'Ana Maria'; loan.events[1].reason = null; loan.events[1].actor = null;
    loan.payments.push({ status: 'ANNULLED', amount: '40.00', principalApplied: '30.00', interestApplied: '10.00' });
    const { list, manager, ds } = harness([loan]);
    expect(await list()).toEqual({ items: [{ loanId: id(1), loanNumber: '1', customer: { id: loan.customerId,
      identification: 'DOC-1', fullName: 'Ana Maria' }, startDate: '2025-12-01',
      uncollectibleAt: '2026-01-02T05:59:59.123456Z', uncollectibleBusinessDate: '2026-01-01',
      uncollectibleReason: null, changedByUserId: null, principal: '100.00', interestAmount: '20.00', totalAmount: '120.00',
      recoveredAmount: '20.00', financialBalance: '100.00', status: 'UNCOLLECTIBLE' }], total: 1, page: 1, pageSize: 10,
      summary: { total: 1, lentAmount: '100.00', recoveredAmount: '20.00', pendingAmount: '100.00' } });
    expect(ds.transaction).toHaveBeenCalledTimes(1);
    expect(manager.query).toHaveBeenCalledTimes(4);
    expect(manager.query.mock.calls[0][1]).toEqual([]);
    for (const [, params] of manager.query.mock.calls.slice(1)) expect(params).toEqual([[id(1)]]);
  });

  it('excludes reactivated ACTIVE and chooses sequence 4 re-declaration despite reversed times and event IDs', async () => {
    const reopened = fact(1); reopened.status = 'ACTIVE'; reopened.events.push(event(3, 'UNCOLLECTIBLE', 'ACTIVE', '2026-01-03T12:00:00.000000Z'));
    const declared = fact(2); declared.events.push(event(3, 'UNCOLLECTIBLE', 'ACTIVE', '2026-01-04T12:00:00.000000Z'));
    declared.events.push({ ...event(4, 'ACTIVE', 'UNCOLLECTIBLE', '2026-01-01T06:00:00.000001Z', 'New reason'), id: id(1) });
    declared.events[1].id = id(9999);
    const { list } = harness([reopened, declared]);
    expect(await list()).toMatchObject({ total: 1, items: [{ loanId: id(2), uncollectibleAt: '2026-01-01T06:00:00.000001Z',
      uncollectibleReason: 'New reason', uncollectibleBusinessDate: '2026-01-01' }] });
    declared.events[3].at = declared.events[1].at;
    expect((await list()).items[0]).toMatchObject({ loanId: id(2), uncollectibleAt: declared.events[1].at,
      uncollectibleReason: 'New reason' });
  });

  it.each(['missing', 'reactivated', 'wrong-source'])('rejects %s latest transition before date filtering or finance', async (kind) => {
    const loan = fact(1);
    if (kind === 'missing') loan.events = loan.events.slice(0, 1);
    if (kind === 'reactivated') loan.events.push(event(3, 'UNCOLLECTIBLE', 'ACTIVE', '2026-01-03T12:00:00.000000Z'));
    if (kind === 'wrong-source') loan.events.push(event(3, 'CANCELLED', 'UNCOLLECTIBLE', '2026-01-03T12:00:00.000000Z'));
    const { list, manager } = harness([loan]);
    await expect(list({ startDate: '2027-01-01' })).rejects.toThrow(UncollectibleLoansIntegrityError);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('uses Costa Rica dates under a different process TZ, inclusive and independent date bounds, empty set without batch', async () => {
    const original = process.env.TZ;
    process.env.TZ = 'Pacific/Auckland';
    try {
      const early = fact(1); const late = fact(2); late.events[1].at = '2026-01-02T06:00:00.000000Z';
      const { list, manager } = harness([early, late]);
      expect((await list({ endDate: '2026-01-01' })).items.map((row) => row.loanId)).toEqual([id(1)]);
      expect((await list({ startDate: '2026-01-02' })).items.map((row) => row.loanId)).toEqual([id(2)]);
      expect((await list({ startDate: '2026-01-01', endDate: '2026-01-01' })).total).toBe(1);
      expect(await list({ startDate: '2026-01-03' })).toEqual({ items: [], total: 0, page: 1, pageSize: 10,
        summary: { total: 0, lentAmount: '0.00', recoveredAmount: '0.00', pendingAmount: '0.00' } });
      expect(manager.query).toHaveBeenCalledTimes(13);
    } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
  });

  it('searches all fields before summary, with parameter binding, not just the current page', async () => {
    const a = fact(1); a.fullName = 'Ana Maria Soto'; a.identification = 'SPECIAL-1';
    const b = fact(2); const { list, manager } = harness([a, b]);
    for (const search of ['1', 'special-1', 'ana maria', '8888-1', '7777-1']) {
      expect(await list({ search: `  ${search}  ` })).toMatchObject({ total: 1,
        summary: { total: 1, lentAmount: '100.00', recoveredAmount: '20.00', pendingAmount: '100.00' } });
      expect(manager.query.mock.calls.at(-4)?.[1]).toEqual([`%${search}%`]);
    }
    expect((await list({ search: 'nobody' })).summary.total).toBe(0);
  });

  it('sorts all seven keys both ways with numeric bigint cents and real six-digit UTC instants, stable ties', async () => {
    const rows = [fact(1), fact(2), fact(3)];
    const names = ['alice', 'ZOE', 'bob'];
    rows.forEach((row, index) => {
      row.loanNumber = ['10', '2', '9007199254740993'][index]; row.fullName = names[index];
      row.startDate = `2025-01-0${index + 1}`;
      row.events[1].at = `2026-01-02T10:00:00.00000${index + 1}Z`;
      row.principal = ['100.00', '200.00', '90071992547409.91'][index];
      row.totalAmount = money(cents(row.principal) + 2000n);
      const paid = BigInt((index + 1) * 20) * 100n;
      row.payments = [{ status: 'VALID', amount: money(paid), principalApplied: money(paid - 500n), interestApplied: '5.00' }];
      row.plan = money(cents(row.totalAmount) - paid);
    });
    const { list } = harness(rows);
    for (const sortBy of UNCOLLECTIBLE_LOAN_SORTS) {
      const asc = (await list({ sortBy, sortDir: 'asc' })).items.map((row) => row.loanId);
      const desc = (await list({ sortBy, sortDir: 'desc' })).items.map((row) => row.loanId);
      const order = sortBy === 'loanNumber' ? [id(2), id(1), id(3)] : sortBy === 'customer' ? [id(1), id(3), id(2)] :
        [id(1), id(2), id(3)];
      expect(asc).toEqual(order);
      expect(desc).toEqual([...order].reverse());
    }
    expect((await list()).items.map((row) => row.loanId)).toEqual([id(3), id(2), id(1)]);
    expect((await list()).summary.lentAmount).toBe('90071992547709.91');
    rows[2].loanNumber = rows[1].loanNumber;
    rows[2].events[1].at = rows[1].events[1].at;
    expect((await list()).items.map((row) => row.loanId)).toEqual([id(2), id(3), id(1)]);
  });

  it('pages thirty rows after finance, returning full summary on and past the last page with four SELECTs', async () => {
    const { list, manager } = harness(Array.from({ length: 30 }, (_, index) => fact(index + 1)));
    const second = await list({ page: 2 });
    expect(second).toMatchObject({ total: 30, page: 2, pageSize: 10,
      summary: { total: 30, lentAmount: '3000.00', recoveredAmount: '600.00', pendingAmount: '3000.00' } });
    expect(second.items).toHaveLength(10);
    expect(second.items[0].loanNumber).toBe('11');
    expect(manager.query).toHaveBeenCalledTimes(4);
    expect(manager.query.mock.calls.slice(1).every(([, params]) => (params[0] as string[]).length === 30)).toBe(true);
    const out = await list({ page: 5 });
    expect(out.items).toEqual([]); expect(out.total).toBe(30); expect(out.summary).toEqual(second.summary);
  });

  it('fails the whole request for invalid or missing canonical finance instead of fabricating balances', async () => {
    const invalid = fact(2); invalid.plan = '99.00';
    await expect(harness([fact(1), invalid]).list()).rejects.toThrow(UncollectibleLoansIntegrityError);
    const { reader } = harness();
    const missing = new ListUncollectibleLoansUseCase({ read: async (q) => ({ ...await reader.read(q), financial: new Map() }) });
    await expect(missing.execute(query)).rejects.toThrow(/Missing or invalid financial integrity for loan/);
  });

  it('validates date, bounds and DTO before querying and exposes central loans.view/superadmin only on the static route', async () => {
    expect(await validate(Object.assign(new UncollectibleLoansQueryDto(), { page: '0', pageSize: '100', sortBy: 'status', sortDir: 'ASC', startDate: '02/01/2026' }))).toHaveLength(5);
    const { list, manager } = harness();
    for (const invalid of [{ startDate: '2026-02-30' }, { endDate: '2025-02-29' },
      { startDate: '2026-03-02', endDate: '2026-03-01' }, { page: 0 }, { page: Number.MAX_SAFE_INTEGER },
      { pageSize: 100 }, { sortBy: 'l.id' }, { sortDir: 'ASC' }]) await expect(list(invalid)).rejects.toThrow(UncollectibleLoansValidationError);
    expect(manager.query).not.toHaveBeenCalled();
    const handler = LoanController.prototype.uncollectibleLoans;
    expect(Reflect.getMetadata('path', handler)).toBe('uncollectible');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['loans.view']);
    expect(Object.getOwnPropertyNames(LoanController.prototype).indexOf('uncollectibleLoans'))
      .toBeLessThan(Object.getOwnPropertyNames(LoanController.prototype).indexOf('detail'));
    for (const other of ['listLoans', 'cancelledLoans', 'overdueLoans', 'detail'])
      expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype[other as keyof LoanController])).toEqual(['loans.view']);
    for (const other of ['markAsUncollectible', 'reactivate'])
      expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype[other as keyof LoanController])).toEqual([other === 'reactivate' ? 'loans.status.reactivate' : 'loans.status.uncollectible']);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, LoanModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find((entry) => entry.provide === ListUncollectibleLoansUseCase)?.inject).toEqual([UNCOLLECTIBLE_LOANS_READER]);
    const guard = new PermissionGuard(new Reflector());
    const context = (permissions: string[], isSuperAdmin: boolean) => ({ getHandler: () => handler, getClass: () => LoanController,
      switchToHttp: () => ({ getRequest: () => ({ currentUser: { permissions, role: { isSuperAdmin } } }) }) }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(context([], false))).toThrow(ForbiddenException);
    expect(guard.canActivate(context(['loans.view'], false))).toBe(true);
    expect(guard.canActivate(context([], true))).toBe(true);
    const execute = jest.fn().mockRejectedValueOnce(new UncollectibleLoansValidationError('Invalid date'))
      .mockRejectedValueOnce(new UncollectibleLoansIntegrityError('Loan integrity failed')).mockResolvedValueOnce({ items: [] });
    const controller = new LoanController({} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, { execute } as never);
    await expect(controller.uncollectibleLoans({})).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.uncollectibleLoans({})).rejects.toBeInstanceOf(InternalServerErrorException);
    await controller.uncollectibleLoans({});
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
  });
});
