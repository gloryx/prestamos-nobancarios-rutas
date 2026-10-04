import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { DailyCollectionsUseCase, DailyCollectionsValidationError } from '../src/application/payment/daily-collections.use-case';
import { DailyCollectionsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/daily-collections.reader';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { PaymentModule } from '../src/presentation/payment/payment.module';
import { DAILY_COLLECTIONS_READER } from '../src/application/payment/daily-collections.use-case';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

const date = '2026-10-01';
type Plan = { id: string; loan: string; status: string; due: string; pending: string; sequence: number };
type Payment = { id: string; loan: string; status: string; paid: string; amount: string };
const cents = (amount: string) => BigInt(amount.replace('.', ''));
const money = (total: bigint) => `${total / 100n}.${(total % 100n).toString().padStart(2, '0')}`;
const plans: Plan[] = [
  { id: 'e1', loan: 'a', status: 'ACTIVE', due: date, pending: '100.01', sequence: 1 },
  { id: 'e2', loan: 'a', status: 'ACTIVE', due: date, pending: '200.02', sequence: 2 },
  { id: 'e3', loan: 'b', status: 'ACTIVE', due: date, pending: '30000000000000000.03', sequence: 1 },
  { id: 'other-day', loan: 'c', status: 'ACTIVE', due: '2026-09-30', pending: '99.00', sequence: 1 },
  { id: 'closed', loan: 'c', status: 'ACTIVE', due: date, pending: '0.00', sequence: 2 },
  ...['CANCELLED', 'UNCOLLECTIBLE', 'ANNULLED', 'REFINANCED'].map((status, index) =>
    ({ id: `inactive-${index}`, loan: `inactive-${index}`, status, due: date, pending: '500.00', sequence: 1 })),
];
const payments: Payment[] = [
  { id: 'p1', loan: 'a', status: 'VALID', paid: date, amount: '20.00' },
  { id: 'p2', loan: 'a', status: 'VALID', paid: date, amount: '30.50' },
  { id: 'p3', loan: 'b', status: 'VALID', paid: date, amount: '40.00' },
  { id: 'annulled', loan: 'c', status: 'ANNULLED', paid: date, amount: '1000.00' },
  { id: 'other-day', loan: 'c', status: 'VALID', paid: '2026-09-30', amount: '999.00' },
];

function harness() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    queries.push({ sql, params });
    const selectedDate = params[0];
    if (sql.includes('"dueCount"')) {
      expect(sql).toContain("e.due_date = $1::date AND e.pending_amount > 0 AND l.status = 'ACTIVE'");
      expect(sql).toContain("p.payment_date = $1::date AND p.status = 'VALID'");
      expect(sql).toContain('COUNT(DISTINCT p.loan_id)');
      expect(sql).toContain('numeric(38,2)::text');
      const due = plans.filter((p) => p.due === selectedDate && p.status === 'ACTIVE' && cents(p.pending) > 0n);
      const paid = payments.filter((p) => p.paid === selectedDate && p.status === 'VALID');
      return [{ dueCount: due.length, dueAmount: money(due.reduce((sum, p) => sum + cents(p.pending), 0n)),
        paidLoansCount: new Set(paid.map((p) => p.loan)).size,
        receivedAmount: money(paid.reduce((sum, p) => sum + cents(p.amount), 0n)) }];
    }
    const due = sql.includes('payment_plan_entries e');
    expect(sql).toContain(due
      ? "e.due_date = $1::date AND e.pending_amount > 0 AND l.status = 'ACTIVE'"
      : "p.payment_date = $1::date AND p.status = 'VALID'");
    if (!due) {
      expect(sql).toContain('JOIN payment_methods pm');
      expect(sql).toContain('LEFT JOIN collectors cl');
    }
    if (params.length > 1 && typeof params[1] === 'string') {
      for (const field of ['l.loan_number::text', 'c.identification', 'c.first_name', 'c.primary_phone', 'c.secondary_phone'])
        expect(sql).toContain(field);
      expect(params[1]).toBe('%Ana%');
    }
    const facts = due ? plans.filter((p) => p.due === selectedDate && p.status === 'ACTIVE' && cents(p.pending) > 0n)
      : payments.filter((p) => p.paid === selectedDate && p.status === 'VALID');
    if (sql.includes('COUNT(*)')) return [{ total: facts.length }];
    expect(sql).toContain('LIMIT');
    expect(sql).toContain(due ? 'e.id ASC' : 'p.id ASC');
    const size = Number(params.at(-2)), offset = Number(params.at(-1));
    return facts.slice(offset, offset + size).map((fact) => due
      ? { planEntryId: fact.id, sequence: (fact as Plan).sequence, dueDate: (fact as Plan).due,
        pendingAmount: (fact as Plan).pending, loanId: fact.loan, loanNumber: '42', customerId: 'c',
        identification: '101', fullName: 'Ana López', primaryPhone: '8888' }
      : { paymentId: fact.id, paymentDate: (fact as Payment).paid, amount: (fact as Payment).amount,
        loanId: fact.loan, loanNumber: '42', customerId: 'c', identification: '101', fullName: 'Ana López',
        methodId: 'method', methodName: 'Efectivo', collectorId: fact.id === 'p1' ? 'collector' : null,
        collectorName: fact.id === 'p1' ? 'Bea Solís' : null });
  });
  const source = { query, transaction: jest.fn(async (_isolation: string, run: (manager: { query: typeof query }) => Promise<unknown>) =>
    run({ query })) };
  const useCase = new DailyCollectionsUseCase(new DailyCollectionsTypeormReader(source as unknown as DataSource));
  return { useCase, source, queries };
}

describe('daily collection operational reads', () => {
  it('counts positive ACTIVE obligations by entry and distinct paid loans, summing every VALID payment in exact cents', async () => {
    const { useCase, queries } = harness();
    expect(await useCase.summary(date)).toEqual({ date, dueCount: 3, dueAmount: '30000000000000300.06',
      paidLoansCount: 2, receivedAmount: '90.50' });
    expect(await useCase.summary('2026-10-02')).toEqual({ date: '2026-10-02', dueCount: 0,
      dueAmount: '0.00', paidLoansCount: 0, receivedAmount: '0.00' });
    expect(queries).toHaveLength(2);
  });

  it('returns one row per current due entry, even two entries of one loan, with stable sorted server paging', async () => {
    const { useCase, source, queries } = harness();
    const first = await useCase.due({ date, page: 1, pageSize: 2, search: ' Ana ', sortBy: 'pendingAmount', sortDir: 'desc' });
    expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2,
      items: [{ planEntryId: 'e1', pendingAmount: '100.01', loan: { id: 'a', loanNumber: '42' },
        customer: { identification: '101', primaryPhone: '8888' } }, { planEntryId: 'e2' }] });
    expect(queries[1].sql).toContain('ORDER BY e.pending_amount DESC');
    expect(queries[1].params).toEqual([date, '%Ana%', 2, 0]);
    expect((await useCase.due({ date, page: 2, pageSize: 2 })).items.map((p) => p.planEntryId)).toEqual(['e3']);
    expect(queries.at(-1)?.sql).toContain('ORDER BY lower(concat_ws');
    expect(source.transaction).toHaveBeenCalledTimes(2);
    expect(queries).toHaveLength(4);
  });

  it('returns each VALID payment with joined method and optional collector, without ANNULLED payments', async () => {
    const { useCase, queries } = harness();
    const page = await useCase.received({ date, page: 2, pageSize: 2, sortBy: 'amount', sortDir: 'desc' });
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2,
      items: [{ paymentId: 'p3', paymentDate: date, amount: '40.00', paymentMethod: { name: 'Efectivo' }, collector: null }] });
    expect(queries[1].sql).toContain('ORDER BY p.amount DESC, p.id ASC');
    expect(queries[1].params).toEqual([date, 2, 2]);
    expect((await useCase.received({ date, search: 'Ana' })).items[0].collector).toEqual({ id: 'collector', name: 'Bea Solís' });
  });

  it('rejects invalid calendar dates and filters before querying', async () => {
    const { useCase, queries } = harness();
    for (const bad of ['', '2026-02-29', '2026-13-01', '2026-10-01T00:00:00Z'])
      await expect(useCase.summary(bad)).rejects.toBeInstanceOf(DailyCollectionsValidationError);
    for (const filters of [{ date: '2025-02-29' }, { date, page: 0 }, { date, pageSize: 101 },
      { date, sortBy: 'p.amount;DROP TABLE payments' }, { date, sortDir: 'sideways' }])
      expect(() => useCase.due(filters)).toThrow(DailyCollectionsValidationError);
    expect(queries).toHaveLength(0);
    expect((await useCase.summary('2024-02-29')).date).toBe('2024-02-29');
  });

  it('registers read-only GETs with payments.view and keeps existing Payments endpoints', async () => {
    const { useCase } = harness();
    const controller = new PaymentController({} as never, {} as never, {} as never, useCase);
    for (const [method, path] of [['dailySummary', 'daily-collections/summary'],
      ['dailyDue', 'daily-collections/due'], ['dailyReceived', 'daily-collections/received']] as const) {
      const fn = PaymentController.prototype[method];
      expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(RequestMethod.GET);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toEqual(['payments.view']);
    }
    expect(Reflect.getMetadata(PATH_METADATA, PaymentController.prototype.create)).toBe('/');
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PaymentModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find((entry) => entry.provide === DailyCollectionsUseCase)?.inject).toEqual([DAILY_COLLECTIONS_READER]);
    expect(await controller.dailySummary({ date })).toMatchObject({ dueCount: 3 });
    await expect(controller.dailyReceived({ date: '2026-02-29' })).rejects.toMatchObject({ status: 400 });
  });
});
