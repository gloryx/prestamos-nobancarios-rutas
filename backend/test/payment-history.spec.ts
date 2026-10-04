import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { DataSource } from 'typeorm';
import { PAYMENT_HISTORY_READER, PaymentHistoryUseCase, PaymentHistoryValidationError } from '../src/application/payment/payment-history.use-case';
import { PaymentHistoryTypeormReader } from '../src/infrastructure/database/typeorm/repositories/payment-history.reader';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { PaymentModule } from '../src/presentation/payment/payment.module';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

const methodInactive = '11111111-1111-4111-8111-111111111111';
const methodActive = '22222222-2222-4222-8222-222222222222';
const collectorInactive = '33333333-3333-4333-8333-333333333333';
const collectorActive = '44444444-4444-4444-8444-444444444444';
type Fact = { id: string; date: string; amount: string; principal: string; interest: string; status: 'VALID' | 'ANNULLED';
  loan: string; customer: string; secondary: string; method: string; collector: string | null;
  applications: Array<{ sequence: number; amount: string }> };
const facts: Fact[] = [
  { id: 'p1', date: '2026-10-01', amount: '70.00', principal: '50.00', interest: '20.00', status: 'VALID',
    loan: '4548', customer: 'Ana Solís', secondary: '8888', method: methodInactive, collector: collectorInactive,
    applications: [{ sequence: 2, amount: '20.00' }, { sequence: 1, amount: '50.00' },
      { sequence: 2, amount: '1.00' }, { sequence: 3, amount: '0.00' }] },
  { id: 'p2', date: '2026-10-01', amount: '30.00', principal: '25.00', interest: '5.00', status: 'VALID',
    loan: '4548', customer: 'Ana Solís', secondary: '8888', method: methodActive, collector: null, applications: [] },
  { id: 'p3', date: '2026-10-01', amount: '500.00', principal: '400.00', interest: '100.00', status: 'ANNULLED',
    loan: '19', customer: 'Luis Mora', secondary: '7777', method: methodActive, collector: collectorActive,
    applications: [{ sequence: 1, amount: '500.00' }] },
  { id: 'p4', date: '2026-09-30', amount: '13.00', principal: '10.00', interest: '3.00', status: 'VALID',
    loan: '4548', customer: 'Ana Solís', secondary: '8888', method: methodInactive, collector: collectorInactive,
    applications: [{ sequence: 9, amount: '13.00' }] },
];
const cents = (value: string) => BigInt(value.replace('.', ''));
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

function harness() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    queries.push({ sql, params });
    if (sql.includes('FROM payment_methods pm')) {
      expect(sql).toContain('EXISTS (SELECT 1 FROM payments p WHERE p.method_id = pm.id)');
      return [{ id: methodActive, name: 'Efectivo', active: true },
        { id: methodInactive, name: 'Transferencia', active: false }];
    }
    if (sql.includes('FROM collectors cl')) {
      expect(sql).toContain('EXISTS (SELECT 1 FROM payments p WHERE p.collector_id = cl.id)');
      return [{ id: collectorInactive, name: 'Alba Solís', active: false },
        { id: collectorActive, name: 'Zoe Mora', active: true }];
    }
    if (sql.includes('FROM payment_applications pa')) {
      expect(sql).toContain('pa.amount_applied > 0');
      expect(sql).toContain('SELECT DISTINCT');
      expect(sql).toContain('JOIN payment_plan_entries e ON e.id = pa.payment_plan_entry_id');
      return facts.filter((fact) => (params[0] as string[]).includes(fact.id)).flatMap((fact) =>
        [...new Set(fact.applications.filter((application) => cents(application.amount) > 0n).map((application) => application.sequence))]
          .sort((a, b) => a - b).map((sequence) => ({ paymentId: fact.id, sequence })));
    }
    const param = (pattern: RegExp) => { const match = sql.match(pattern); return match ? String(params[Number(match[1]) - 1]) : undefined; };
    const start = param(/p\.payment_date >= \$(\d+)::date/), end = param(/p\.payment_date <= \$(\d+)::date/);
    const search = param(/c\.identification ILIKE \$(\d+)/)?.slice(1, -1).toLowerCase();
    const loan = param(/l\.loan_number::text = \$(\d+)/), status = param(/p\.status = \$(\d+)/);
    const method = param(/p\.method_id = \$(\d+)::uuid/), collector = param(/p\.collector_id = \$(\d+)::uuid/);
    if (search) {
      const placeholders = [...sql.matchAll(/(?:c\.identification|c\.primary_phone|c\.secondary_phone|concat_ws\(.+?\)) ILIKE \$(\d+)/g)];
      expect(placeholders.map((match) => Number(match[1]))).toEqual([Number(sql.match(/c\.identification ILIKE \$(\d+)/)![1]),
        Number(sql.match(/c\.identification ILIKE \$(\d+)/)![1]), Number(sql.match(/c\.identification ILIKE \$(\d+)/)![1]),
        Number(sql.match(/c\.identification ILIKE \$(\d+)/)![1])]);
      expect(sql).not.toContain('?');
    }
    const selected = facts.filter((fact) => (!start || fact.date >= start) && (!end || fact.date <= end) &&
      (!search || fact.customer.toLowerCase().includes(search) || fact.secondary.includes(search) || '101'.includes(search)) &&
      (!loan || fact.loan === loan) && (!status || fact.status === status) && (!method || fact.method === method) &&
      (!collector || fact.collector === collector));
    if (sql.includes('COUNT(*)::int AS total')) {
      expect(sql).toContain("FILTER (WHERE p.status = 'VALID')");
      expect(sql).toContain('numeric(38,2)::text');
      const valid = selected.filter((fact) => fact.status === 'VALID');
      const sum = (key: 'amount' | 'principal' | 'interest') => money(valid.reduce((total, fact) => total + cents(fact[key]), 0n));
      return [{ total: selected.length, validPaymentsCount: valid.length, receivedAmount: sum('amount'),
        principalAppliedAmount: sum('principal'), interestAppliedAmount: sum('interest') }];
    }
    expect(sql).toContain('ORDER BY'); expect(sql).toContain('p.created_at DESC, p.id DESC');
    const size = Number(params.at(-2)), offset = Number(params.at(-1));
    return selected.slice(offset, offset + size).map((fact) => ({ paymentId: fact.id, paymentDate: fact.date,
      amount: fact.amount, principalApplied: fact.principal, interestApplied: fact.interest, status: fact.status,
      loanId: `loan-${fact.loan}`, loanNumber: fact.loan, customerId: `customer-${fact.customer}`,
      identification: '101', fullName: fact.customer, primaryPhone: '6666', methodId: fact.method,
      methodName: fact.method === methodActive ? 'Efectivo' : 'Transferencia', collectorId: fact.collector,
      collectorName: fact.collector === collectorInactive ? 'Alba Solís' : fact.collector ? 'Zoe Mora' : null }));
  });
  const source = { transaction: jest.fn(async (_isolation: string, run: (manager: { query: typeof query }) => Promise<unknown>) =>
    run({ query })) };
  return { useCase: new PaymentHistoryUseCase(new PaymentHistoryTypeormReader(source as unknown as DataSource)), source, queries };
}

describe('payment history reads', () => {
  it('returns one row per Payment, including ANNULLED, and summarizes all VALID rows before paging', async () => {
    const { useCase, source, queries } = harness();
    const first = await useCase.list({ pageSize: 1 });
    expect(first).toMatchObject({ total: 4, page: 1, pageSize: 1, items: [{ paymentId: 'p1',
      installments: [1, 2], loan: { loanNumber: '4548' }, collector: { name: 'Alba Solís' } }],
    summary: { validPaymentsCount: 3, receivedAmount: '113.00', principalAppliedAmount: '85.00',
      interestAppliedAmount: '28.00' } });
    expect((await useCase.list({ page: 2, pageSize: 1 })).items[0]).toMatchObject({ paymentId: 'p2',
      installments: [], collector: null });
    expect((await useCase.list({ page: 3, pageSize: 1 })).items[0]).toMatchObject({ paymentId: 'p3', status: 'ANNULLED' });
    expect(queries[1].sql).toContain('ORDER BY p.payment_date DESC, p.created_at DESC, p.id DESC');
    expect(source.transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    expect(queries).toHaveLength(9);
  });

  it('filters VALID and ANNULLED without adding annulled amounts to the indicators', async () => {
    const { useCase, queries } = harness();
    expect(await useCase.list({ status: 'VALID' })).toMatchObject({ total: 3, summary: { validPaymentsCount: 3,
      receivedAmount: '113.00' } });
    const annulled = await useCase.list({ status: 'ANNULLED' });
    expect(annulled).toMatchObject({ total: 1, items: [{ paymentId: 'p3' }], summary: {
      validPaymentsCount: 0, receivedAmount: '0.00', principalAppliedAmount: '0.00', interestAppliedAmount: '0.00' } });
    expect(queries.some(({ sql }) => sql.includes('p.status = $1'))).toBe(true);
  });

  it('combines inclusive dates, client phone/name, visible loan number, registered method and collector', async () => {
    const { useCase, queries } = harness();
    const page = await useCase.list({ startDate: '2026-10-01', endDate: '2026-10-01', search: ' Ana ',
      loanNumber: '4548', paymentMethodId: methodInactive, collectorId: collectorInactive,
      sortBy: 'amount', sortDir: 'asc', pageSize: 1 });
    expect(page).toMatchObject({ total: 1, items: [{ paymentId: 'p1' }], summary: { receivedAmount: '70.00' } });
    expect(queries[0].params).toEqual(['2026-10-01', '2026-10-01', '%Ana%', '4548', methodInactive, collectorInactive]);
    expect(queries[1].sql).toContain('ORDER BY p.amount ASC, p.created_at DESC, p.id DESC');
    expect((await useCase.list({ search: '8888', startDate: '2026-09-30', endDate: '2026-09-30' })).items[0].paymentId).toBe('p4');
    expect((await useCase.list({ paymentMethodId: methodActive, collectorId: collectorInactive })).total).toBe(0);
  });

  it('offers only used historical methods and collectors, including inactive entries, sorted by name', async () => {
    const { useCase, source } = harness();
    expect(await useCase.options()).toEqual({ paymentMethods: [
      { id: methodActive, name: 'Efectivo', active: true }, { id: methodInactive, name: 'Transferencia', active: false }],
    collectors: [{ id: collectorInactive, name: 'Alba Solís', active: false },
      { id: collectorActive, name: 'Zoe Mora', active: true }] });
    expect(source.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid calendar dates, ranges, input, sorting and paging before hitting persistence', () => {
    const { useCase, queries } = harness();
    for (const input of [{ startDate: '2026-02-29' }, { startDate: '2026-10-02', endDate: '2026-10-01' },
      { status: 'PENDING' }, { loanNumber: 'loan-id' }, { paymentMethodId: 'not-a-uuid' }, { collectorId: '' },
      { page: 0 }, { pageSize: 101 }, { sortBy: 'p.amount;DROP TABLE payments' }, { sortDir: 'down' }])
      expect(() => useCase.list(input)).toThrow(PaymentHistoryValidationError);
    expect(queries).toHaveLength(0);
    expect(() => useCase.list({ startDate: '2024-02-29' })).not.toThrow();
  });

  it('registers GET history and options with payments.view inside the existing Payments module', async () => {
    const { useCase } = harness();
    for (const [method, path] of [['paymentHistory', 'history'], ['historyOptions', 'history/options']] as const) {
      const fn = PaymentController.prototype[method];
      expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(RequestMethod.GET);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toEqual(['payments.view']);
    }
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PaymentModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find((provider) => provider.provide === PaymentHistoryUseCase)?.inject).toEqual([PAYMENT_HISTORY_READER]);
    const controller = new PaymentController({} as never, {} as never, {} as never, undefined, useCase);
    expect(await controller.paymentHistory({ page: '1', pageSize: '1' })).toMatchObject({ total: 4 });
    await expect(controller.paymentHistory({ startDate: '2026-02-29' })).rejects.toMatchObject({ status: 400 });
    expect(await controller.historyOptions()).toHaveProperty('paymentMethods');
    expect(Reflect.getMetadata(PATH_METADATA, PaymentController.prototype.create)).toBe('/');
  });
});
