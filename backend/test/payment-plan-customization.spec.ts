import type { DataSource } from 'typeorm';
import { ValidationPipe } from '@nestjs/common';
import { CustomizePaymentPlanUseCase, PaymentConflictError, PaymentValidationError } from '../src/application/payment/payment.use-case';
import { buildPaymentContext, type PlanBaseline } from '../src/domain/payment/payment-invariants';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { CustomizePaymentPlanDto } from '../src/presentation/payment/payment.dto';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';

const totalsReader = new LoanFinancialTotalsTypeormReader();

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const HISTORY = '33333333-3333-4333-8333-333333333333';
const NEW = '44444444-4444-4444-8444-444444444444';
const FOREIGN = '55555555-5555-4555-8555-555555555555';
const UNKNOWN = '66666666-6666-4666-8666-666666666666';
type Row = { id: string; loanId: string; dueDate: string; sequence: number; pendingAmount: string; createdAt: string };
type State = { rows: Row[]; key: string | null; fingerprint: string | null };
type Proposal = { id: string | null; dueDate: string; pendingAmount: string };
const row = (id: string, sequence: number, dueDate: string, pendingAmount: string, loanId = 'loan'): Row => ({ id, loanId, sequence, dueDate, pendingAmount, createdAt: '2026-01-01' });
const initial = (): State => ({ rows: [row(A, 3, '2026-04-01', '400.00'), row(B, 7, '2026-03-02', '500.00'), row(HISTORY, 9, '2026-01-15', '0.00'), row(FOREIGN, 12, '2026-02-02', '1.00', 'other')], key: null, fingerprint: null });
const proposal = (): Proposal[] => [{ id: A, dueDate: '2026-03-02', pendingAmount: '400.00' }, { id: B, dueDate: '2026-04-01', pendingAmount: '500.00' }];
const cents = (amount: string) => BigInt(amount.replace('.', ''));
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const writes = (calls: Array<{ sql: string }>) => calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/.test(sql));
const baseline = (state: State): PlanBaseline => ({ financialBalance: money(state.rows.filter((item) => item.loanId === 'loan' && cents(item.pendingAmount) > 0n).reduce((sum, item) => sum + cents(item.pendingAmount), 0n)), entries: state.rows.filter((item) => item.loanId === 'loan' && cents(item.pendingAmount) > 0n)
  .map(({ id, dueDate, pendingAmount }) => ({ id, dueDate, pendingAmount })) });

function store(options: { postPending?: string; postPaid?: string; failInsert?: boolean; invalidPaid?: boolean; paidAmount?: string; status?: string; zeroUpdate?: 'edit' | 'close'; openingRows?: Row[]; totalAmount?: string } = {}) {
  let state = options.openingRows ? { ...initial(), rows: structuredClone(options.openingRows) } : initial();
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const transaction = jest.fn(async (callback: (manager: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<unknown>) => {
    const draft = structuredClone(state);
    let paidReads = 0;
    const query = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
      calls.push({ sql, params });
      if (sql.includes('FROM loans WHERE id = $1 FOR UPDATE')) return [{ status: options.status ?? 'ACTIVE', startDate: '2026-01-01', principal: options.totalAmount ?? '800.00', interestAmount: options.totalAmount ? '0.00' : '200.00', totalAmount: options.totalAmount ?? '1000.00', idempotencyKey: draft.key, fingerprint: draft.fingerprint }];
      if (sql.includes('FROM payment_plan_entries') && !sql.includes('SUM(pending_amount)')) {
        return draft.rows.filter((item) => item.loanId === params[0] && (!sql.includes('pending_amount > 0') || cents(item.pendingAmount) > 0n))
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence || a.id.localeCompare(b.id)).map((item) => ({ ...item }));
      }
      if (sql.includes('SUM(principal_applied)')) {
        return [{ paidAmount: paidReads++ && options.postPaid ? options.postPaid : options.paidAmount ?? '100.00', paidPrincipal: options.paidAmount ?? '100.00', paidInterest: '0.00', invalidCount: options.invalidPaid ? 1 : 0 }];
      }
      if (sql.startsWith('UPDATE payment_plan_entries SET due_date')) {
        const target = draft.rows.find((item) => item.id === params[2] && item.loanId === params[3] && cents(item.pendingAmount) > 0n);
        if (!target || options.zeroUpdate === 'edit') return [[], 0];
        target.dueDate = params[0] as string; target.pendingAmount = params[1] as string;
        return [[{ id: target.id }], 1];
      }
      if (sql.startsWith('UPDATE payment_plan_entries SET pending_amount = 0')) {
        const target = draft.rows.find((item) => item.id === params[0] && item.loanId === params[1] && cents(item.pendingAmount) > 0n);
        if (!target || options.zeroUpdate === 'close') return [[], 0];
        target.pendingAmount = '0.00'; return [[{ id: target.id }], 1];
      }
      if (sql.startsWith('INSERT INTO payment_plan_entries')) {
        if (options.failInsert) throw new Error('Injected insert failure');
        draft.rows.push(row(draft.rows.some((item) => item.id === NEW) ? UNKNOWN : NEW, params[1] as number, params[2] as string, params[3] as string));
        return [];
      }
      if (sql.includes('SUM(pending_amount)')) return [{ pendingAmount: options.postPending ?? money(draft.rows.filter((item) => item.loanId === params[0] && cents(item.pendingAmount) > 0n).reduce((sum, item) => sum + cents(item.pendingAmount), 0n)) }];
      if (sql.startsWith('UPDATE loans SET payment_plan_idempotency_key')) { draft.key = params[0] as string; draft.fingerprint = params[1] as string; return []; }
      throw new Error(`Unexpected query: ${sql}`);
    };
    const result = await callback({ query });
    state = draft;
    return result;
  });
  return { source: { transaction } as unknown as DataSource, transaction, calls, state: () => state,
    mutate: (change: (draft: State) => void) => { const draft = structuredClone(state); change(draft); state = draft; } };
}
const customize = (testStore: ReturnType<typeof store>, entries: Proposal[], key = 'plan-key', base = baseline(testStore.state())) => new CustomizePaymentPlanUseCase(testStore.source, totalsReader).execute('loan', entries, key, base);

describe('payment plan customization by stable obligation identity', () => {
  it('updates explicitly referenced rows when dates are reordered without renumbering technical sequences', async () => {
    const testStore = store();
    const result = await customize(testStore, proposal());
    expect(result.map((item: Row) => [item.id, item.sequence, item.dueDate])).toEqual([[A, 3, '2026-03-02'], [B, 7, '2026-04-01']]);
    expect(testStore.state().rows.find((item) => item.id === HISTORY)).toEqual(initial().rows[2]);
    expect(testStore.calls.findIndex(({ sql }) => sql.includes('FROM loans WHERE'))).toBeLessThan(testStore.calls.findIndex(({ sql }) => sql.includes('FOR UPDATE') && sql.includes('FROM payment_plan_entries')));
    expect(testStore.calls.find(({ sql }) => sql.includes('FROM loans WHERE id = $1 FOR UPDATE'))?.sql).toContain('start_date::text AS "startDate"');
    expect(testStore.calls.filter(({ sql }) => sql.startsWith('UPDATE payment_plan_entries SET due_date'))).toHaveLength(2);
    expect(writes(testStore.calls).every(({ sql }) => !sql.startsWith('DELETE') && !sql.includes('sequence ='))).toBe(true);
    expect(writes(testStore.calls).some(({ sql }) => sql.startsWith('INSERT INTO loan_status_history'))).toBe(false);
    const context = buildPaymentContext({ summary: {}, balances: {}, combinedPlan: result, validPayments: [], lastValidPayment: null, refinanceEligibility: false, preferredMethod: null });
    expect(context.firstOperationalRow?.id).toBe(A);
  });

  it('maps legacy missing IDs to the exact HTTP 400 response without starting any write', async () => {
    const testStore = store();
    const controller = new PaymentController({} as never, {} as never, new CustomizePaymentPlanUseCase(testStore.source, totalsReader));
    for (const entry of [{ dueDate: '2026-04-01', pendingAmount: '900.00' }, { id: undefined, dueDate: '2026-04-01', pendingAmount: '900.00' }]) {
      await expect(controller.plan('loan', { entries: [entry] as never, base: baseline(testStore.state()), idempotencyKey: 'plan-key' })).rejects.toMatchObject({ status: 400, response: { message: 'El formato del plan está desactualizado. Cada obligación debe indicar su identificador.' } });
    }
    expect(testStore.transaction).not.toHaveBeenCalled();
    expect(writes(testStore.calls)).toEqual([]);
  });

  it.each([
    ['invalid UUID', [{ ...proposal()[0], id: 'not-a-uuid' }, proposal()[1]]],
    ['unknown ID', [{ ...proposal()[0], id: UNKNOWN }, proposal()[1]]],
    ['foreign ID', [{ ...proposal()[0], id: FOREIGN }, proposal()[1]]],
    ['duplicate ID', [{ ...proposal()[0] }, { ...proposal()[1], id: A }]],
    ['historical zero ID', [{ ...proposal()[0], id: HISTORY }, proposal()[1]]],
    ['invalid date', [{ ...proposal()[0], dueDate: '2026-02-30' }, proposal()[1]]],
    ['noncanonical date', [{ ...proposal()[0], dueDate: '2026-2-01' }, proposal()[1]]],
    ['before loan start', [{ ...proposal()[0], dueDate: '2025-12-31' }, proposal()[1]]],
    ['invalid amount', [{ ...proposal()[0], pendingAmount: '0.00' }, proposal()[1]]],
    ['zero new obligation', [{ ...proposal()[0], pendingAmount: '900.00' }, { id: null, dueDate: '2026-05-01', pendingAmount: '0.00' }]],
    ['empty plan', []],
  ])('rejects %s before any plan or loan write', async (_, entries) => {
    const testStore = store();
    await expect(customize(testStore, entries)).rejects.toBeInstanceOf(PaymentValidationError);
    expect(testStore.state()).toEqual(initial());
    expect(writes(testStore.calls)).toEqual([]);
  });

  it('rejects an out-of-balance proposal and invalid VALID payment totals without repairing either', async () => {
    const cases: Array<[ReturnType<typeof store>, Proposal[]]> = [[store(), [{ ...proposal()[0], pendingAmount: '399.99' }, proposal()[1]]], [store({ invalidPaid: true }), proposal()]];
    for (const [testStore, entries] of cases) {
      await expect(customize(testStore, entries)).rejects.toBeInstanceOf(PaymentConflictError);
      expect(writes(testStore.calls)).toEqual([]);
      expect(testStore.state()).toEqual(initial());
    }
  });

  it('allocates consecutive MAX(all loan rows)+1 sequences for new IDs and closes omitted positive rows without deleting history', async () => {
    const testStore = store();
    const result = await customize(testStore, [
      { id: null, dueDate: '2026-04-01', pendingAmount: '250.00' },
      { id: null, dueDate: '2026-05-01', pendingAmount: '250.00' },
      { id: A, dueDate: '2026-06-01', pendingAmount: '400.00' },
    ]);
    expect(result.map((item: Row) => [item.id, item.sequence, item.pendingAmount])).toEqual([[NEW, 10, '250.00'], [UNKNOWN, 11, '250.00'], [A, 3, '400.00']]);
    expect(testStore.state().rows.find((item) => item.id === B)).toEqual({ ...initial().rows[1], pendingAmount: '0.00' });
    expect(testStore.state().rows.find((item) => item.id === HISTORY)).toEqual(initial().rows[2]);
    expect(testStore.calls.find(({ sql }) => sql.includes('FOR UPDATE') && sql.includes('FROM payment_plan_entries'))?.sql).not.toContain('pending_amount > 0');
    expect(testStore.calls.filter(({ sql }) => sql.startsWith('INSERT INTO payment_plan_entries')).map(({ params }) => params[1])).toEqual([10, 11]);
    expect(testStore.calls.filter(({ sql }) => sql.startsWith('UPDATE payment_plan_entries SET pending_amount = 0')).map(({ params }) => params)).toEqual([[B, 'loan']]);
    expect(testStore.calls.filter(({ sql }) => sql.includes('SUM(pending_amount)'))).toHaveLength(1);
    expect(testStore.calls.filter(({ sql }) => sql.includes('SUM(principal_applied)'))).toHaveLength(2);
    expect(writes(testStore.calls).every(({ sql }) => !sql.startsWith('DELETE'))).toBe(true);
  });

  it.each([{ postPending: '899.99' }, { postPaid: '101.00' }, { failInsert: true }])('rolls back all updates on final mismatch or injected post-update failure: %o', async (options) => {
    const testStore = store(options);
    const entries: Proposal[] = [{ id: A, dueDate: '2026-04-01', pendingAmount: '400.00' }, { id: null, dueDate: '2026-05-01', pendingAmount: '500.00' }];
    await expect(customize(testStore, entries)).rejects.toBeInstanceOf(options.failInsert ? Error : PaymentConflictError);
    expect(testStore.calls.some(({ sql }) => sql.startsWith('UPDATE payment_plan_entries SET due_date'))).toBe(true);
    expect(testStore.state()).toEqual(initial());
    expect(testStore.calls.some(({ sql }) => sql.startsWith('UPDATE loans SET payment_plan_idempotency_key'))).toBe(false);
  });

  it('replays the same IDs and nulls without new writes and rejects reuse with a changed fingerprint', async () => {
    const testStore = store();
    const base = baseline(testStore.state());
    const entries: Proposal[] = [{ id: A, dueDate: '2026-04-01', pendingAmount: '400.00' }, { id: null, dueDate: '2026-05-01', pendingAmount: '500.00' }];
    const first = await customize(testStore, entries, 'plan-key', base);
    const count = writes(testStore.calls).length;
    expect(await customize(testStore, entries, 'plan-key', base)).toEqual(first);
    expect(writes(testStore.calls)).toHaveLength(count);
    await expect(customize(testStore, [{ ...entries[0], dueDate: '2026-04-02' }, entries[1]], 'plan-key', base)).rejects.toBeInstanceOf(PaymentConflictError);
    await expect(customize(testStore, [{ ...entries[0], id: null }, entries[1]], 'plan-key', base)).rejects.toBeInstanceOf(PaymentConflictError);
    await expect(customize(testStore, entries, 'plan-key', { ...base, financialBalance: '900' })).rejects.toBeInstanceOf(PaymentConflictError);
    expect(writes(testStore.calls)).toHaveLength(count);
  });

  it.each([
    ['split September', [{ id: A, dueDate: '2026-09-18', pendingAmount: '25000.00' }, { id: null, dueDate: '2026-09-30', pendingAmount: '25000.00' }]],
    ['move to November', [{ id: A, dueDate: '2026-11-30', pendingAmount: '50000.00' }]],
    ['extend October into November', [{ id: A, dueDate: '2026-10-15', pendingAmount: '25000.00' }, { id: null, dueDate: '2026-11-30', pendingAmount: '25000.00' }]],
    ['move beyond the current schedule', [{ id: A, dueDate: '2028-11-30', pendingAmount: '50000.00' }]],
  ] satisfies Array<[string, Proposal[]]>)('saves the 50k %s plan without a maximum or frequency constraint', async (_, entries) => {
    const testStore = store({ openingRows: [row(A, 1, '2026-09-30', '50000.00')], totalAmount: '50000.00', paidAmount: '0.00' });
    const result = await customize(testStore, entries);
    expect(result.reduce((sum: bigint, item: Row) => sum + cents(item.pendingAmount), 0n)).toBe(5000000n);
    expect(result.find((item: Row) => item.id === A)?.dueDate).toBe(entries[0].dueDate);
    expect(testStore.state().key).toBe('plan-key');
  });

  it('closes an omitted positive row after redistributing its amount', async () => {
    const testStore = store();
    expect(await customize(testStore, [{ id: A, dueDate: '2026-11-30', pendingAmount: '900.00' }])).toMatchObject([{ id: A, pendingAmount: '900.00' }]);
    expect(testStore.state().rows.find((item) => item.id === B)?.pendingAmount).toBe('0.00');
  });

  it('customizes the positive receiver after a carried payment without reviving its closed source', async () => {
    const testStore = store({ openingRows: [row(A, 1, '2026-02-02', '0.00'), row(B, 2, '2026-03-02', '100000.00'), row(HISTORY, 3, '2026-04-01', '60000.00')], totalAmount: '180000.00', paidAmount: '20000.00' });
    const result = await customize(testStore, [{ id: B, dueDate: '2026-11-30', pendingAmount: '90000.00' }, { id: HISTORY, dueDate: '2027-02-01', pendingAmount: '70000.00' }]);
    expect(result.map((item: Row) => [item.id, item.sequence, item.pendingAmount])).toEqual([[B, 2, '90000.00'], [HISTORY, 3, '70000.00']]);
    expect(testStore.state().rows.find((item) => item.id === A)).toEqual(row(A, 1, '2026-02-02', '0.00'));
    expect(writes(testStore.calls).every(({ sql }) => !sql.startsWith('INSERT') && !sql.startsWith('DELETE'))).toBe(true);
  });

  it.each([
    ['missing', undefined], ['null', null], ['empty', {}], ['numeric balance', { financialBalance: 900, entries: [] }], ['null row', { financialBalance: '900.00', entries: [null] }],
    ['invalid ID', { financialBalance: '900.00', entries: [{ id: 'bad', dueDate: '2026-02-02', pendingAmount: '900.00' }] }],
    ['invalid date', { financialBalance: '900.00', entries: [{ id: A, dueDate: '2026-02-30', pendingAmount: '900.00' }] }],
    ['invalid amount', { financialBalance: '900.00', entries: [{ id: A, dueDate: '2026-02-02', pendingAmount: '0.00' }] }],
    ['wrong sum', { financialBalance: '1000.00', entries: [{ id: A, dueDate: '2026-02-02', pendingAmount: '900.00' }] }],
  ])('maps %s baseline to HTTP 400 without a transaction', async (_, base) => {
    const testStore = store();
    const controller = new PaymentController({} as never, {} as never, new CustomizePaymentPlanUseCase(testStore.source, totalsReader));
    await expect(controller.plan('loan', { entries: proposal(), idempotencyKey: 'key', base: base as PlanBaseline })).rejects.toMatchObject({ status: 400 });
    expect(testStore.transaction).not.toHaveBeenCalled();
  });

  it('preserves the opening baseline through the real request whitelist', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const body = { entries: proposal(), base: baseline(initial()), idempotencyKey: 'key' };
    const metadata = { type: 'body' as const, metatype: CustomizePaymentPlanDto };
    expect(await pipe.transform(body, metadata)).toMatchObject(body);
    await expect(pipe.transform({ ...body, base: null }, metadata)).rejects.toMatchObject({ status: 400 });
  });

  it('maps dates before loan start to 400 and stale persisted obligations to 409', async () => {
    const testStore = store(); const base = baseline(testStore.state());
    const controller = new PaymentController({} as never, {} as never, new CustomizePaymentPlanUseCase(testStore.source, totalsReader));
    await expect(controller.plan('loan', { base, entries: [{ ...proposal()[0], dueDate: '2025-12-31' }, proposal()[1]], idempotencyKey: 'key' })).rejects.toMatchObject({ status: 400 });
    testStore.mutate((state) => { state.rows[0].dueDate = '2026-04-02'; });
    await expect(controller.plan('loan', { base, entries: proposal(), idempotencyKey: 'key' })).rejects.toMatchObject({ status: 409 });
    expect(writes(testStore.calls)).toEqual([]);
  });

  it.each([
    [[{ ...proposal()[0], id: FOREIGN }, proposal()[1]], 400, 'The payment plan entry is not an active obligation of this loan.'],
    [[{ ...proposal()[0], id: A }, { ...proposal()[1], id: A }], 400, 'The payment plan entry identifier is invalid or duplicated.'],
    [[{ ...proposal()[0], pendingAmount: '0.00' }, proposal()[1]], 400, 'The payment plan has an invalid date or amount.'],
    [[{ ...proposal()[0], pendingAmount: '400.01' }, proposal()[1]], 409, 'The payment plan does not reconcile with the current balance.'],
  ] satisfies Array<[Proposal[], number, string]>)('preserves HTTP error mapping for invalid draft %#', async (entries, status, message) => {
    const testStore = store();
    const controller = new PaymentController({} as never, {} as never, new CustomizePaymentPlanUseCase(testStore.source, totalsReader));
    await expect(controller.plan('loan', { entries, base: baseline(testStore.state()), idempotencyKey: 'key' })).rejects.toMatchObject({ status, response: { message } });
    expect(writes(testStore.calls)).toEqual([]);
  });

  it.each([
    ['date changed', (state: State) => { state.rows[0].dueDate = '2026-04-02'; }],
    ['amount redistributed', (state: State) => { state.rows[0].pendingAmount = '300.00'; state.rows[1].pendingAmount = '600.00'; }],
    ['obligation added', (state: State) => { state.rows[1].pendingAmount = '400.00'; state.rows.push(row(NEW, 10, '2026-05-01', '100.00')); }],
    ['obligation removed', (state: State) => { state.rows[0].pendingAmount = '900.00'; state.rows[1].pendingAmount = '0.00'; }],
  ] satisfies Array<[string, (state: State) => void]>)('rejects a stale baseline when a persisted %s, before writes', async (_, change) => {
    const testStore = store(); const base = baseline(testStore.state());
    testStore.mutate(change);
    const before = testStore.state();
    await expect(customize(testStore, proposal(), 'key', base)).rejects.toBeInstanceOf(PaymentConflictError);
    expect(testStore.state()).toEqual(before);
    expect(writes(testStore.calls)).toEqual([]);
  });

  it('rejects an external valid payment balance change before writes', async () => {
    const options = { paidAmount: '100.00' };
    const testStore = store(options);
    const base = baseline(testStore.state());
    expect(cents(options.paidAmount) + cents(base.financialBalance)).toBe(100000n);
    options.paidAmount = '110.00';
    testStore.mutate((state) => { state.rows[1].pendingAmount = '490.00'; });
    expect(cents(options.paidAmount) + testStore.state().rows.filter((entry) => entry.loanId === 'loan' && cents(entry.pendingAmount) > 0n)
      .reduce((sum, entry) => sum + cents(entry.pendingAmount), 0n)).toBe(100000n);
    expect(base.entries.find((entry) => entry.id === B)?.pendingAmount).toBe('500.00');
    await expect(customize(testStore, [{ ...proposal()[0], pendingAmount: '390.00' }, proposal()[1]], 'key', base))
      .rejects.toMatchObject({ message: 'The payment plan changed since it was opened. Refresh the loan and try again.' });
    expect(writes(testStore.calls)).toEqual([]);
  });

  it('ignores technical sequences, reordering, and historical zero rows when comparing the opening plan', async () => {
    const testStore = store(); const base = baseline(testStore.state());
    testStore.mutate((state) => { state.rows[0].sequence = 99; state.rows[2].dueDate = '2026-12-01'; state.rows[2].sequence = 50; });
    expect(await customize(testStore, proposal(), 'key', { ...base, entries: [...base.entries].reverse().map((item) => ({ ...item, pendingAmount: item.pendingAmount.replace(/\.00$/, '') })) })).toHaveLength(2);
  });

  it.each(['edit', 'close'] as const)('rejects a zero-row %s UPDATE and rolls back the whole plan', async (zeroUpdate) => {
    const testStore = store({ zeroUpdate });
    await expect(customize(testStore, [{ id: A, dueDate: '2026-04-01', pendingAmount: '900.00' }])).rejects.toBeInstanceOf(PaymentConflictError);
    expect(testStore.state()).toEqual(initial());
    expect(testStore.calls.some(({ sql }) => sql.startsWith('UPDATE loans SET payment_plan_idempotency_key'))).toBe(false);
  });

  it('returns a controlled conflict if the loan becomes inactive', async () => {
    const testStore = store({ status: 'CANCELLED' });
    const controller = new PaymentController({} as never, {} as never, new CustomizePaymentPlanUseCase(testStore.source, totalsReader));
    await expect(controller.plan('loan', { entries: proposal(), base: baseline(testStore.state()), idempotencyKey: 'key' })).rejects.toMatchObject({ status: 409 });
    expect(writes(testStore.calls)).toEqual([]);
  });
});
