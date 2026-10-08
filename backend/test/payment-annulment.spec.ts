import { createHash } from 'crypto';
import type { DataSource } from 'typeorm';
import { PaymentConflictError, RegisterPaymentUseCase } from '../src/application/payment/payment.use-case';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import type { PaymentAnnulmentType } from '../src/domain/payment/payment.types';
import { ClosedFinancialPeriodError } from '../src/domain/financial-close/financial-close.errors';
import { validate } from 'class-validator';
import { AnnulPaymentDto } from '../src/presentation/payment/payment.dto';

const totalsReader = new LoanFinancialTotalsTypeormReader();
const collectorId = '77777777-7777-4777-8777-777777777777';

type Plan = { id: string; loanId: string; dueDate: string; sequence: number; pendingAmount: string };
type Fact = { id: string; loanId: string; amount: string; principal: string; interest: string; methodId: string; collectorId?: string | null; status: 'VALID' | 'ANNULLED'; paymentDate: string; createdAt: string; key?: string; fingerprint?: string };
type Application = { entryId: string; amountApplied: string; pendingBefore: string; pendingAfter: string; carriedForwardAmount: string; carriedToEntryId: string | null; paymentId?: string };
type Annulment = { paymentId: string; reason: string; type: PaymentAnnulmentType; key: string; fingerprint: string; annulledAt: string; id?: string };
type Cash = { id: string; paymentId?: string; reversedId?: string; direction: string; concept: string; amount: string; methodId: string; key?: string; fingerprint?: string; movementDate?: string; reason?: string; actorId?: string };
type State = { status: 'ACTIVE' | 'CANCELLED' | 'REFINANCED'; plan: Plan[]; payments: Fact[]; applications: Application[]; annulments: Annulment[]; cash: Cash[]; history: Array<{ sql: string; params: unknown[] }> };
const cents = (amount: string) => BigInt(amount.replace('.', ''));
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const app = (entryId: string, amountApplied: string, pendingBefore: string, pendingAfter: string): Application => ({ entryId, amountApplied, pendingBefore, pendingAfter, carriedForwardAmount: '0.00', carriedToEntryId: null });
const entry = (id: string, dueDate: string, pendingAmount: string, sequence = 1): Plan => ({ id, loanId: 'loan', dueDate, sequence, pendingAmount });
const initial = (): State => ({
  status: 'ACTIVE', plan: [entry('first', '2026-02-01', '950.00')],
  payments: [{ id: 'p', loanId: 'loan', amount: '50.00', principal: '50.00', interest: '0.00', methodId: 'method', collectorId, status: 'VALID', paymentDate: '2026-01-02', createdAt: '2026-01-02T10:00:00Z' }],
  applications: [app('first', '50.00', '1000.00', '950.00')], annulments: [],
  cash: [{ id: 'cash-p', paymentId: 'p', direction: 'INFLOW', concept: 'CUSTOMER_PAYMENT', amount: '50.00', methodId: 'method', movementDate: '2026-01-02' }],
  history: [{ sql: 'CREATED', params: ['loan', 1] }],
});
const carried = (): State => {
  const state = initial();
  state.plan = [entry('first', '2026-02-01', '0.00'), entry('second', '2026-03-01', '100000.00', 2), entry('third', '2026-04-01', '60000.00', 3)];
  state.payments[0].amount = '20000.00'; state.payments[0].principal = '20000.00'; state.cash[0].amount = '20000.00';
  state.applications = [
    { ...app('first', '20000.00', '60000.00', '0.00'), carriedForwardAmount: '40000.00', carriedToEntryId: 'second' },
    app('second', '0.00', '60000.00', '100000.00'),
  ];
  return state;
};
const carriedLoan = { principal: '150000.00', interestAmount: '30000.00', totalAmount: '180000.00' };
const closed = (): State => {
  const state = initial(); state.status = 'CANCELLED'; state.plan[0].pendingAmount = '0.00';
  state.payments[0].amount = '1000.00'; state.payments[0].principal = '800.00'; state.payments[0].interest = '200.00';
  state.applications = [app('first', '1000.00', '1000.00', '0.00')]; state.cash[0].amount = '1000.00';
  state.history.push({ sql: "TRANSITION ACTIVE CANCELLED", params: ['loan', '2026-01-02T10:00:00Z', 'original-actor', 'p', 2] });
  return state;
};

function store(start: State, options: { postPending?: string; postInvalidCount?: number; cashConflict?: boolean; annulmentConflict?: boolean; loanAmounts?: { principal: string; interestAmount: string; totalAmount: string }; reopenResult?: 'zero' | 'ambiguous' | 'wrong-id' | 'flat' | 'no-id' | 'duplicate'; failHistory?: boolean; wrongPaymentSource?: boolean; persistedActor?: string; persistedReason?: string } = {}) {
  let state = structuredClone(start);
  const queries: string[] = [];
  const transaction = jest.fn(async (callback: (manager: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<unknown>) => {
    const draft = structuredClone(state);
    let totalsReads = 0;
    const query = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
      queries.push(sql);
      if (sql.includes('FROM payments WHERE idempotency_key = $1 FOR SHARE')) {
        const fact = draft.payments.find((item) => item.key === params[0]);
        return fact ? [{ id: fact.id, fingerprint: fact.fingerprint }] : [];
      }
      if (sql.startsWith('SELECT loan_id AS "loanId" FROM payments')) {
        const payment = draft.payments.find((fact) => fact.id === params[0]);
        return payment ? [{ loanId: payment.loanId }] : [];
      }
      if (sql.includes('FROM loans WHERE id = $1 FOR UPDATE')) return [{ id: 'loan', status: draft.status, startDate: '2026-01-01', ...(options.loanAmounts ?? { principal: '800.00', interestAmount: '200.00', totalAmount: '1000.00' }) }];
      if (sql.includes('FROM payments WHERE id = $1 FOR UPDATE')) {
        const payment = draft.payments.find((fact) => fact.id === params[0]);
        return payment ? [{ ...payment }] : [];
      }
      if (sql.includes('FROM payment_annulments WHERE idempotency_key')) {
        const found = draft.annulments.find((item) => item.key === params[0]);
        return found ? [{ paymentId: found.paymentId, reason: found.reason, annulmentType: found.type,
          annulledAt: new Date(found.annulledAt), fingerprint: found.fingerprint }] : [];
      }
      if (sql.includes('FROM cash_movements WHERE payment_id')) {
        const found = draft.cash.find((item) => item.paymentId === params[0] && item.direction === 'INFLOW' && item.concept === 'CUSTOMER_PAYMENT');
        return found ? [{ id: found.id, amount: found.amount, movementDate: found.movementDate, methodId: found.methodId }] : [];
      }
      if (sql.includes('FROM cash_movements WHERE reversed_movement_id')) {
        const found = draft.cash.find((item) => item.reversedId === params[0]);
        return found ? [{ amount: found.amount, movementDate: found.movementDate, direction: found.direction,
          concept: found.concept, methodId: found.methodId, idempotencyKey: found.key, fingerprint: found.fingerprint }] : [];
      }
      if (sql.includes('ORDER BY payment_date DESC, created_at DESC, id DESC LIMIT 1')) {
        const latest = draft.payments.filter((fact) => fact.loanId === params[0] && fact.status === 'VALID')
          .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
        return latest ? [sql.includes('payment_date::text AS "paymentDate"') ? { paymentDate: latest.paymentDate } : { id: latest.id }] : [];
      }
      if (sql.includes('FROM financial_openings')) return [{ openingDate: '2026-01-01' }];
      if (sql.includes('FROM payment_methods')) return [{ id: 'method' }];
      if (sql.includes('FROM collectors')) return [{ id: collectorId }];
      if (sql.includes('FROM payment_plan_entries') && sql.includes('FOR UPDATE')) return draft.plan.filter((row) => row.loanId === params[0] && (!sql.includes('pending_amount > 0') || cents(row.pendingAmount) > 0n)).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence || a.id.localeCompare(b.id)).map((row) => ({ ...row }));
      if (sql.includes('SUM(principal_applied)')) {
        const facts = draft.payments.filter((fact) => fact.status === 'VALID' && fact.loanId === params[0]);
        const result = { paidAmount: money(facts.reduce((sum, fact) => sum + cents(fact.amount), 0n)), paidPrincipal: money(facts.reduce((sum, fact) => sum + cents(fact.principal), 0n)), paidInterest: money(facts.reduce((sum, fact) => sum + cents(fact.interest), 0n)), invalidCount: totalsReads++ && options.postInvalidCount !== undefined ? options.postInvalidCount : 0 };
        return [result];
      }
      if (sql.includes('FROM payment_applications WHERE payment_id = $1 FOR UPDATE')) return draft.applications.filter((item) => (item.paymentId ?? 'p') === params[0]).map((item) => ({ ...item }));
      if (sql.startsWith('INSERT INTO payments')) {
        const id = `payment-${draft.payments.length + 1}`;
        draft.payments.push({ id, loanId: params[0] as string, amount: params[1] as string, principal: params[2] as string, interest: params[3] as string, paymentDate: params[4] as string, methodId: params[5] as string, collectorId: params[6] as string, status: 'VALID', createdAt: '2026-09-28T11:22:33Z', key: params[8] as string, fingerprint: params[9] as string });
        return [{ id, createdAt: new Date('2026-09-28T11:22:33Z'), createdByUserId: params[7] }];
      }
      if (sql.startsWith('INSERT INTO payment_applications')) {
        draft.applications.push({ paymentId: params[0] as string, entryId: params[1] as string, amountApplied: params[2] as string, pendingBefore: params[3] as string, pendingAfter: params[4] as string, carriedForwardAmount: params[5] as string, carriedToEntryId: params[6] as string | null });
        return [];
      }
      if (sql.startsWith('INSERT INTO payment_annulments')) {
        if (options.annulmentConflict || draft.annulments.some((item) => item.key === params[4] || item.paymentId === params[0])) return [];
        const id = 'annulment'; const paymentId = options.wrongPaymentSource ? 'other' : params[0] as string;
        const reason = options.persistedReason ?? params[1] as string;
        const type = params[2] as PaymentAnnulmentType; const annulledAt = '2026-09-28T10:11:12Z';
        draft.annulments.push({ id, paymentId, reason, type, key: params[4] as string, fingerprint: params[5] as string, annulledAt });
        return [{ id, paymentId, reason, annulmentType: type, annulledAt: new Date(annulledAt), createdByUserId: options.persistedActor ?? params[3] }];
      }
      if (sql.startsWith('UPDATE payment_plan_entries')) {
        const row = draft.plan.find((item) => item.id === params[1]);
        if (!row) throw new Error('Missing plan entry');
        row.pendingAmount = sql.includes('pending_amount +') ? money(cents(row.pendingAmount) + cents(params[0] as string)) : params[0] as string;
        return [];
      }
      if (sql.startsWith('UPDATE payments SET status')) { draft.payments.find((fact) => fact.id === params[0])!.status = 'ANNULLED'; return []; }
      if (sql.includes('SUM(pending_amount)')) return [{ pendingAmount: options.postPending ?? money(draft.plan.reduce((sum, row) => sum + cents(row.pendingAmount), 0n)) }];
      if (sql.startsWith('UPDATE loans SET status')) {
        if (options.reopenResult === 'zero') return [[], 0];
        if (options.reopenResult === 'ambiguous') return [[{ id: 'loan' }], 2];
        if (options.reopenResult === 'wrong-id') return [[{ id: 'other' }], 1];
        if (options.reopenResult === 'flat') return [{ id: 'loan' }, 1];
        if (options.reopenResult === 'no-id') return [[{}], 1];
        if (options.reopenResult === 'duplicate') return [[{ id: 'loan' }, { id: 'loan' }], 1];
        draft.status = sql.startsWith("UPDATE loans SET status = 'ACTIVE'") ? 'ACTIVE' : 'CANCELLED';
        return [[{ id: 'loan' }], 1];
      }
      if (sql.startsWith('SELECT MAX(event_sequence)')) {
        const events = draft.history.filter((event) => event.params[0] === params[0]);
        return [{ maxSequence: events.length ? Math.max(...events.map((event) => Number(event.sql === 'CREATED' ? event.params[1] : event.params.at(-1)))) : null }];
      }
      if (sql.startsWith('INSERT INTO cash_movements')) {
        if (options.cashConflict || draft.cash.some((item) => item.reversedId === params[4] || item.key === params[6])) return [];
        if (sql.includes("'INFLOW'")) {
          const id = `cash-${params[7]}`;
          draft.cash.push({ id, paymentId: params[7] as string, direction: 'INFLOW', concept: 'CUSTOMER_PAYMENT', amount: params[0] as string, methodId: params[2] as string });
          return [{ id }];
        }
        draft.cash.push({ id: 'cash-reversal', reversedId: params[4] as string, direction: 'OUTFLOW', concept: 'REVERSAL', amount: params[0] as string, movementDate: params[1] as string, methodId: params[2] as string, reason: params[3] as string, actorId: params[5] as string, key: params[6] as string, fingerprint: params[7] as string });
        return [{ id: 'cash-reversal' }];
      }
      if (sql.startsWith('INSERT INTO loan_status_history')) {
        if (options.failHistory) throw new Error('History insert failed');
        if (!sql.includes('event_sequence') || sql.includes('idempotency_key') || typeof params.at(-1) !== 'number' || draft.history.some((event) => event.params[0] === params[0] && (event.sql === 'CREATED' ? event.params[1] : event.params.at(-1)) === params.at(-1))) throw new Error('UQ_loan_status_history_loan_sequence');
        draft.history.push({ sql, params }); return [];
      }
      if (sql.includes('FROM payments WHERE id = $1')) {
        const fact = draft.payments.find((item) => item.id === params[0]);
        return fact ? [{ id: fact.id, status: fact.status, amount: fact.amount, loanId: fact.loanId }] : [];
      }
      if (sql.includes('FROM payment_applications WHERE payment_id = $1 ORDER BY')) return draft.applications.filter((item) => (item.paymentId ?? 'p') === params[0]).map((item) => ({ ...item }));
      throw new Error(`Unexpected query: ${sql}`);
    };
    const result = await callback({ query });
    state = draft;
    return result;
  });
  return { source: { transaction } as unknown as DataSource, state: () => state, queries };
}

const annul = (testStore: ReturnType<typeof store>, reason = '  Correction  ', key = 'key', paymentId = 'p',
  type: PaymentAnnulmentType = 'CASH_REFUND') => new RegisterPaymentUseCase(testStore.source, totalsReader).annul(paymentId, reason, key, 'actor', type);
const writes = (testStore: ReturnType<typeof store>) => testStore.queries.filter((sql) => /^(INSERT|UPDATE|DELETE)\b/.test(sql));

describe('last valid Payment annulment against the current plan', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-28T12:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  it('requires an explicit supported annulment type at the transport boundary', async () => {
    expect(await validate(Object.assign(new AnnulPaymentDto(), { reason: 'Correction', idempotencyKey: 'key' })))
      .toEqual(expect.arrayContaining([expect.objectContaining({ property: 'annulmentType' })]));
    expect(await validate(Object.assign(new AnnulPaymentDto(), { reason: 'Correction', annulmentType: 'OTHER', idempotencyKey: 'key' })))
      .toEqual(expect.arrayContaining([expect.objectContaining({ property: 'annulmentType' })]));
    expect(await validate(Object.assign(new AnnulPaymentDto(), { reason: 'Correction', annulmentType: 'DATA_CORRECTION', idempotencyKey: 'key' }))).toEqual([]);
  });

  it('refuses an isolated historical payment annulment on a REFINANCED origin without writing', async () => {
    const state = initial(); state.status = 'REFINANCED';
    const testStore = store(state);
    await expect(annul(testStore)).rejects.toBeInstanceOf(PaymentConflictError);
    expect(testStore.state()).toEqual(state);
    expect(writes(testStore)).toEqual([]);
  });

  it('locks Loan before Payment and plan, checks the latest VALID row and restores one exact application', async () => {
    const testStore = store(initial());
    await expect(annul(testStore)).resolves.toMatchObject({ status: 'ANNULLED', amount: '50.00' });
    expect(testStore.state().payments[0].collectorId).toBe(collectorId);
    const q = testStore.queries;
    const position = (fragment: string) => q.findIndex((sql) => sql.includes(fragment));
    expect(position('SELECT loan_id AS "loanId"')).toBeLessThan(position('FROM loans WHERE id = $1 FOR UPDATE'));
    expect(position('FROM loans WHERE id = $1 FOR UPDATE')).toBeLessThan(position('FROM payments WHERE id = $1 FOR UPDATE'));
    expect(position('FROM payments WHERE id = $1 FOR UPDATE')).toBeLessThan(position('ORDER BY payment_date DESC, created_at DESC, id DESC LIMIT 1'));
    expect(position('ORDER BY payment_date DESC, created_at DESC, id DESC LIMIT 1')).toBeLessThan(position('FROM payment_plan_entries WHERE loan_id = $1 ORDER BY'));
    expect(q.filter((sql) => sql.includes('SUM(principal_applied)'))).toHaveLength(2);
    expect(testStore.state().plan[0].pendingAmount).toBe('1000.00');
    expect(testStore.state().cash[1]).toMatchObject({ amount: '50.00', reversedId: 'cash-p', direction: 'OUTFLOW', methodId: 'method', movementDate: '2026-09-28', reason: 'Correction', actorId: 'actor', key: 'payment-annulment:key' });
    expect(testStore.state().annulments[0]).toMatchObject({ reason: 'Correction', type: 'CASH_REFUND', key: 'key' });
    expect(testStore.state().history).toHaveLength(1);
    expect(testStore.queries.some((sql) => sql.startsWith('SELECT MAX(event_sequence)'))).toBe(false);
  });

  it('backdates only the cash reversal for a data correction while retaining the real annulment timestamp', async () => {
    const testStore = store(initial());
    const dates: string[] = [];
    await new RegisterPaymentUseCase(testStore.source, totalsReader, {
      assertDateAllowed: async (date: string) => { dates.push(date); },
    } as never).annul('p', 'Data error', 'correction-key', 'actor', 'DATA_CORRECTION');

    expect(dates).toEqual(['2026-01-02']);
    expect(testStore.state().annulments[0]).toMatchObject({ type: 'DATA_CORRECTION', annulledAt: '2026-09-28T10:11:12Z' });
    expect(testStore.state().cash[1]).toMatchObject({ movementDate: '2026-01-02', concept: 'REVERSAL' });
  });

  it('uses the real annulment date for a cash refund and includes the type in idempotency', async () => {
    const testStore = store(initial());
    const dates: string[] = [];
    const useCase = new RegisterPaymentUseCase(testStore.source, totalsReader, {
      assertDateAllowed: async (date: string) => { dates.push(date); },
    } as never);
    await useCase.annul('p', 'Cash returned', 'refund-key', 'actor', 'CASH_REFUND');

    expect(dates).toEqual(['2026-09-28']);
    expect(testStore.state().cash[1]).toMatchObject({ movementDate: '2026-09-28', concept: 'REVERSAL' });
    await expect(useCase.annul('p', 'Cash returned', 'refund-key', 'actor', 'DATA_CORRECTION')).rejects.toBeInstanceOf(PaymentConflictError);
  });

  it('applies the closed-period guard to the economic date selected by the annulment type', async () => {
    const correction = store(initial());
    const guard = { assertDateAllowed: async (date: string) => {
      if (date === '2026-01-02') throw new ClosedFinancialPeriodError('The period is closed.');
    } };
    await expect(new RegisterPaymentUseCase(correction.source, totalsReader, guard as never)
      .annul('p', 'Data error', 'correction-key', 'actor', 'DATA_CORRECTION')).rejects.toThrow('The period is closed.');
    expect(writes(correction)).toEqual([]);

    const refund = store(initial());
    await expect(new RegisterPaymentUseCase(refund.source, totalsReader, guard as never)
      .annul('p', 'Cash returned', 'refund-key', 'actor', 'CASH_REFUND')).resolves.toMatchObject({ id: 'p', status: 'ANNULLED' });
  });

  it('restores every untouched application exactly without changing dates, sequence, or other rows', async () => {
    const state = initial();
    state.plan = [entry('first', '2026-02-01', '0.00'), entry('second', '2026-03-01', '0.00', 2), entry('untouched', '2026-04-01', '950.00', 3)];
    state.applications = [app('first', '30.00', '30.00', '0.00'), app('second', '20.00', '20.00', '0.00')];
    const testStore = store(state);
    await annul(testStore);
    expect(testStore.state().plan).toEqual([{ ...state.plan[0], pendingAmount: '30.00' }, { ...state.plan[1], pendingAmount: '20.00' }, state.plan[2]]);
    expect(testStore.state().applications).toEqual(state.applications);
    expect(writes(testStore).filter((sql) => sql.startsWith('UPDATE payment_plan_entries'))).toHaveLength(2);
  });

  it.each(['80000.00', '120000.00'])('restores every chronological application for %s and reverses cash once', async (amount) => {
    const state = initial();
    state.plan = [entry('first', '2026-02-01', '0.00'), entry('second', '2026-03-01', amount === '80000.00' ? '40000.00' : '0.00', 2), entry('third', '2026-04-01', '60000.00', 3)];
    state.payments[0].amount = amount; state.payments[0].principal = amount; state.cash[0].amount = amount;
    state.applications = [app('first', '60000.00', '60000.00', '0.00'), app('second', amount === '80000.00' ? '20000.00' : '60000.00', '60000.00', state.plan[1].pendingAmount)];
    const testStore = store(state, { loanAmounts: { principal: '150000.00', interestAmount: '30000.00', totalAmount: '180000.00' } });
    const result = await annul(testStore);
    expect(result).toMatchObject({ status: 'ANNULLED', amount });
    expect(testStore.state().plan.map((row) => row.pendingAmount)).toEqual(['60000.00', '60000.00', '60000.00']);
    expect(testStore.state().applications).toEqual(state.applications);
    expect(testStore.state().cash).toEqual([state.cash[0], expect.objectContaining({ amount, direction: 'OUTFLOW', reversedId: 'cash-p' })]);
    expect(writes(testStore).filter((sql) => sql.startsWith('UPDATE payment_plan_entries'))).toHaveLength(2);
    const count = writes(testStore).length;
    expect(await annul(testStore)).toEqual(result);
    expect(writes(testStore)).toHaveLength(count);
  });

  it('restores both unchanged paired-carry rows and reverses only the real 20k payment', async () => {
    const state = carried(); const testStore = store(state, { loanAmounts: carriedLoan });
    const result = await annul(testStore);
    expect(result).toMatchObject({ status: 'ANNULLED', amount: '20000.00' });
    expect(testStore.state().plan).toEqual([
      { ...state.plan[0], pendingAmount: '60000.00' }, { ...state.plan[1], pendingAmount: '60000.00' }, state.plan[2],
    ]);
    expect(testStore.state().applications).toEqual(state.applications);
    expect(testStore.state().cash).toEqual([state.cash[0], expect.objectContaining({ direction: 'OUTFLOW', amount: '20000.00', reversedId: 'cash-p' })]);
    expect(testStore.state().status).toBe('ACTIVE');
    expect(testStore.state().history).toEqual(state.history);
    expect(writes(testStore).filter((sql) => sql.startsWith('UPDATE payment_plan_entries'))).toHaveLength(2);
    const count = writes(testStore).length;
    expect(await annul(testStore, 'Correction')).toEqual(result);
    expect(writes(testStore)).toHaveLength(count);
  });

  it('compensates a personalized paired-carry plan by payment.amount once, not by historical carry', async () => {
    const state = carried();
    state.plan = [state.plan[0], { ...state.plan[1], pendingAmount: '0.00', dueDate: '2027-03-01' }, { ...state.plan[2], pendingAmount: '0.00' }, entry('custom', '2028-05-01', '160000.00', 4)];
    const testStore = store(state, { loanAmounts: carriedLoan });
    await annul(testStore);
    expect(testStore.state().plan).toEqual([state.plan[0], state.plan[1], state.plan[2], { ...state.plan[3], pendingAmount: '180000.00' }]);
    expect(testStore.state().cash[1]).toMatchObject({ amount: '20000.00', direction: 'OUTFLOW' });
    expect(testStore.state().history).toEqual(state.history);
    expect(writes(testStore).filter((sql) => sql.startsWith('UPDATE payment_plan_entries'))).toEqual([expect.stringContaining('pending_amount = pending_amount +')]);
    expect(testStore.state().applications).toEqual(state.applications);
  });

  it('compensates only cash when the source changes but the receiver still matches its audit', async () => {
    const state = carried();
    state.plan[0].pendingAmount = '10000.00'; state.plan[2].pendingAmount = '50000.00';
    const testStore = store(state, { loanAmounts: carriedLoan });
    await annul(testStore);
    expect(testStore.state().plan.map((row) => row.pendingAmount)).toEqual(['30000.00', '100000.00', '50000.00']);
    expect(testStore.state().cash[1].amount).toBe('20000.00');
    expect(writes(testStore).filter((sql) => sql.startsWith('UPDATE payment_plan_entries'))).toHaveLength(1);
  });

  it.each([{ postPending: '179999.99' }, { cashConflict: true }])('rolls back both paired-carry restorations on final reconciliation or reversal failure: %o', async (options) => {
    const state = carried(); const testStore = store(state, { ...options, loanAmounts: carriedLoan });
    await expect(annul(testStore)).rejects.toBeInstanceOf(PaymentConflictError);
    expect(writes(testStore).filter((sql) => sql.startsWith('UPDATE payment_plan_entries'))).toHaveLength(2);
    expect(testStore.state()).toEqual(state);
  });

  it.each([
    ['missing receiver', (state: State) => { state.applications.pop(); }],
    ['duplicate receiver', (state: State) => { state.applications.push({ ...state.applications[1] }); }],
    ['foreign receiver', (state: State) => { state.plan.push({ ...entry('foreign', '2026-03-01', '0.00'), loanId: 'other' }); state.applications[0].carriedToEntryId = 'foreign'; state.applications[1].entryId = 'foreign'; }],
    ['dangling target', (state: State) => { state.applications[0].carriedToEntryId = 'unknown'; }],
    ['self target', (state: State) => { state.applications[0].carriedToEntryId = 'first'; }],
    ['wrong source equation', (state: State) => { state.applications[0].pendingBefore = '60001.00'; }],
    ['nonzero receiver amount', (state: State) => { state.applications[1].amountApplied = '1.00'; }],
    ['zero receiver before', (state: State) => { state.applications[1].pendingBefore = '0.00'; }],
    ['wrong receiver after', (state: State) => { state.applications[1].pendingAfter = '99999.00'; }],
    ['receiver carries again', (state: State) => { state.applications[1].carriedForwardAmount = '1.00'; }],
    ['receiver points elsewhere', (state: State) => { state.applications[1].carriedToEntryId = 'third'; }],
    ['extra application', (state: State) => { state.applications.push(app('third', '1.00', '60001.00', '60000.00')); }],
    ['applied total mismatch', (state: State) => { state.applications[0].amountApplied = '19000.00'; state.applications[0].carriedForwardAmount = '41000.00'; }],
  ] satisfies Array<[string, (state: State) => void]>)('rejects malformed paired carry: %s before any mutation', async (_, change) => {
    const state = carried(); change(state);
    const testStore = store(state, { loanAmounts: carriedLoan });
    await expect(annul(testStore)).rejects.toBeInstanceOf(PaymentConflictError);
    expect(testStore.state()).toEqual(state);
    expect(writes(testStore)).toEqual([]);
  });

  it('compensates a personalized multi-row payment by its amount exactly once', async () => {
    const state = initial();
    state.plan = [entry('first', '2026-02-01', '10000.00'), entry('second', '2026-03-01', '0.00', 2), entry('third', '2026-04-01', '0.00', 3), entry('custom', '2026-05-01', '50000.00', 4)];
    state.payments[0].amount = '120000.00'; state.payments[0].principal = '120000.00'; state.cash[0].amount = '120000.00';
    state.applications = [app('first', '60000.00', '60000.00', '0.00'), app('second', '60000.00', '60000.00', '0.00')];
    const testStore = store(state, { loanAmounts: { principal: '150000.00', interestAmount: '30000.00', totalAmount: '180000.00' } });
    await annul(testStore);
    expect(testStore.state().plan.map((row) => row.pendingAmount)).toEqual(['130000.00', '0.00', '0.00', '50000.00']);
    expect(testStore.state().plan.map(({ id, dueDate, sequence }) => [id, dueDate, sequence])).toEqual(state.plan.map(({ id, dueDate, sequence }) => [id, dueDate, sequence]));
    expect(testStore.state().plan.reduce((sum, row) => sum + cents(row.pendingAmount), 0n) - state.plan.reduce((sum, row) => sum + cents(row.pendingAmount), 0n)).toBe(cents(state.payments[0].amount));
    expect(writes(testStore).filter((sql) => sql.startsWith('UPDATE payment_plan_entries'))).toEqual([expect.stringContaining('pending_amount = pending_amount +')]);
    expect(testStore.state().cash).toHaveLength(2);
  });

  it('rolls back both multi-row restorations when final VALID and pending totals disagree', async () => {
    const state = initial();
    state.plan = [entry('first', '2026-02-01', '0.00'), entry('second', '2026-03-01', '40000.00', 2), entry('third', '2026-04-01', '60000.00', 3)];
    state.payments[0].amount = '80000.00'; state.payments[0].principal = '80000.00'; state.cash[0].amount = '80000.00';
    state.applications = [app('first', '60000.00', '60000.00', '0.00'), app('second', '20000.00', '60000.00', '40000.00')];
    const testStore = store(state, { loanAmounts: { principal: '150000.00', interestAmount: '30000.00', totalAmount: '180000.00' }, postPending: '179999.99' });
    await expect(annul(testStore)).rejects.toBeInstanceOf(PaymentConflictError);
    expect(writes(testStore).filter((sql) => sql.startsWith('UPDATE payment_plan_entries'))).toHaveLength(2);
    expect(testStore.state()).toEqual(state);
  });

  it('reactivates a cancelled multi-row loan after exact restoration', async () => {
    const state = initial();
    state.status = 'CANCELLED'; state.plan = [entry('first', '2026-02-01', '0.00'), entry('second', '2026-03-01', '0.00', 2)];
    state.payments[0].amount = '120000.00'; state.payments[0].principal = '100000.00'; state.payments[0].interest = '20000.00'; state.cash[0].amount = '120000.00';
    state.applications = [app('first', '60000.00', '60000.00', '0.00'), app('second', '60000.00', '60000.00', '0.00')];
    const testStore = store(state, { loanAmounts: { principal: '100000.00', interestAmount: '20000.00', totalAmount: '120000.00' } });
    await annul(testStore);
    expect(testStore.state()).toMatchObject({ status: 'ACTIVE', plan: [{ pendingAmount: '60000.00' }, { pendingAmount: '60000.00' }] });
    expect(testStore.state().cash).toHaveLength(2);
    expect(writes(testStore).filter((sql) => sql.startsWith('UPDATE loans SET status'))).toHaveLength(1);
    expect(testStore.state().history[1].params).toEqual(['loan', new Date('2026-09-28T10:11:12Z'), 'actor', 'Correction', 'p', 'annulment', 2]);
  });

  it('compensates a personalized plan only once on the earliest positive current row', async () => {
    const state = initial();
    state.plan = [entry('first', '2026-05-01', '0.00', 3), entry('later', '2026-07-01', '550.00', 1), entry('earliest', '2026-06-01', '400.00', 2)];
    const testStore = store(state);
    await annul(testStore);
    expect(testStore.state().plan).toEqual([state.plan[0], state.plan[1], { ...state.plan[2], pendingAmount: '450.00' }]);
    expect(writes(testStore).filter((sql) => sql.startsWith('UPDATE payment_plan_entries'))).toHaveLength(1);
    expect(testStore.state().cash[1].amount).toBe('50.00');
  });

  it('reactivates a paid-off loan using its verified historical source when no positive row survives', async () => {
    const state = initial();
    state.status = 'CANCELLED'; state.plan[0].pendingAmount = '0.00';
    state.payments[0].amount = '1000.00'; state.payments[0].principal = '800.00'; state.payments[0].interest = '200.00';
    state.applications = [app('first', '1000.00', '1050.00', '50.00')]; state.cash[0].amount = '1000.00';
    const testStore = store(state);
    await annul(testStore);
    expect(testStore.state()).toMatchObject({ status: 'ACTIVE', plan: [{ pendingAmount: '1000.00' }], cash: [state.cash[0], { amount: '1000.00' }] });
    expect(writes(testStore).filter((sql) => sql.startsWith('UPDATE payment_plan_entries'))).toEqual([expect.stringContaining('pending_amount = pending_amount +')]);
    expect(testStore.queries.findIndex((sql) => sql.startsWith('UPDATE loans SET status'))).toBeGreaterThan(testStore.queries.findLastIndex((sql) => sql.includes('SUM(principal_applied)')));
  });

  it('excludes intermediate ANNULLED facts and rejects an older VALID payment without writing', async () => {
    const state = initial();
    state.plan[0].pendingAmount = '900.00';
    state.payments.push({ ...state.payments[0], id: 'q', paymentDate: '2026-01-03', createdAt: '2026-01-03T10:00:00Z' },
      { ...state.payments[0], id: 'annulled', status: 'ANNULLED', paymentDate: '2026-01-04' });
    const testStore = store(state);
    await expect(annul(testStore)).rejects.toBeInstanceOf(PaymentConflictError);
    expect(testStore.state()).toEqual(state);
    expect(writes(testStore)).toEqual([]);
    await expect(new PaymentController(new RegisterPaymentUseCase(testStore.source, totalsReader), {} as never, {} as never).annul('p', { reason: 'Correction', annulmentType: 'CASH_REFUND', idempotencyKey: 'key' }, { id: 'actor' } as never)).rejects.toMatchObject({ status: 409 });
  });

  it('ignores a later ANNULLED payment when choosing the latest VALID one', async () => {
    const state = initial();
    state.payments.push({ ...state.payments[0], id: 'later-annulled', status: 'ANNULLED', paymentDate: '2026-01-05' });
    const testStore = store(state);
    await expect(annul(testStore)).resolves.toMatchObject({ status: 'ANNULLED' });
    expect(testStore.state().cash).toHaveLength(2);
    expect(testStore.state().history).toHaveLength(1);
  });

  it('records reopening only after cash reversal using persisted annulment time, actor, reason and payment identity', async () => {
    const testStore = store(closed(), { persistedActor: 'persisted-annulment-actor', persistedReason: 'Persisted correction' });
    await annul(testStore);
    const event = testStore.state().history[2];
    expect(event.sql).toContain("'TRANSITION','CANCELLED','ACTIVE',$2,$3,$4,$5,$6");
    expect(event.params).toEqual(['loan', new Date('2026-09-28T10:11:12Z'), 'persisted-annulment-actor', 'Persisted correction', 'p', 'annulment', 3]);
    expect(testStore.queries.find((sql) => sql.startsWith('INSERT INTO payment_annulments'))).toContain('annulment_type AS "annulmentType", annulled_at AS "annulledAt", created_by_user_id AS "createdByUserId"');
    expect(testStore.queries.find((sql) => sql.startsWith('UPDATE loans SET status'))).toContain("WHERE id = $1 AND status = 'CANCELLED' RETURNING id");
    expect(testStore.queries.findIndex((sql) => sql.startsWith('INSERT INTO loan_status_history'))).toBeGreaterThan(testStore.queries.findIndex((sql) => sql.startsWith('INSERT INTO cash_movements')));
    expect(testStore.queries.findIndex((sql) => sql.startsWith('SELECT MAX(event_sequence)'))).toBeGreaterThan(testStore.queries.findIndex((sql) => sql.startsWith('UPDATE loans SET status')));
    expect(testStore.state().cash).toHaveLength(2);
  });

  it.each(['zero', 'ambiguous', 'wrong-id', 'flat', 'no-id', 'duplicate'] as const)('rolls back annulment, payment, plan and cash after %s reopen rows with no new event', async (reopenResult) => {
    const start = closed(); const testStore = store(start, { reopenResult });
    await expect(annul(testStore)).rejects.toBeInstanceOf(PaymentConflictError);
    expect(testStore.state()).toEqual(start);
    expect(writes(testStore).some((sql) => sql.startsWith('INSERT INTO payment_annulments'))).toBe(true);
    expect(writes(testStore).some((sql) => sql.startsWith('INSERT INTO loan_status_history'))).toBe(false);
    expect(testStore.queries.some((sql) => sql.startsWith('SELECT MAX(event_sequence)'))).toBe(false);
    expect(writes(testStore).some((sql) => sql.startsWith('INSERT INTO cash_movements'))).toBe(false);
  });

  it('exposes a failed guarded reopening as HTTP 409 without committing the annulment', async () => {
    const start = closed(); const testStore = store(start, { reopenResult: 'zero' });
    const controller = new PaymentController(new RegisterPaymentUseCase(testStore.source, totalsReader), {} as never, {} as never);
    await expect(controller.annul('p', { reason: 'Correction', annulmentType: 'CASH_REFUND', idempotencyKey: 'key' }, { id: 'actor' } as never)).rejects.toMatchObject({ status: 409 });
    expect(testStore.state()).toEqual(start);
    expect(testStore.state().history).toHaveLength(2);
  });

  it.each([{ failHistory: true }, { cashConflict: true }, { wrongPaymentSource: true }])('rolls back a cancelled-loan annulment if history, cash, or source identity fails: %o', async (options) => {
    const start = closed(); const testStore = store(start, options);
    await expect(annul(testStore)).rejects.toThrow();
    expect(testStore.state()).toEqual(start);
    expect(writes(testStore).some((sql) => sql.startsWith('UPDATE payment_plan_entries'))).toBe(!options.wrongPaymentSource);
    expect(writes(testStore).some((sql) => sql.startsWith('INSERT INTO loan_status_history'))).toBe(Boolean(options.failHistory));
    expect(writes(testStore).some((sql) => sql.startsWith('INSERT INTO cash_movements'))).toBe(!options.wrongPaymentSource);
    expect(writes(testStore).some((sql) => sql.startsWith('UPDATE payments SET status'))).toBe(!options.wrongPaymentSource);
  });

  it.each(['zero', 'history'] as const)('reuses event 3 after a rolled-back %s reopening on retry', async (failure) => {
    const start = closed();
    const options: { reopenResult?: 'zero'; failHistory?: boolean } = failure === 'zero' ? { reopenResult: 'zero' } : { failHistory: true };
    const testStore = store(start, options);
    await expect(annul(testStore)).rejects.toThrow();
    expect(testStore.state()).toEqual(start);
    options.reopenResult = undefined; options.failHistory = false;
    await annul(testStore);
    expect(testStore.state().history.map(({ sql, params }) => sql === 'CREATED' ? params[1] : params.at(-1))).toEqual([1, 2, 3]);
    expect(testStore.state().cash).toHaveLength(2);
  });

  it('reopens once on annul replay and permits a later full payment to close again with a different payment ID', async () => {
    const testStore = store(closed());
    const first = await annul(testStore);
    const count = writes(testStore).length;
    expect(await annul(testStore, 'Correction')).toEqual(first);
    expect(writes(testStore)).toHaveLength(count);
    expect(testStore.state().history).toHaveLength(3);
    expect(testStore.queries.filter((sql) => sql.startsWith('SELECT MAX(event_sequence)'))).toHaveLength(1);
    await new RegisterPaymentUseCase(testStore.source, totalsReader).execute({ loanId: 'loan', amount: '1000.00', methodId: 'method', collectorId, paymentDate: '2026-09-28', idempotencyKey: 'second-key' }, 'second-actor');
    expect(testStore.state()).toMatchObject({ status: 'CANCELLED', plan: [{ pendingAmount: '0.00' }] });
    expect(testStore.state().history.map(({ sql }) => sql.includes('CREATED') ? 'CREATED' : sql.includes("'CANCELLED','ACTIVE'") ? 'ACTIVE' : 'CANCELLED')).toEqual(['CREATED', 'CANCELLED', 'ACTIVE', 'CANCELLED']);
    expect(testStore.state().history[3].params).toEqual(['loan', new Date('2026-09-28T11:22:33Z'), 'second-actor', 'payment-2', 4]);
    expect(testStore.state().history[1].params[3]).toBe('p');
    expect(testStore.state().history[2].params.slice(-3, -1)).toEqual(['p', 'annulment']);
    expect(testStore.state().history[3].params[3]).not.toBe(testStore.state().history[1].params[3]);
    expect(testStore.state().annulments).toHaveLength(1);
    expect(testStore.state().cash).toHaveLength(3);
    const snapshot = structuredClone(testStore.state()); const written = writes(testStore).length;
    await new RegisterPaymentUseCase(testStore.source, totalsReader).execute({ loanId: 'loan', amount: '1000.00', methodId: 'method', collectorId, paymentDate: '2026-09-28', idempotencyKey: 'second-key' }, 'second-actor');
    expect(writes(testStore)).toHaveLength(written);
    expect(testStore.state()).toEqual(snapshot);
  });

  it('keeps a reopened loan ACTIVE after a partial payment and closes it only on the next full settlement', async () => {
    const testStore = store(closed());
    await annul(testStore);
    const register = new RegisterPaymentUseCase(testStore.source, totalsReader);
    await register.execute({ loanId: 'loan', amount: '200.00', methodId: 'method', collectorId, paymentDate: '2026-09-28', idempotencyKey: 'partial-key' }, 'partial-actor');
    expect(testStore.state()).toMatchObject({ status: 'ACTIVE', plan: [{ pendingAmount: '800.00' }] });
    expect(testStore.state().history).toHaveLength(3);
    await register.execute({ loanId: 'loan', amount: '800.00', methodId: 'method', collectorId, paymentDate: '2026-09-28', idempotencyKey: 'final-key' }, 'final-actor');
    expect(testStore.state()).toMatchObject({ status: 'CANCELLED', plan: [{ pendingAmount: '0.00' }] });
    expect(testStore.state().history).toHaveLength(4);
    expect(testStore.state().history[3].params).toEqual(['loan', new Date('2026-09-28T11:22:33Z'), 'final-actor', 'payment-3', 4]);
    expect(testStore.state().cash.filter((movement) => movement.direction === 'INFLOW')).toHaveLength(3);
  });

  it('reopens at the highest sequence plus one despite a hole and ignores other loans', async () => {
    const start = closed();
    start.history[1].params[4] = 4;
    start.history.push({ sql: 'TRANSITION', params: ['other-loan', 50] });
    const testStore = store(start);
    await annul(testStore);
    expect(testStore.state().history.at(-1)?.params.at(-1)).toBe(5);
  });

  it.each([['missing', []], ['overflow', [{ sql: 'CREATED', params: ['loan', 1] }, { sql: 'TRANSITION', params: ['loan', 2147483647] }]]] as const)('rolls back reopening and cash reversal when %s history cannot produce a sequence', async (_, history) => {
    const start = closed();
    start.history = history.map(({ sql, params }) => ({ sql, params: [...params] }));
    const testStore = store(start);
    await expect(annul(testStore)).rejects.toBeInstanceOf(PaymentConflictError);
    expect(testStore.state()).toEqual(start);
    expect(writes(testStore).some((sql) => sql.startsWith('INSERT INTO cash_movements'))).toBe(true);
    expect(writes(testStore).some((sql) => sql.startsWith('INSERT INTO loan_status_history'))).toBe(false);
  });

  it('breaks same-date ties by createdAt and then id rather than input order', async () => {
    for (const later of [{ id: 'q', createdAt: '2026-01-02T11:00:00Z' }, { id: 'z', createdAt: '2026-01-02T10:00:00Z' }]) {
      const state = initial();
      state.payments.unshift({ ...state.payments[0], ...later }); state.plan[0].pendingAmount = '900.00';
      const testStore = store(state);
      await expect(annul(testStore)).rejects.toBeInstanceOf(PaymentConflictError);
      expect(writes(testStore)).toEqual([]);
    }
  });

  it('retries the same key and trimmed reason without any further mutations or reversal', async () => {
    const testStore = store(initial());
    const first = await annul(testStore);
    const count = writes(testStore).length;
    await expect(annul(testStore, 'Correction')).resolves.toEqual(first);
    expect(writes(testStore)).toHaveLength(count);
    expect(testStore.state().annulments).toHaveLength(1);
    expect(testStore.state().cash).toHaveLength(2);
  });

  it('rejects reused keys, changed reasons, and second annulments of the same payment', async () => {
    const testStore = store(initial());
    await annul(testStore);
    for (const [reason, key] of [['Other', 'key'], ['Correction', 'other']]) {
      const before = structuredClone(testStore.state());
      await expect(annul(testStore, reason, key)).rejects.toBeInstanceOf(PaymentConflictError);
      expect(testStore.state()).toEqual(before);
    }
    const wrong = initial();
    wrong.payments.push({ ...wrong.payments[0], id: 'q', loanId: 'other' });
    wrong.annulments.push({ paymentId: 'q', reason: 'Correction', type: 'CASH_REFUND', key: 'key', annulledAt: '2026-09-28T10:11:12Z',
      fingerprint: createHash('sha256').update(JSON.stringify({ paymentId: 'q', reason: 'Correction' })).digest('hex') });
    const conflict = store(wrong);
    await expect(annul(conflict)).rejects.toBeInstanceOf(PaymentConflictError);
    expect(writes(conflict)).toEqual([]);
    const sameLoan = initial();
    sameLoan.payments.push({ ...sameLoan.payments[0], id: 'q', status: 'ANNULLED' });
    const reused = store(sameLoan);
    await annul(reused);
    await expect(annul(reused, 'Correction', 'key', 'q')).rejects.toBeInstanceOf(PaymentConflictError);
  });

  const invalidApplications: Array<[string, (state: State) => void]> = [
    ['missing', (state: State) => { state.applications = []; }],
    ['foreign source', (state: State) => { state.plan.push({ ...entry('foreign', '2026-03-01', '0.00'), loanId: 'other' }); state.applications[0].entryId = 'foreign'; }],
    ['duplicate source', (state: State) => { state.applications.push({ ...state.applications[0] }); }],
    ['invalid amount', (state: State) => { state.applications[0].amountApplied = '49.00'; }],
    ['invalid equation', (state: State) => { state.applications[0].pendingBefore = '999.00'; }],
    ['untracked carry', (state: State) => { state.applications[0].carriedForwardAmount = '1.00'; }],
  ];
  it.each(invalidApplications)('rejects %s applications before mutation', async (_, change) => {
    const state = initial(); change(state);
    const testStore = store(state);
    await expect(annul(testStore)).rejects.toBeInstanceOf(PaymentConflictError);
    expect(testStore.state()).toEqual(state);
    expect(writes(testStore)).toEqual([]);
  });

  it.each([{ postPending: '999.00' }, { postInvalidCount: 1 }, { cashConflict: true }, { annulmentConflict: true }])('throws a controlled conflict and discards the transaction draft on %o', async (options) => {
    const state = initial(); const testStore = store(state, options);
    await expect(annul(testStore)).rejects.toBeInstanceOf(PaymentConflictError);
    expect(testStore.state()).toEqual(state);
    expect(writes(testStore).some((sql) => sql.startsWith('UPDATE payments SET status'))).toBe(!options.annulmentConflict);
  });

  it('rejects a missing or inconsistent linked inflow and a broken replay reversal', async () => {
    for (const change of [(state: State) => { state.cash = []; }, (state: State) => { state.cash[0].amount = '49.00'; }]) {
      const state = initial(); change(state); const testStore = store(state);
      await expect(annul(testStore)).rejects.toBeInstanceOf(PaymentConflictError);
      expect(writes(testStore)).toEqual([]);
    }
    const testStore = store(initial()); await annul(testStore);
    const broken = structuredClone(testStore.state()); broken.cash[1].amount = '49.00';
    const retry = store(broken);
    await expect(annul(retry)).rejects.toBeInstanceOf(PaymentConflictError);
    expect(writes(retry)).toEqual([]);
  });
});
