import type { DataSource } from 'typeorm';
import { PaymentConflictError, PaymentValidationError, RegisterPaymentUseCase } from '../src/application/payment/payment.use-case';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { CreatePaymentDto } from '../src/presentation/payment/payment.dto';
import { validate } from 'class-validator';

const totalsReader = new LoanFinancialTotalsTypeormReader();
const collectorId = '77777777-7777-4777-8777-777777777777';

type Row = { id: string; dueDate: string; sequence: number; pendingAmount: string };
type Fact = { id: string; amount: string; principal: string; interest: string; status: 'VALID' | 'ANNULLED'; key: string; fingerprint: string };
type Application = { paymentId: string; planEntryId: string; amountApplied: string; pendingBefore: string; pendingAfter: string; carriedForwardAmount: string; carriedToPlanEntryId: string | null };
type Cash = { id: string; paymentId: string; amount: string };
type State = { status: 'ACTIVE' | 'CANCELLED'; rows: Row[]; payments: Fact[]; applications: Application[]; cash: Cash[]; history: Array<{ sql: string; params: unknown[] }> };
const cents = (value: string) => BigInt(value.replace('.', ''));
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const initial = (count: number, loanId = 'loan'): State => ({ status: 'ACTIVE', rows: Array.from({ length: count }, (_, index) => ({ id: `entry-${index + 1}`, dueDate: `2026-0${index + 2}-01`, sequence: index + 1, pendingAmount: '60000.00' })).reverse(), payments: [], applications: [], cash: [], history: [{ sql: 'CREATED', params: [loanId, 1] }] });
const input = (amount: string) => ({ loanId: 'loan', amount, methodId: 'method', collectorId, paymentDate: '2026-01-10', idempotencyKey: 'key' });

function store(count: number, options: { staleFirstKeyRead?: boolean; postPending?: string; failCash?: boolean; failReceiver?: boolean; principal?: string; firstOverdue?: boolean; cancelResult?: 'zero' | 'ambiguous' | 'wrong-id' | 'flat' | 'no-id' | 'duplicate'; failHistory?: boolean; persistedActor?: string; loanId?: string; validCollector?: boolean } = {}) {
  const loanId = options.loanId ?? 'loan';
  let state = initial(count, loanId);
  if (options.firstOverdue) state.rows.find((row) => row.id === 'entry-1')!.dueDate = '2026-01-05';
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const transaction = jest.fn(async (callback: (manager: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<unknown>) => {
    const draft = structuredClone(state);
    let keyReads = 0;
    const query = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
      calls.push({ sql, params });
      if (sql.includes('FROM payments WHERE idempotency_key = $1 FOR SHARE')) {
        if (options.staleFirstKeyRead && draft.payments.length && keyReads++ === 0) return [];
        const fact = draft.payments.find((item) => item.key === params[0]);
        return fact ? [{ id: fact.id, fingerprint: fact.fingerprint }] : [];
      }
      if (sql.includes('FROM loans WHERE id = $1 FOR UPDATE')) return String(params[0]).toLowerCase() === loanId ? [{ id: loanId, status: draft.status, startDate: '2026-01-01', principal: options.principal ?? money(BigInt(count) * 5000000n), interestAmount: money(BigInt(count) * 6000000n - (options.principal ? cents(options.principal) : BigInt(count) * 5000000n)), totalAmount: money(BigInt(count) * 6000000n) }] : [];
      if (sql.includes('FROM financial_openings')) return [{ openingDate: '2026-01-01' }];
      if (sql.includes('ORDER BY payment_date DESC, created_at DESC, id DESC LIMIT 1')) return draft.payments.length ? [{ paymentDate: '2026-01-10' }] : [];
       if (sql.includes('FROM payment_methods')) return [{ id: 'method' }];
       if (sql.includes('FROM collectors')) return options.validCollector === false ? [] : [{ id: collectorId }];
      if (sql.includes('FROM payment_plan_entries') && sql.includes('FOR UPDATE')) return draft.rows.filter((row) => cents(row.pendingAmount) > 0n).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence || a.id.localeCompare(b.id)).map((row) => ({ ...row }));
      if (sql.includes('SUM(principal_applied)')) {
        const valid = draft.payments.filter((fact) => fact.status === 'VALID');
        return [{ paidAmount: money(valid.reduce((sum, fact) => sum + cents(fact.amount), 0n)), paidPrincipal: money(valid.reduce((sum, fact) => sum + cents(fact.principal), 0n)), paidInterest: money(valid.reduce((sum, fact) => sum + cents(fact.interest), 0n)), invalidCount: 0 }];
      }
      if (sql.startsWith('INSERT INTO payments')) {
        const id = `payment-${draft.payments.length + 1}`;
        draft.payments.push({ id, amount: params[1] as string, principal: params[2] as string, interest: params[3] as string, status: 'VALID', key: params[8] as string, fingerprint: params[9] as string });
        return [{ id, createdAt: new Date('2026-09-28T09:02:03Z'), createdByUserId: options.persistedActor ?? params[7] }];
      }
      if (sql.startsWith('UPDATE payment_plan_entries')) { draft.rows.find((row) => row.id === params[1])!.pendingAmount = params[0] as string; return []; }
      if (sql.startsWith('INSERT INTO payment_applications')) {
        if (options.failReceiver && draft.applications.length === 1) throw new Error('Injected receiver failure');
        draft.applications.push({ paymentId: params[0] as string, planEntryId: params[1] as string, amountApplied: params[2] as string, pendingBefore: params[3] as string, pendingAfter: params[4] as string, carriedForwardAmount: params[5] as string, carriedToPlanEntryId: params[6] as string | null });
        return [];
      }
      if (sql.startsWith('INSERT INTO cash_movements')) {
        if (options.failCash) throw new Error('Injected cash failure');
        const id = `cash-${draft.cash.length + 1}`;
        draft.cash.push({ id, paymentId: params[7] as string, amount: params[0] as string });
        return [{ id }];
      }
      if (sql.includes('SUM(pending_amount)')) return [{ pendingAmount: options.postPending ?? money(draft.rows.reduce((sum, row) => sum + cents(row.pendingAmount), 0n)) }];
      if (sql.startsWith('UPDATE loans SET status')) {
        if (String(params[0]).toLowerCase() !== loanId || draft.status !== 'ACTIVE') return [[], 0];
        if (options.cancelResult === 'zero') return [[], 0];
        if (options.cancelResult === 'ambiguous') return [[{ id: 'loan' }], 2];
        if (options.cancelResult === 'wrong-id') return [[{ id: 'other' }], 1];
        if (options.cancelResult === 'flat') return [{ id: 'loan' }, 1];
        if (options.cancelResult === 'no-id') return [[{}], 1];
        if (options.cancelResult === 'duplicate') return [[{ id: 'loan' }, { id: 'loan' }], 1];
        draft.status = 'CANCELLED'; return [[{ id: loanId }], 1];
      }
      if (sql.startsWith('SELECT MAX(event_sequence)')) {
        const events = draft.history.filter((event) => event.params[0] === params[0]);
        return [{ maxSequence: events.length ? Math.max(...events.map((event) => Number(event.sql === 'CREATED' ? event.params[1] : event.params.at(-1)))) : null }];
      }
      if (sql.startsWith('INSERT INTO loan_status_history')) {
        if (options.failHistory) throw new Error('History insert failed');
        if (!sql.includes('event_sequence') || sql.includes('idempotency_key') || typeof params.at(-1) !== 'number' || draft.history.some((event) => event.params[0] === String(params[0]).toLowerCase() && (event.sql === 'CREATED' ? event.params[1] : event.params.at(-1)) === params.at(-1))) throw new Error('UQ_loan_status_history_loan_sequence');
        draft.history.push({ sql, params }); return [];
      }
      if (sql.includes('FROM payments WHERE id = $1')) {
        const fact = draft.payments.find((item) => item.id === params[0]);
        return fact ? [{ id: fact.id, amount: fact.amount, principalApplied: fact.principal, interestApplied: fact.interest, status: fact.status, loanId }] : [];
      }
      if (sql.includes('FROM payment_applications WHERE payment_id = $1 ORDER BY')) return draft.applications.filter((item) => item.paymentId === params[0]);
      if (sql.includes('FROM cash_movements WHERE payment_id = $1')) return draft.cash.filter((cash) => cash.paymentId === params[0]).map(({ id }) => ({ id }));
      throw new Error(`Unexpected query: ${sql}`);
    };
    const result = await callback({ query });
    state = draft;
    return result;
  });
  return { source: { transaction } as unknown as DataSource, state: () => state, calls, transaction };
}
const writes = (testStore: ReturnType<typeof store>) => testStore.calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/.test(sql));
const register = (testStore: ReturnType<typeof store>, amount: string) => new RegisterPaymentUseCase(testStore.source, totalsReader).execute(input(amount), 'actor');

describe('chronological multi-obligation payment registration', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-28T12:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  it('requires a valid collector UUID at both DTO and application boundaries without starting a transaction', async () => {
    const base = input('100.00');
    const missing = Object.assign(new CreatePaymentDto(), { ...base, collectorId: undefined });
    const malformed = Object.assign(new CreatePaymentDto(), { ...base, collectorId: 'not-a-uuid' });
    expect(await validate(missing)).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'collectorId' })]));
    expect(await validate(malformed)).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'collectorId' })]));
    const testStore = store(1);
    await expect(new RegisterPaymentUseCase(testStore.source, totalsReader).execute({ ...base, collectorId: '' }, 'actor')).rejects.toThrow('Seleccione un cobrador.');
    await expect(new RegisterPaymentUseCase(testStore.source, totalsReader).execute({ ...base, collectorId: 'not-a-uuid' }, 'actor')).rejects.toThrow('Seleccione un cobrador.');
    expect(testStore.transaction).not.toHaveBeenCalled();
  });

  it('rejects a missing or inactive collector inside the transaction before persisting', async () => {
    const testStore = store(1, { validCollector: false });
    await expect(register(testStore, '100.00')).rejects.toThrow('El cobrador seleccionado no es válido.');
    expect(writes(testStore)).toEqual([]);
  });

  it('persists the selected collector in the existing nullable historical column', async () => {
    const testStore = store(1);
    await register(testStore, '100.00');
    expect(testStore.calls.find(({ sql }) => sql.startsWith('INSERT INTO payments'))?.params[6]).toBe(collectorId);
  });

  it.each([
    [2, '60000.00', ['0.00', '60000.00'], ['60000.00'], 'ACTIVE'],
    [3, '80000.00', ['0.00', '40000.00', '60000.00'], ['60000.00', '20000.00'], 'ACTIVE'],
    [3, '120000.00', ['0.00', '0.00', '60000.00'], ['60000.00', '60000.00'], 'ACTIVE'],
    [4, '170000.00', ['0.00', '0.00', '10000.00', '60000.00'], ['60000.00', '60000.00', '50000.00'], 'ACTIVE'],
    [2, '120000.00', ['0.00', '0.00'], ['60000.00', '60000.00'], 'CANCELLED'],
  ] as const)('applies %s rows / %s chronologically and reconciles the loan', async (count, amount, pending, applied, status) => {
    const testStore = store(count);
    const result = await register(testStore, amount);
    const state = testStore.state();
    const rows = [...state.rows].sort((a, b) => a.sequence - b.sequence);
    expect(rows.map((row) => row.pendingAmount)).toEqual(pending);
    expect(rows.map(({ id, dueDate, sequence }) => [id, dueDate, sequence])).toEqual([...initial(count).rows].sort((a, b) => a.sequence - b.sequence).map(({ id, dueDate, sequence }) => [id, dueDate, sequence]));
    expect(state.status).toBe(status);
    expect(state.history).toHaveLength(status === 'CANCELLED' ? 2 : 1);
    expect(state.payments).toHaveLength(1);
    expect(state.cash).toEqual([{ id: 'cash-1', paymentId: state.payments[0].id, amount }]);
    expect(result).toMatchObject({ amount, cashId: 'cash-1', status: 'VALID' });
    expect(cents(state.payments[0].principal) + cents(state.payments[0].interest)).toBe(cents(amount));
    expect(cents(state.payments[0].principal)).toBe(cents(amount) < BigInt(count) * 5000000n ? cents(amount) : BigInt(count) * 5000000n);
    expect(state.applications.map((item) => item.planEntryId)).toEqual(applied.map((_, index) => `entry-${index + 1}`));
    expect(state.applications.map((item) => item.amountApplied)).toEqual(applied);
    expect(result.applications).toHaveLength(applied.length);
    expect(state.applications.every((item) => item.paymentId === state.payments[0].id && item.carriedForwardAmount === '0.00' && item.carriedToPlanEntryId === null && cents(item.pendingBefore) - cents(item.amountApplied) === cents(item.pendingAfter) && cents(item.pendingAfter) >= 0n)).toBe(true);
    expect(state.applications.reduce((sum, item) => sum + cents(item.amountApplied), 0n)).toBe(cents(amount));
    const paidValid = state.payments.filter((fact) => fact.status === 'VALID').reduce((sum, fact) => sum + cents(fact.amount), 0n);
    const balance = BigInt(count) * 6000000n - paidValid;
    expect(balance).toBeGreaterThanOrEqual(0n);
    expect(state.rows.reduce((sum, row) => sum + cents(row.pendingAmount), 0n)).toBe(balance);
    expect(testStore.calls.filter(({ sql }) => sql.includes('SUM(principal_applied)'))).toHaveLength(2);
    const index = (fragment: string) => testStore.calls.findIndex(({ sql }) => sql.includes(fragment));
    expect(index('FROM loans WHERE id = $1 FOR UPDATE')).toBeLessThan(index('FROM payment_plan_entries WHERE loan_id = $1'));
    expect(index('ORDER BY due_date, sequence, id FOR UPDATE')).toBeLessThan(index('INSERT INTO payments'));
    expect(testStore.calls.filter(({ sql }) => sql.startsWith('UPDATE payment_plan_entries')).map(({ params }) => params[1])).toEqual(applied.map((_, offset) => `entry-${offset + 1}`));
    expect(testStore.calls.filter(({ sql }) => sql.startsWith('INSERT INTO payment_applications')).every(({ sql }) => sql.includes("MAX(created_at) + interval '1 microsecond'") && sql.includes('clock_timestamp()'))).toBe(true);
    expect(testStore.calls.find(({ sql }) => sql.includes('FROM payment_applications WHERE payment_id = $1 ORDER BY'))?.sql).toContain('ORDER BY created_at, payment_plan_entry_id');
    if (status === 'CANCELLED') {
       expect(state.history[0]).toMatchObject({ sql: 'CREATED', params: ['loan', 1] });
       expect(state.history[1].sql).toContain("'TRANSITION','ACTIVE','CANCELLED',$2,$3,NULL,$4,NULL");
       expect(state.history[1].params).toEqual(['loan', new Date('2026-09-28T09:02:03Z'), 'actor', 'payment-1', 2]);
    }
  });

  it.each([
    [3, '20000.00', ['40000.00', '60000.00', '60000.00']],
    [2, '1.00', ['59999.00', '60000.00']],
    [2, '59999.00', ['1.00', '60000.00']],
  ] as const)('keeps a partial payment on the oldest of %s rows for %s', async (count, amount, pending) => {
    const testStore = store(count);
    const opening = initial(count);
    const result = await register(testStore, amount);
    const state = testStore.state();
    const ordered = [...state.rows].sort((a, b) => a.sequence - b.sequence);
    expect(ordered.map((row) => row.pendingAmount)).toEqual(pending);
    expect(ordered.map(({ id, dueDate, sequence }) => [id, dueDate, sequence]))
      .toEqual([...opening.rows].sort((a, b) => a.sequence - b.sequence).map(({ id, dueDate, sequence }) => [id, dueDate, sequence]));
    expect(state.applications).toEqual([{ paymentId: 'payment-1', planEntryId: 'entry-1', amountApplied: amount, pendingBefore: '60000.00', pendingAfter: pending[0], carriedForwardAmount: '0.00', carriedToPlanEntryId: null }]);
    expect(result.applications).toEqual(state.applications);
    expect(state.payments).toMatchObject([{ amount, principal: amount, interest: '0.00', status: 'VALID' }]);
    expect(state.cash).toEqual([{ id: 'cash-1', paymentId: 'payment-1', amount }]);
    expect(state.applications.reduce((sum, item) => sum + cents(item.amountApplied), 0n)).toBe(cents(amount));
    expect(ordered.reduce((sum, row) => sum + cents(row.pendingAmount), 0n) + cents(amount)).toBe(BigInt(count) * 6000000n);
    expect(testStore.calls.filter(({ sql }) => sql.startsWith('INSERT INTO payment_applications')).every(({ sql }) => sql.includes("MAX(created_at) + interval '1 microsecond'"))).toBe(true);
    expect(testStore.calls.filter(({ sql }) => sql.startsWith('INSERT INTO payment_applications')).map(({ params }) => params[1])).toEqual(['entry-1']);
    expect(testStore.calls.filter(({ sql }) => sql.startsWith('UPDATE payment_plan_entries')).map(({ params }) => params[1])).toEqual(['entry-1']);
    expect(writes(testStore).filter(({ sql }) => sql.startsWith('INSERT INTO payment_plan_entries'))).toHaveLength(0);
  });

  it('retains the no-next underpayment branch without a carry, new row, or zero application', async () => {
    const testStore = store(1);
    testStore.state().rows.push({ id: 'closed', dueDate: '2026-02-01', sequence: 2, pendingAmount: '0.00' });
    await register(testStore, '20000.00');
    expect(testStore.state().rows.map((row) => row.pendingAmount)).toEqual(['40000.00', '0.00']);
    expect(testStore.state().applications).toEqual([{ paymentId: 'payment-1', planEntryId: 'entry-1', amountApplied: '20000.00', pendingBefore: '60000.00', pendingAfter: '40000.00', carriedForwardAmount: '0.00', carriedToPlanEntryId: null }]);
    expect(writes(testStore).filter(({ sql }) => sql.startsWith('INSERT INTO payment_plan_entries'))).toHaveLength(0);
  });

  it('keeps capital-first principal and interest while preserving the oldest partial balance', async () => {
    const testStore = store(2, { principal: '15000.00' });
    await register(testStore, '20000.00');
    expect(testStore.state().payments).toMatchObject([{ amount: '20000.00', principal: '15000.00', interest: '5000.00' }]);
    expect([...testStore.state().rows].sort((a, b) => a.sequence - b.sequence).map((row) => row.pendingAmount)).toEqual(['40000.00', '60000.00']);
    expect(testStore.state().applications.map((item) => item.amountApplied)).toEqual(['20000.00']);
    expect(testStore.state().cash).toEqual([{ id: 'cash-1', paymentId: 'payment-1', amount: '20000.00' }]);
  });

  it('keeps an overdue partial obligation on its original date', async () => {
    const testStore = store(2, { firstOverdue: true });
    await register(testStore, '20000.00');
    expect(testStore.state().rows.map(({ id, dueDate, sequence }) => [id, dueDate, sequence]))
      .toEqual([['entry-2', '2026-03-01', 2], ['entry-1', '2026-01-05', 1]]);
    expect(testStore.state().applications.map((item) => [item.planEntryId, item.pendingAfter])).toEqual([['entry-1', '40000.00']]);
  });

  it('replays paired carry even when the first key lookup was stale without any additional writes', async () => {
    const testStore = store(3, { staleFirstKeyRead: true });
    const first = await register(testStore, '20000.00');
    const count = writes(testStore).length;
    expect(await register(testStore, '20000.00')).toEqual(first);
    expect(await register(testStore, '20000.00')).toEqual(first);
    expect(writes(testStore)).toHaveLength(count);
    expect(testStore.state().payments).toHaveLength(1);
    expect(testStore.state().applications).toHaveLength(1);
    expect(testStore.state().cash).toHaveLength(1);
    expect(testStore.state().history).toHaveLength(1);
  });

  it('rolls back the oldest plan mutation, payment, application and cash on cash or reconciliation failure', async () => {
    for (const options of [{ failCash: true }, { postPending: '159999.99' }]) {
      const testStore = store(3, options);
      await expect(register(testStore, '20000.00')).rejects.toThrow();
      expect(testStore.state()).toEqual(initial(3));
      expect(writes(testStore).filter(({ sql }) => sql.startsWith('UPDATE payment_plan_entries'))).toHaveLength(1);
    }
  });

  it('rejects overbalance before writes and rolls back all facts on a final mismatch or cash failure', async () => {
    const over = store(3); const before = initial(3);
    await expect(register(over, '180000.01')).rejects.toBeInstanceOf(PaymentValidationError);
    expect(over.state()).toEqual(before);
    expect(writes(over)).toEqual([]);
    for (const options of [{ postPending: '0.00' }, { failCash: true }]) {
      const failed = store(3, options);
      await expect(register(failed, '80000.00')).rejects.toThrow(options.failCash ? 'Injected cash failure' : PaymentConflictError);
      expect(writes(failed).filter(({ sql }) => sql.startsWith('INSERT INTO payment_applications'))).toHaveLength(2);
      expect(failed.state()).toEqual(before);
    }
  });

  it('replays one cash and one set of applications even if a concurrent retry missed the pre-lock lookup', async () => {
    const testStore = store(2, { staleFirstKeyRead: true });
    const first = await register(testStore, '120000.00');
    const written = writes(testStore).length;
    expect(await register(testStore, '120000.00')).toEqual(first);
    expect(await register(testStore, '120000.00')).toEqual(first);
    expect(writes(testStore)).toHaveLength(written);
    expect(testStore.state()).toMatchObject({ status: 'CANCELLED', payments: [{ amount: '120000.00' }], cash: [{ amount: '120000.00' }] });
    expect(testStore.state().applications).toHaveLength(2);
    expect(testStore.state().history).toHaveLength(2);
    expect(testStore.calls.filter(({ sql }) => sql.includes('FROM loans WHERE id = $1 FOR UPDATE'))).toHaveLength(3);
    await expect(register(testStore, '60000.00')).rejects.toBeInstanceOf(PaymentConflictError);
    expect(writes(testStore)).toHaveLength(written);
  });

  it('uses persisted payment time and actor rather than the operational date or request actor', async () => {
    const testStore = store(2, { persistedActor: 'persisted-payment-actor' });
    await register(testStore, '120000.00');
    expect(testStore.state().history[1].params).toEqual(['loan', new Date('2026-09-28T09:02:03Z'), 'persisted-payment-actor', 'payment-1', 2]);
    expect(testStore.calls.find(({ sql }) => sql.startsWith('INSERT INTO payments'))?.sql).toContain('RETURNING id, created_at AS "createdAt", created_by_user_id AS "createdByUserId"');
    expect(testStore.calls.find(({ sql }) => sql.startsWith('UPDATE loans SET status'))?.sql).toContain("WHERE id = $1 AND status = 'ACTIVE' RETURNING id");
  });

  it('closes a loan supplied with an uppercase UUID when the locked and updated rows use canonical lowercase', async () => {
    const loanId = 'abcdef01-2345-4678-9abc-def012345678';
    const requestedId = loanId.toUpperCase();
    const testStore = store(2, { loanId });
     const result = await new RegisterPaymentUseCase(testStore.source, totalsReader).execute({ ...input('120000.00'), loanId: requestedId }, 'actor');
    expect(result).toMatchObject({ status: 'VALID', cashId: 'cash-1', loanId });
    expect(testStore.state()).toMatchObject({ status: 'CANCELLED', payments: [{ amount: '120000.00' }], cash: [{ amount: '120000.00' }] });
    const events = testStore.state().history.filter(({ sql }) => sql.startsWith('INSERT INTO loan_status_history'));
    expect(events).toHaveLength(1);
    expect(events[0].params).toEqual([requestedId, new Date('2026-09-28T09:02:03Z'), 'actor', 'payment-1', 2]);
    expect(testStore.calls.find(({ sql }) => sql.startsWith('SELECT MAX(event_sequence)'))?.params).toEqual([loanId]);
    expect(testStore.calls.find(({ sql }) => sql.startsWith('UPDATE loans SET status'))?.params).toEqual([requestedId]);
  });

  it.each(['zero', 'ambiguous', 'wrong-id', 'flat', 'no-id', 'duplicate'] as const)('rejects %s affected loan rows and rolls back payment, cash, plan, and history', async (cancelResult) => {
    const testStore = store(2, { cancelResult });
    await expect(register(testStore, '120000.00')).rejects.toBeInstanceOf(PaymentConflictError);
    expect(testStore.state()).toEqual(initial(2));
    expect(testStore.calls.some(({ sql }) => sql.startsWith('INSERT INTO cash_movements'))).toBe(true);
    expect(testStore.calls.some(({ sql }) => sql.startsWith('INSERT INTO loan_status_history'))).toBe(false);
    expect(testStore.calls.some(({ sql }) => sql.startsWith('SELECT MAX(event_sequence)'))).toBe(false);
  });

  it('exposes a failed guarded cancellation as HTTP 409 without committing the payment', async () => {
    const testStore = store(2, { cancelResult: 'zero' });
     const controller = new PaymentController(new RegisterPaymentUseCase(testStore.source, totalsReader), {} as never, {} as never);
    await expect(controller.create(input('120000.00'), { id: 'actor' } as never)).rejects.toMatchObject({ status: 409 });
    expect(testStore.state()).toEqual(initial(2));
    expect(testStore.state().history).toHaveLength(1);
  });

  it('rolls back a fully reconciled payment, cash inflow, plan, and status if history insertion fails', async () => {
    const testStore = store(2, { failHistory: true });
    await expect(register(testStore, '120000.00')).rejects.toThrow('History insert failed');
    expect(testStore.calls.some(({ sql }) => sql.startsWith('INSERT INTO loan_status_history'))).toBe(true);
    expect(testStore.state()).toEqual(initial(2));
  });

  it.each(['zero', 'history'] as const)('reuses event 2 after a rolled-back %s failure on retry', async (failure) => {
    const options: { cancelResult?: 'zero'; failHistory?: boolean } = failure === 'zero' ? { cancelResult: 'zero' } : { failHistory: true };
    const testStore = store(2, options);
    await expect(register(testStore, '120000.00')).rejects.toThrow();
    expect(testStore.state()).toEqual(initial(2));
    options.cancelResult = undefined; options.failHistory = false;
    await register(testStore, '120000.00');
    expect(testStore.state().history.map(({ sql, params }) => sql === 'CREATED' ? params[1] : params.at(-1))).toEqual([1, 2]);
    expect(testStore.state().payments).toHaveLength(1);
  });

  it('uses the highest existing event for this loan, not the count or another loan maximum', async () => {
    const testStore = store(2);
    testStore.state().history.push({ sql: 'TRANSITION', params: ['loan', 4] }, { sql: 'TRANSITION', params: ['other-loan', 20] });
    await register(testStore, '120000.00');
    expect(testStore.state().history.at(-1)?.params.at(-1)).toBe(5);
    const queries = testStore.calls.map(({ sql }) => sql);
    expect(queries.findIndex((sql) => sql.startsWith('SELECT MAX(event_sequence)'))).toBeGreaterThan(queries.findIndex((sql) => sql.startsWith('UPDATE loans SET status')));
    expect(testStore.calls.find(({ sql }) => sql.startsWith('SELECT MAX(event_sequence)'))?.params).toEqual(['loan']);
  });

  it.each([['missing', []], ['overflow', [{ sql: 'CREATED', params: ['loan', 1] }, { sql: 'TRANSITION', params: ['loan', 2147483647] }]]] as const)('fails closed on %s history and rolls back the financial transaction', async (_, history) => {
    const testStore = store(2);
    testStore.state().history = history.map(({ sql, params }) => ({ sql, params: [...params] }));
    const before = structuredClone(testStore.state());
    await expect(register(testStore, '120000.00')).rejects.toBeInstanceOf(PaymentConflictError);
     const controller = new PaymentController(new RegisterPaymentUseCase(testStore.source, totalsReader), {} as never, {} as never);
    await expect(controller.create(input('120000.00'), { id: 'actor' } as never)).rejects.toMatchObject({ status: 409, response: { message: 'The loan status history sequence is unavailable.' } });
    expect(testStore.state()).toEqual(before);
    expect(testStore.calls.some(({ sql }) => sql.startsWith('INSERT INTO loan_status_history'))).toBe(false);
  });
});
