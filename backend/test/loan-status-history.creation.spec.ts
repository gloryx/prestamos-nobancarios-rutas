import { CreateLoanUseCase, LoanConflictError } from '../src/application/loan/loan.use-case';

const base = {
  customerId: 'customer', paymentFrequencyId: 'frequency', preferredPaymentMethodId: 'preferred',
  disbursementPaymentMethodId: 'disbursement', startDate: '2026-01-31', principal: '100.00',
  interestAmount: '10', plan: [{ sequence: 1, dueDate: '2026-02-28', pendingAmount: '110' }],
  idempotencyKey: 'loan-key',
};
const createdAt = new Date('2026-02-01T10:11:12.000Z');
type Call = { sql: string; params: unknown[]; scope: 'outer' | 'savepoint' };
type State = { loans: { id: string; key: string; fingerprint: string }[]; history: Call[]; plans: number; disbursements: number; cash: number };
const empty = (): State => ({ loans: [], history: [], plans: 0, disbursements: 0, cash: 0 });
const clone = (state: State): State => ({ ...state, loans: [...state.loans], history: [...state.history] });

function fakeTransactions(failOn?: 'loan' | 'historyUnique' | 'historyOther' | 'plan' | 'cash', persistedActor?: string) {
  let committed = empty();
  let pending = empty();
  let outerRollbacks = 0;
  let savepointRollbacks = 0;
  const calls: Call[] = [];
  const query = async (sql: string, params: unknown[] = [], scope: Call['scope']) => {
    const call = { sql, params, scope };
    calls.push(call);
    if (sql.startsWith('SELECT id, idempotency_fingerprint')) {
      const loan = pending.loans.find((item) => item.key === params[0]);
      return loan ? [{ id: loan.id, fingerprint: loan.fingerprint }] : [];
    }
    if (sql.startsWith('SELECT opening_date')) return [{ openingDate: '2026-01-01' }];
    if (sql.startsWith('SELECT id FROM customers')) return [{ id: 'customer' }];
    if (sql.startsWith('SELECT id FROM payment_frequencies')) return [{ id: 'frequency' }];
    if (sql.startsWith('SELECT id FROM payment_methods')) return [{ id: 'preferred' }, { id: 'disbursement' }];
    if (sql.startsWith('INSERT INTO loans')) {
      if (failOn === 'loan') throw { code: '23505', constraint: 'UQ_loans_number' };
       const id = `loan-${pending.loans.length + 1}`;
       pending.loans.push({ id, key: String(params[9]), fingerprint: String(params[10]) });
       return [{ id, created_at: createdAt, created_by_user_id: persistedActor ?? params[8] }];
    }
     if (sql.startsWith('INSERT INTO loan_status_history')) {
       if (!sql.includes('event_sequence') || !sql.includes('VALUES ($1,1,') || pending.history.some((event) => event.params[0] === params[0])) throw new Error('Invalid CREATED sequence');
      if (failOn === 'historyUnique') throw { code: '23505', constraint: 'UQ_loan_status_history_created' };
      if (failOn === 'historyOther') throw new Error('History insert failed');
      pending.history.push(call);
      return [];
    }
    if (sql.startsWith('INSERT INTO payment_plan_entries')) {
      if (failOn === 'plan') throw new Error('Plan insert failed');
      pending.plans++;
      return [];
    }
    if (sql.startsWith('INSERT INTO loan_disbursements')) { pending.disbursements++; return [{ id: 'disbursement-1' }]; }
    if (sql.startsWith('SELECT l.id')) return [{ id: String(params[0]), loanNumber: 1, status: 'ACTIVE' }];
    if (sql.startsWith('SELECT sequence')) return [{ sequence: 1, dueDate: '2026-02-28', pendingAmount: '110.00' }];
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const nested = { query: jest.fn((sql: string, params?: unknown[]) => query(sql, params, 'savepoint')) };
  const manager = {
    query: jest.fn((sql: string, params?: unknown[]) => query(sql, params, 'outer')),
    transaction: jest.fn(async (callback: (inner: typeof nested) => Promise<unknown>) => {
      const before = clone(pending);
      try { return await callback(nested); }
      catch (error) { pending = before; savepointRollbacks++; throw error; }
    }),
  };
  const dataSource = { transaction: jest.fn(async (callback: (outer: typeof manager) => Promise<unknown>) => {
    pending = clone(committed);
    try { const result = await callback(manager); committed = clone(pending); return result; }
    catch (error) { outerRollbacks++; throw error; }
  }) };
  const cash = { recordWithManager: jest.fn(async (outer: typeof manager) => {
    expect(outer).toBe(manager);
    if (failOn === 'cash') throw new Error('Cash recording failed');
    pending.cash++;
  }) };
  return { useCase: new CreateLoanUseCase(dataSource as never, cash as never), manager, nested, dataSource, cash,
    calls, state: () => committed, rollbacks: () => ({ outer: outerRollbacks, savepoint: savepointRollbacks }) };
}

describe('loan CREATED event atomicity (fake transactions; no database)', () => {
  it('inserts one ACTIVE loan and one CREATED event in the same savepoint, before plan, disbursement and cash', async () => {
    const fake = fakeTransactions();
    const result = await fake.useCase.execute(base, 'actor');
    expect(result).toMatchObject({ id: 'loan-1', status: 'ACTIVE', plan: [{ sequence: 1 }] });
    expect(fake.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(fake.manager.transaction).toHaveBeenCalledTimes(1);
    const inserts = fake.calls.filter(({ sql }) => sql.startsWith('INSERT INTO'));
    expect(inserts.map(({ sql }) => sql.match(/^INSERT INTO (\w+)/)?.[1])).toEqual([
      'loans', 'loan_status_history', 'payment_plan_entries', 'loan_disbursements',
    ]);
    expect(inserts.slice(0, 2).map(({ scope }) => scope)).toEqual(['savepoint', 'savepoint']);
    expect(inserts[0].sql).toContain("'ACTIVE'");
    expect(inserts[0].sql).toContain('RETURNING id, created_at, created_by_user_id');
    expect(inserts[0].params[8]).toBe('actor');
    expect(inserts[1]).toMatchObject({ params: ['loan-1', createdAt, 'actor'] });
    expect(inserts[1].sql).toMatch(/\(loan_id, event_sequence, event_kind, from_status, to_status, changed_at, changed_by_user_id, reason, payment_id, payment_annulment_id\) VALUES \(\$1,1,'CREATED',NULL,'ACTIVE',\$2,\$3,NULL,NULL,NULL\)/);
    expect(fake.calls.some(({ sql }) => sql.includes('MAX(event_sequence)'))).toBe(false);
    expect(fake.state()).toMatchObject({ loans: [{ id: 'loan-1' }], history: [{ params: ['loan-1', createdAt, 'actor'] }], plans: 1, disbursements: 1, cash: 1 });
    expect(fake.cash.recordWithManager).toHaveBeenCalledWith(fake.manager, expect.objectContaining({ concept: 'LOAN_DISBURSEMENT', loanDisbursementId: 'disbursement-1', amount: '100.00' }));
  });

  it('returns the same logical detail for same-key/same-fingerprint replay without creating another event', async () => {
    const fake = fakeTransactions();
    const first = await fake.useCase.execute(base, 'actor');
    const replay = await fake.useCase.execute(base, 'actor');
    expect(replay).toEqual(first);
    expect(fake.state()).toMatchObject({ plans: 1, disbursements: 1, cash: 1 });
    expect(fake.state().history).toHaveLength(1);
    expect(fake.nested.query).toHaveBeenCalledTimes(2);
    expect(fake.cash.recordWithManager).toHaveBeenCalledTimes(1);
  });

  it('starts two different loans at event 1 without reading a maximum or sharing sequence state', async () => {
    const fake = fakeTransactions();
    await fake.useCase.execute(base, 'actor');
    await fake.useCase.execute({ ...base, idempotencyKey: 'other-key' }, 'actor');
    expect(fake.state().history.map(({ params }) => params[0])).toEqual(['loan-1', 'loan-2']);
    expect(fake.state().history.every(({ sql }) => sql.includes('VALUES ($1,1,'))).toBe(true);
    expect(fake.calls.some(({ sql }) => sql.includes('MAX(event_sequence)'))).toBe(false);
  });

  it('uses the actor returned by the Loan insert for CREATED rather than the request actor', async () => {
    const fake = fakeTransactions(undefined, 'persisted-actor');
    await fake.useCase.execute(base, 'request-actor');
    expect(fake.state().history[0].params).toEqual(['loan-1', createdAt, 'persisted-actor']);
    expect(fake.calls.find(({ sql }) => sql.startsWith('INSERT INTO loans'))?.params[8]).toBe('request-actor');
  });

  it('rejects reuse of a key with a different fingerprint without inserting new history', async () => {
    const fake = fakeTransactions();
    await fake.useCase.execute(base, 'actor');
    await expect(fake.useCase.execute({ ...base, principal: '101.00', plan: [{ ...base.plan[0], pendingAmount: '111.00' }] }, 'actor')).rejects.toBeInstanceOf(LoanConflictError);
    expect(fake.state().history).toHaveLength(1);
    expect(fake.cash.recordWithManager).toHaveBeenCalledTimes(1);
  });

  it.each(['historyUnique', 'historyOther'] as const)('rolls back a loan after %s failure instead of translating it as an idempotency race', async (failure) => {
    const fake = fakeTransactions(failure);
    await expect(fake.useCase.execute(base, 'actor')).rejects.toMatchObject(failure === 'historyUnique' ? { code: '23505', constraint: 'UQ_loan_status_history_created' } : { message: 'History insert failed' });
    expect(fake.state()).toEqual(empty());
    expect(fake.rollbacks()).toEqual({ outer: 1, savepoint: 1 });
    expect(fake.calls.filter(({ sql }) => sql.startsWith('SELECT id, idempotency_fingerprint'))).toHaveLength(1);
    expect(fake.cash.recordWithManager).not.toHaveBeenCalled();
  });

  it('does not create history when the loan INSERT fails, including other unique constraints', async () => {
    const fake = fakeTransactions('loan');
    await expect(fake.useCase.execute(base, 'actor')).rejects.toMatchObject({ code: '23505', constraint: 'UQ_loans_number' });
    expect(fake.state()).toEqual(empty());
    expect(fake.rollbacks()).toEqual({ outer: 1, savepoint: 1 });
    expect(fake.calls.some(({ sql }) => sql.startsWith('INSERT INTO loan_status_history'))).toBe(false);
  });

  it.each(['plan', 'cash'] as const)('rolls back loan and history if subsequent %s work fails', async (failure) => {
    const fake = fakeTransactions(failure);
    await expect(fake.useCase.execute(base, 'actor')).rejects.toThrow();
    expect(fake.state()).toEqual(empty());
    expect(fake.rollbacks()).toMatchObject({ outer: 1 });
    expect(fake.calls.filter(({ sql }) => sql.startsWith('INSERT INTO loan_status_history'))).toHaveLength(1);
  });
});
