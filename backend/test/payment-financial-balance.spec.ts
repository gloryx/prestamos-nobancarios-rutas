import type { DataSource } from 'typeorm';
import { PaymentConflictError, PaymentContextUseCase, PaymentValidationError, RegisterPaymentUseCase } from '../src/application/payment/payment.use-case';
import { paymentDateOnlyKey } from '../src/domain/payment/payment-date-only';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';

const totalsReader = new LoanFinancialTotalsTypeormReader();
const collectorId = '77777777-7777-4777-8777-777777777777';

type Fact = { id: string; amount: string; principal: string; interest: string; status: 'VALID' | 'ANNULLED'; paymentDate?: string | Date; createdAt?: string };
type State = { status: 'ACTIVE' | 'CANCELLED'; pending: string; payments: Fact[]; cash: string[]; history: Array<{ sql: string; params: unknown[] }> };
const cents = (value: string) => BigInt(value.replace('.', ''));
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const input = (amount: string) => ({ loanId: 'loan-1', amount, paymentDate: '2026-01-02', methodId: 'method-1', collectorId, idempotencyKey: `key-${amount}` });

function paymentStore(initial: State, options: { postPending?: string; postTotals?: Partial<{ paidAmount: string; paidPrincipal: string; paidInterest: string; invalidCount: number }>; loanStartDate?: string; openingDate?: string } = {}) {
  let state = structuredClone(initial);
  const queries: string[] = [];
  const transaction = jest.fn(async (callback: (manager: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<unknown>) => {
    const draft = structuredClone(state);
    let reads = 0;
    const query = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
      queries.push(sql);
      if (sql.includes('idempotency_key = $1 FOR SHARE')) return [];
      if (sql.includes('FROM loans WHERE id = $1 FOR UPDATE')) return [{ id: 'loan-1', status: draft.status, startDate: options.loanStartDate ?? '2026-01-01', principal: '1000.00', interestAmount: '200.00', totalAmount: '1200.00' }];
      if (sql.includes('FROM financial_openings')) return [{ openingDate: options.openingDate ?? '2026-01-01' }];
      if (sql.includes('ORDER BY payment_date DESC, created_at DESC, id DESC LIMIT 1')) {
        const latest = draft.payments.filter((payment) => payment.status === 'VALID')
          .sort((left, right) => paymentDateOnlyKey(right.paymentDate ?? '2026-01-02').localeCompare(paymentDateOnlyKey(left.paymentDate ?? '2026-01-02'))
            || (right.createdAt ?? '').localeCompare(left.createdAt ?? '') || right.id.localeCompare(left.id))[0];
        return latest ? [{ paymentDate: latest.paymentDate ?? '2026-01-02' }] : [];
      }
      if (sql.includes('FROM payment_methods')) return [{ id: 'method-1' }];
      if (sql.includes('FROM collectors')) return [{ id: collectorId }];
      if (sql.includes('FROM payment_plan_entries') && sql.includes('FOR UPDATE')) return cents(draft.pending) > 0n ? [{ id: 'entry-1', dueDate: '2026-02-01', sequence: 1, pendingAmount: draft.pending }] : [];
      if (sql.includes('SUM(principal_applied)')) {
        const valid = draft.payments.filter((payment) => payment.status === 'VALID');
        const totals = {
          paidAmount: money(valid.reduce((sum, payment) => sum + cents(payment.amount), 0n)),
          paidPrincipal: money(valid.reduce((sum, payment) => sum + cents(payment.principal), 0n)),
          paidInterest: money(valid.reduce((sum, payment) => sum + cents(payment.interest), 0n)),
          invalidCount: valid.filter((payment) => cents(payment.amount) !== cents(payment.principal) + cents(payment.interest) || cents(payment.principal) < 0n || cents(payment.interest) < 0n).length,
        };
        return [{ ...totals, ...(reads++ > 0 ? options.postTotals : {}) }];
      }
      if (sql.startsWith('INSERT INTO payments')) {
        const id = `payment-${draft.payments.length + 1}`;
        draft.payments.push({ id, amount: params[1] as string, principal: params[2] as string, interest: params[3] as string, status: 'VALID', paymentDate: params[4] as string });
        return [{ id, createdAt: new Date('2026-09-28T08:00:00Z'), createdByUserId: params[7] }];
      }
      if (sql.startsWith('UPDATE payment_plan_entries SET pending_amount')) { draft.pending = params[0] as string; return []; }
      if (sql.startsWith('INSERT INTO payment_applications')) return [];
      if (sql.startsWith('INSERT INTO cash_movements')) { draft.cash.push(params[0] as string); return [{ id: 'cash-1' }]; }
      if (sql.includes('SUM(pending_amount)')) return [{ pendingAmount: options.postPending ?? draft.pending }];
      if (sql.startsWith('UPDATE loans SET status')) { draft.status = 'CANCELLED'; return [[{ id: 'loan-1' }], 1]; }
      if (sql.startsWith('SELECT MAX(event_sequence)')) {
        const events = draft.history.filter((event) => event.params[0] === params[0]);
        return [{ maxSequence: events.length ? Math.max(...events.map((event) => Number(event.sql === 'CREATED' ? event.params[1] : event.params.at(-1)))) : null }];
      }
      if (sql.startsWith('INSERT INTO loan_status_history')) {
        if (!sql.includes('event_sequence') || sql.includes('idempotency_key') || draft.history.some((event) => event.params[0] === params[0] && (event.sql === 'CREATED' ? event.params[1] : event.params.at(-1)) === params.at(-1))) throw new Error('UQ_loan_status_history_loan_sequence');
        draft.history.push({ sql, params }); return [];
      }
      if (sql.includes('FROM payments WHERE id = $1')) {
        const payment = draft.payments.find((fact) => fact.id === params[0]);
        return payment ? [{ id: payment.id, loanId: 'loan-1', amount: payment.amount, principalApplied: payment.principal, interestApplied: payment.interest, status: payment.status }] : [];
      }
      if (sql.includes('FROM payment_applications')) return [];
      throw new Error(`Unexpected query: ${sql}`);
    };
    const result = await callback({ query });
    state = draft;
    return result;
  });
  return { source: { transaction } as unknown as DataSource, state: () => state, queries, transaction };
}

const starting = (pending = '1200.00', payments: Fact[] = []): State => ({ status: 'ACTIVE', pending, payments, cash: [], history: [{ sql: 'CREATED', params: ['loan-1', 1] }] });
const prior = (amount: string, principal: string, interest = '0.00', status: Fact['status'] = 'VALID'): Fact => ({ id: 'prior', amount, principal, interest, status });

describe('new payment chronology', () => {
  const onDate = (paymentDate: string) => ({ ...input('100.00'), paymentDate });
  const register = (store: ReturnType<typeof paymentStore>, paymentDate: string) => new RegisterPaymentUseCase(store.source, totalsReader).execute(onDate(paymentDate), 'actor-1');
  const noMutations = (store: ReturnType<typeof paymentStore>) => expect(store.queries.filter((sql) => /^(INSERT|UPDATE|DELETE)\b/.test(sql))).toEqual([]);

  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-28T12:00:00.000Z')); });
  afterEach(() => jest.useRealTimers());

  it('accepts a first payment and reads latest VALID only after locking the loan and before insertion', async () => {
    const store = paymentStore(starting());
    await expect(register(store, '2026-09-24')).resolves.toMatchObject({ amount: '100.00', status: 'VALID' });
    const lock = store.queries.findIndex((sql) => sql.includes('FROM loans WHERE id = $1 FOR UPDATE'));
    const latest = store.queries.findIndex((sql) => sql.includes('ORDER BY payment_date DESC, created_at DESC, id DESC LIMIT 1'));
    const insert = store.queries.findIndex((sql) => sql.startsWith('INSERT INTO payments'));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(latest).toBeGreaterThan(lock);
    expect(latest).toBeLessThan(insert);
    expect(store.queries[latest]).toContain('payment_date::text AS "paymentDate"');
    expect(store.queries[latest]).toContain("FROM payments WHERE loan_id = $1 AND status = 'VALID'");
    expect(store.queries[latest]).toContain('ORDER BY payment_date DESC, created_at DESC, id DESC LIMIT 1');
  });

  it('rejects a day earlier than the latest VALID payment with HTTP 400 and no writes, including parser Dates', async () => {
    const initial = starting('1100.00', [{ ...prior('100.00', '100.00'), paymentDate: new Date(2026, 8, 25) }]);
    const store = paymentStore(initial);
    await expect(register(store, '2026-09-24')).rejects.toBeInstanceOf(PaymentValidationError);
    const controller = new PaymentController(new RegisterPaymentUseCase(store.source, totalsReader), {} as never, {} as never);
    await expect(controller.create(onDate('2026-09-24'), { id: 'actor-1' } as never)).rejects.toMatchObject({
      status: 400, response: { message: 'La fecha del pago no puede ser anterior al último pago válido registrado.' },
    });
    expect(store.state()).toEqual(initial);
    noMutations(store);
  });

  it('accepts the same day as the latest VALID payment', async () => {
    const store = paymentStore(starting('1100.00', [{ ...prior('100.00', '100.00'), paymentDate: '2026-09-25' }]));
    await expect(register(store, '2026-09-25')).resolves.toMatchObject({ amount: '100.00' });
    expect(store.state().payments).toHaveLength(2);
  });

  it('accepts a later day that is not in the future', async () => {
    const store = paymentStore(starting('1100.00', [{ ...prior('100.00', '100.00'), paymentDate: '2026-09-25' }]));
    await expect(register(store, '2026-09-26')).resolves.toMatchObject({ amount: '100.00' });
    expect(store.state().payments).toHaveLength(2);
  });

  it('ignores a later ANNULLED payment when finding the latest VALID day', async () => {
    const store = paymentStore(starting('1100.00', [
      { ...prior('100.00', '100.00'), paymentDate: '2026-09-25' },
      { ...prior('100.00', '100.00', '0.00', 'ANNULLED'), id: 'annulled', paymentDate: '2026-09-27' },
    ]));
    await expect(register(store, '2026-09-26')).resolves.toMatchObject({ amount: '100.00' });
    expect(store.state().payments).toHaveLength(3);
  });

  it('allows the same day when multiple VALID payments share the latest date', async () => {
    const store = paymentStore(starting('1000.00', [
      { ...prior('100.00', '100.00'), id: 'later', paymentDate: '2026-09-25', createdAt: '2026-09-25T11:00:00Z' },
      { ...prior('100.00', '100.00'), id: 'earlier', paymentDate: new Date(2026, 8, 25), createdAt: '2026-09-25T10:00:00Z' },
    ]));
    await expect(register(store, '2026-09-25')).resolves.toMatchObject({ amount: '100.00' });
    expect(store.state().payments).toHaveLength(3);
  });

  it('preserves the loan start-date rejection before checking chronology', async () => {
    const initial = starting();
    const store = paymentStore(initial, { loanStartDate: '2026-09-26', openingDate: '2026-09-01' });
    await expect(register(store, '2026-09-25')).rejects.toThrow('The payment date is outside the operational period.');
    expect(store.queries.some((sql) => sql.includes('ORDER BY payment_date DESC'))).toBe(false);
    expect(store.state()).toEqual(initial);
    noMutations(store);
  });

  it('preserves the future-date rejection without starting a transaction', async () => {
    const initial = starting();
    const store = paymentStore(initial);
    await expect(register(store, '2026-09-29')).rejects.toBeInstanceOf(PaymentValidationError);
    expect(store.transaction).not.toHaveBeenCalled();
    expect(store.state()).toEqual(initial);
    noMutations(store);
  });
});

describe('payment financial balance and transaction', () => {
  it('applies a partial payment to principal first, retains ACTIVE, and rechecks persisted sums', async () => {
    const store = paymentStore(starting());
    const result = await new RegisterPaymentUseCase(store.source, totalsReader).execute(input('200.00'), 'actor-1');
    expect(result).toMatchObject({ amount: '200.00', principalApplied: '200.00', interestApplied: '0.00', cashId: 'cash-1' });
    expect(store.state()).toMatchObject({ status: 'ACTIVE', pending: '1000.00', cash: ['200.00'] });
    expect(store.queries.filter((sql) => sql.includes('SUM(principal_applied)'))).toHaveLength(2);
    expect(store.queries.some((sql) => sql.includes('SUM(pending_amount)'))).toBe(true);
    expect(store.queries.some((sql) => sql.startsWith('UPDATE loans SET status'))).toBe(false);
    expect(store.state().history).toHaveLength(1);
    expect(store.queries.some((sql) => sql.startsWith('SELECT MAX(event_sequence)'))).toBe(false);
    expect(store.queries).toContainEqual(expect.stringContaining('start_date::text AS "startDate"'));
    expect(store.queries).toContainEqual(expect.stringContaining('opening_date::text AS "openingDate"'));
    expect(store.queries).toContainEqual(expect.stringContaining('due_date::text AS "dueDate"'));
    expect(store.queries).toContainEqual(expect.stringContaining('payment_date::text AS "paymentDate"'));
  });

  it('applies the last principal before interest on a partial payment', async () => {
    const store = paymentStore(starting('300.00', [prior('900.00', '900.00')]));
    const result = await new RegisterPaymentUseCase(store.source, totalsReader).execute(input('150.00'), 'actor-1');
    expect(result).toMatchObject({ amount: '150.00', principalApplied: '100.00', interestApplied: '50.00' });
    expect(store.state()).toMatchObject({ status: 'ACTIVE', pending: '150.00', cash: ['150.00'] });
    expect(store.state().payments.filter((fact) => fact.status === 'VALID').reduce((sum, fact) => sum + cents(fact.principal), 0n)).toBe(100000n);
    expect(store.state().payments.filter((fact) => fact.status === 'VALID').reduce((sum, fact) => sum + cents(fact.interest), 0n)).toBe(5000n);
  });

  it('cancels only after a full payment has passed the final aggregate and plan checks', async () => {
    const store = paymentStore(starting());
    const result = await new RegisterPaymentUseCase(store.source, totalsReader).execute(input('1200.00'), 'actor-1');
    expect(result).toMatchObject({ principalApplied: '1000.00', interestApplied: '200.00', amount: '1200.00' });
    expect(store.state()).toMatchObject({ status: 'CANCELLED', pending: '0.00', cash: ['1200.00'] });
    expect(store.queries.findIndex((sql) => sql.startsWith('UPDATE loans SET status'))).toBeGreaterThan(store.queries.findIndex((sql) => sql.includes('SUM(pending_amount)')));
    expect(store.queries.findIndex((sql) => sql.startsWith('UPDATE loans SET status'))).toBeGreaterThan(store.queries.findLastIndex((sql) => sql.includes('SUM(principal_applied)')));
    expect(store.state().history[1].params).toEqual(['loan-1', new Date('2026-09-28T08:00:00Z'), 'actor-1', 'payment-1', 2]);
  });

  it('closes loan A at event 2 independently of a later or overlapping loan B sequence', async () => {
    for (const otherSequences of [[1, 4], [1, 2, 4]]) {
      const initial = starting();
      initial.history.push(...otherSequences.map((sequence) => ({ sql: sequence === 1 ? 'CREATED' : 'TRANSITION', params: ['loan-b', sequence] })));
      const store = paymentStore(initial);
      await new RegisterPaymentUseCase(store.source, totalsReader).execute(input('1200.00'), 'actor-1');
      expect(store.state().history.slice(0, initial.history.length)).toEqual(initial.history);
      expect(store.state().history.at(-1)?.params).toEqual(['loan-1', new Date('2026-09-28T08:00:00Z'), 'actor-1', 'payment-1', 2]);
      expect(store.state()).toMatchObject({ status: 'CANCELLED', pending: '0.00', cash: ['1200.00'] });
      expect(store.queries).toContain('SELECT MAX(event_sequence) AS "maxSequence" FROM loan_status_history WHERE loan_id = $1');
    }
  });

  it('excludes ANNULLED payment facts from all three aggregate sums', async () => {
    const store = paymentStore(starting('1200.00', [prior('900.00', '900.00', '0.00', 'ANNULLED')]));
    const result = await new RegisterPaymentUseCase(store.source, totalsReader).execute(input('200.00'), 'actor-1');
    expect(result).toMatchObject({ principalApplied: '200.00', interestApplied: '0.00' });
    expect(store.queries.filter((sql) => sql.includes('SUM(principal_applied)'))).toEqual([expect.stringContaining("status = 'VALID'"), expect.stringContaining("status = 'VALID'")]);
    expect(store.state().status).toBe('ACTIVE');
  });

  it.each([
    ['per-payment equation', starting('299.00', [prior('901.00', '900.00')])],
    ['offsetting per-payment errors', starting('1100.00', [{ ...prior('50.00', '49.00'), id: 'prior-a' }, { ...prior('50.00', '51.00'), id: 'prior-b' }])],
    ['principal cap', starting('100.00', [prior('1100.00', '1100.00')])],
    ['interest cap', starting('100.00', [prior('1100.00', '899.00', '201.00')])],
    ['pending plan equality', starting('1199.99')],
  ])('rejects preexisting %s without inserting or repairing', async (_, initial) => {
    const store = paymentStore(initial);
    await expect(new RegisterPaymentUseCase(store.source, totalsReader).execute(input('1.00'), 'actor-1')).rejects.toBeInstanceOf(PaymentConflictError);
    expect(store.state()).toEqual(initial);
    expect(store.queries.some((sql) => sql.startsWith('INSERT INTO payments'))).toBe(false);
  });

  it.each([
    ['final pending total', { postPending: '1.00' }],
    ['final component cap', { postTotals: { paidPrincipal: '1200.00' } }],
    ['final per-payment equation', { postTotals: { invalidCount: 1 } }],
  ])('rejects %s after insertion and signals transaction rollback', async (_, options) => {
    const store = paymentStore(starting(), options);
    await expect(new RegisterPaymentUseCase(store.source, totalsReader).execute(input('1200.00'), 'actor-1')).rejects.toBeInstanceOf(PaymentConflictError);
    expect(store.queries.some((sql) => sql.startsWith('INSERT INTO cash_movements'))).toBe(true);
    expect(store.queries.some((sql) => sql.startsWith('UPDATE loans SET status'))).toBe(false);
    expect(store.state()).toEqual(starting());
  });
});

describe('payment loan context integrity', () => {
  it.each([
    [[], 'Payment totals are unavailable.'],
    [[{ paidAmount: '0.00', paidPrincipal: '0.00', paidInterest: '0.00', invalidCount: 0 }], 'Payment balances do not reconcile with the loan and pending plan.'],
  ])('preserves PaymentConflictError and its message for invalid totals', async (rows, message) => {
    const query = jest.fn(async (sql: string) => sql.includes('FROM loans l JOIN customers c')
      ? [{ totalAmount: '120.00', principal: '100.00', interestAmount: '20.00' }]
      : sql.includes('SUM(principal_applied)') ? rows : sql.includes('FROM payment_plan_entries') ? [{ pendingAmount: '119.99', dueDate: '2026-02-01', sequence: 1, id: 'entry' }] : []);
    const error = await new PaymentContextUseCase({ query } as unknown as DataSource, totalsReader).execute('loan-1').catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PaymentConflictError);
    expect((error as Error).message).toBe(message);
  });

  it.each(['SQL', 'BigInt'] as const)('does not turn %s failures into PaymentConflictError', async (failure) => {
    const sqlError = new Error('Aggregate query failed');
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM loans l JOIN customers c')) return [{ totalAmount: '120.00', principal: '100.00', interestAmount: '20.00' }];
      if (sql.includes('SUM(principal_applied)')) {
        if (failure === 'SQL') throw sqlError;
        return [{ paidAmount: 'not-a-number', paidPrincipal: '0.00', paidInterest: '0.00', invalidCount: 0 }];
      }
      return [];
    });
    const result = new PaymentContextUseCase({ query } as unknown as DataSource, totalsReader).execute('loan-1');
    if (failure === 'SQL') await expect(result).rejects.toBe(sqlError);
    else await expect(result).rejects.toBeInstanceOf(SyntaxError);
  });

  const context = async (paid: { amount: string; principal: string; interest: string; status: Fact['status'] }[], pending: string) => {
    const valid = paid.filter((fact) => fact.status === 'VALID');
    const totals = {
      paidAmount: money(valid.reduce((sum, fact) => sum + cents(fact.amount), 0n)),
      paidPrincipal: money(valid.reduce((sum, fact) => sum + cents(fact.principal), 0n)),
      paidInterest: money(valid.reduce((sum, fact) => sum + cents(fact.interest), 0n)), invalidCount: 0,
    };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM loans l JOIN customers c')) return [{ loanId: 'loan-1', loanNumber: '7', status: 'ACTIVE', totalAmount: '1200.00', principal: '1000.00', interestAmount: '200.00', paidAmount: totals.paidAmount, preferredMethodId: 'method-1' }];
      if (sql.includes('SUM(principal_applied)')) return [totals];
      if (sql.includes('FROM payments WHERE loan_id')) return paid.map((fact, index) => ({ id: `p-${index}`, amount: fact.amount, paymentDate: '2026-01-02', status: fact.status }));
      if (sql.includes('FROM payment_plan_entries')) return pending === '0.00' ? [] : [{ id: 'entry', dueDate: '2026-02-01', sequence: 1, pendingAmount: pending }];
      if (sql.includes('FROM payment_methods') || sql.includes('FROM collectors')) return [];
      throw new Error(`Unexpected query: ${sql}`);
    });
    return new PaymentContextUseCase({ query } as unknown as DataSource, totalsReader).execute('loan-1');
  };

  it('returns principal, interest, and total outstanding from valid component sums', async () => {
    expect((await context([{ amount: '200.00', principal: '200.00', interest: '0.00', status: 'VALID' }, { amount: '10.00', principal: '10.00', interest: '0.00', status: 'ANNULLED' }], '1000.00')).balances)
      .toEqual({ outstandingPrincipal: '800.00', outstandingInterest: '200.00', financialBalance: '1000.00' });
    expect((await context([{ amount: '1050.00', principal: '1000.00', interest: '50.00', status: 'VALID' }], '150.00')).balances)
      .toEqual({ outstandingPrincipal: '0.00', outstandingInterest: '150.00', financialBalance: '150.00' });
    expect((await context([{ amount: '1200.00', principal: '1000.00', interest: '200.00', status: 'VALID' }], '0.00')).balances)
      .toEqual({ outstandingPrincipal: '0.00', outstandingInterest: '0.00', financialBalance: '0.00' });
  });

  it('raises a controlled 409 rather than showing a negative or inconsistent balance', async () => {
    const useCase = { execute: () => context([{ amount: '1201.00', principal: '1001.00', interest: '200.00', status: 'VALID' }], '0.00') } as unknown as PaymentContextUseCase;
    const controller = new PaymentController({} as never, useCase, {} as never);
    await expect(controller.detail('loan-1')).rejects.toMatchObject({ status: 409 });
    await expect(context([], '1199.99')).rejects.toBeInstanceOf(PaymentConflictError);
  });

  it('does not return a negative selector balance for corrupted loans', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('COUNT(*)') ? [{ total: 1 }] : [{ financialBalance: '-0.50' }]);
    const useCase = new PaymentContextUseCase({ query } as unknown as DataSource, totalsReader);
    await expect(useCase.listLoans({ page: 1, pageSize: 20 })).rejects.toBeInstanceOf(PaymentConflictError);
    await expect(new PaymentController({} as never, useCase, {} as never).loans({})).rejects.toMatchObject({ status: 409 });
  });
});
