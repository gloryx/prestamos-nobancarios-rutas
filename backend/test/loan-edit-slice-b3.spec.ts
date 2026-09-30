import type { DataSource } from 'typeorm';
import { EditLoanUseCase, LoanEditConflictError, LoanEditNotFoundError,
  LoanEditValidationError, type LockedEditLoan } from '../src/application/loan/edit-loan.use-case';
import { normalizeLoanEditCommand } from '../src/application/loan/loan-edit.command';
import type { LoanEditInput } from '../src/domain/loan/loan-edit.types';
import { EditLoanTypeormWriter } from '../src/infrastructure/database/typeorm/repositories/edit-loan.writer';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { LoanEditIdempotencyConflictError } from '../src/infrastructure/database/typeorm/repositories/loan-edit-operations.repository';

const LOAN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const SECOND_ACTOR = '44444444-4444-4444-8444-444444444444';
const FREQUENCY = '55555555-5555-4555-8555-555555555555';
const NEW_FREQUENCY = '66666666-6666-4666-8666-666666666666';
const METHOD = '77777777-7777-4777-8777-777777777777';
const NEW_METHOD = '88888888-8888-4888-8888-888888888888';
const FIRST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ZERO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const createdAt = new Date('2026-09-29T12:00:00Z');
type Plan = { id: string; dueDate: string; pendingAmount: string; sequence: number };
type Payment = { status: 'VALID' | 'ANNULLED'; amount: string; principal: string; interest: string };
type Operation = { operationId: string; loanId: string; actorId: string; fingerprint: string; createdAt: Date };
type MutableLoan = { -readonly [K in keyof LockedEditLoan]: LockedEditLoan[K] } & { updatedAt: number };
type State = { loans: Record<string, MutableLoan>; plan: Plan[];
  payments: Payment[]; operations: Record<string, Operation>; activeFrequencies: string[]; activeMethods: string[] };
type Call = { sql: string; args: unknown[]; manager: object };
const money = (amount: bigint) => `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
const cents = (amount: string) => { const [whole, decimal = ''] = amount.split('.'); return BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0')); };
const changed = (calls: Call[]) => calls.filter(({ sql }) => /^(UPDATE|INSERT|DELETE)\b/.test(sql));

function initial(): State {
  const loan = { id: LOAN, status: 'ACTIVE', startDate: '2026-01-01', principal: '100.00', interestAmount: '20.00', totalAmount: '120.00',
    paymentFrequencyId: FREQUENCY, preferredPaymentMethodId: METHOD, observations: 'ORIGINAL', updatedAt: 1 };
  return { loans: { [LOAN]: loan, [OTHER]: { ...loan, id: OTHER } }, plan: [
    { id: FIRST, dueDate: '2026-10-01', pendingAmount: '60.00', sequence: 2 },
    { id: SECOND, dueDate: '2026-11-01', pendingAmount: '34.50', sequence: 3 },
    { id: ZERO, dueDate: '2026-09-01', pendingAmount: '0.00', sequence: 1 },
  ], payments: [{ status: 'VALID', amount: '25.50', principal: '20.00', interest: '5.50' },
    { status: 'ANNULLED', amount: '8.00', principal: '8.00', interest: '0.00' }],
  operations: {}, activeFrequencies: [FREQUENCY, NEW_FREQUENCY], activeMethods: [METHOD, NEW_METHOD] };
}
function input(changes: LoanEditInput['changes'] = { observations: ' revised ' }): LoanEditInput {
  return { idempotencyKey: 'edit-key', baseline: { interestAmount: '20.00', paymentFrequencyId: FREQUENCY,
    preferredPaymentMethodId: METHOD, observations: 'ORIGINAL', financialBalance: '94.50', plan: [
      { id: FIRST, dueDate: '2026-10-01', pendingAmount: '60.00' },
      { id: SECOND, dueDate: '2026-11-01', pendingAmount: '34.50' },
    ] }, changes };
}

function setup() {
  let committed = initial(); let rollbacks = 0;
  let failClaim: Error | undefined; let missingTotals = false; let failUpdate = false;
  let tamperFinal: ((state: State) => void) | undefined;
  let race: ((attempt: Operation) => Operation | null) | undefined;
  const calls: Call[] = []; const managers: object[] = [];
  const source = { transaction: jest.fn(async <T>(run: (manager: { query: (sql: string, args?: unknown[]) => Promise<unknown> }) => Promise<T>) => {
    const staged = structuredClone(committed);
    let loanReads = 0;
    const manager = { query: async (sql: string, args: unknown[] = []): Promise<unknown> => {
      calls.push({ sql, args, manager });
      if (sql.includes('FROM loans WHERE id = $1 FOR UPDATE')) {
        if (loanReads++ && tamperFinal) tamperFinal(staged);
        const row = staged.loans[String(args[0]).toLowerCase()]; return row ? [{ ...row }] : [];
      }
      if (sql.includes('FROM loan_edit_operations WHERE idempotency_key')) {
        const row = staged.operations[String(args[0])] ?? committed.operations[String(args[0])]; return row ? [row] : [];
      }
      if (sql.startsWith('SELECT COALESCE(SUM(pending_amount)')) return [{ pendingAmount: money(staged.plan.reduce((sum, row) => sum + cents(row.pendingAmount), 0n)) }];
      if (sql.includes('FROM payment_plan_entries')) return structuredClone(staged.plan.filter((row) => !sql.includes('pending_amount > 0') || cents(row.pendingAmount) > 0n));
      if (sql.includes('FROM payments WHERE loan_id')) {
        if (missingTotals) return [];
        const valid = staged.payments.filter((item) => item.status === 'VALID');
        const sum = (field: 'amount' | 'principal' | 'interest') => money(valid.reduce((total, item) => total + cents(item[field]), 0n));
        return [{ paidAmount: sum('amount'), paidPrincipal: sum('principal'), paidInterest: sum('interest'),
          invalidCount: valid.filter((item) => cents(item.amount) <= 0n || cents(item.principal) < 0n
            || cents(item.interest) < 0n || cents(item.amount) !== cents(item.principal) + cents(item.interest)).length }];
      }
      if (sql.includes('FROM payment_frequencies')) return staged.activeFrequencies.includes(String(args[0])) ? [{ id: args[0] }] : [];
      if (sql.includes('FROM payment_methods')) return staged.activeMethods.includes(String(args[0])) ? [{ id: args[0] }] : [];
      if (sql.startsWith('UPDATE loans SET')) {
        const id = String(args.at(-1));
        if (failUpdate || staged.loans[id]?.status !== 'ACTIVE') return [[], 0];
        const row = staged.loans[id];
        for (const [column, property] of [['payment_frequency_id', 'paymentFrequencyId'], ['preferred_payment_method_id', 'preferredPaymentMethodId'], ['observations', 'observations'], ['interest_amount', 'interestAmount'], ['total_amount', 'totalAmount']] as const) {
          const match = sql.match(new RegExp(`${column} = \\$(\\d+)`));
          if (match) Object.assign(row, { [property]: args[Number(match[1]) - 1] });
        }
        row.updatedAt++; return [[{ id }], 1];
      }
      if (sql.startsWith('INSERT INTO payment_plan_entries')) {
        staged.plan.push({ id: staged.plan.some((row) => row.id === 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
          ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' : 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        sequence: args[1] as number, dueDate: args[2] as string, pendingAmount: args[3] as string }); return [];
      }
      if (sql.startsWith('UPDATE payment_plan_entries SET')) {
        const closing = sql.includes('pending_amount = 0');
        const row = staged.plan.find((entry) => entry.id === args[closing ? 0 : 2] && cents(entry.pendingAmount) > 0n);
        if (!row) return [[], 0];
        if (closing) row.pendingAmount = '0.00';
        else { row.dueDate = args[0] as string; row.pendingAmount = args[1] as string; }
        return [[{ id: row.id }], 1];
      }
      if (sql.startsWith('INSERT INTO loan_edit_operations')) {
        if (failClaim) throw failClaim;
        const attempt: Operation = { operationId: 'operation-1', loanId: String(args[0]), actorId: String(args[1]),
          fingerprint: String(args[3]), createdAt };
        if (race) { const winner = race(attempt); if (winner) committed.operations[String(args[2])] = winner; return []; }
        if (committed.operations[String(args[2])] || staged.operations[String(args[2])]) return [];
        staged.operations[String(args[2])] = attempt; return [attempt];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    } };
    managers.push(manager);
    try { const result = await run(manager); committed = staged; return result; }
    catch (error) { rollbacks++; throw error; }
  }) };
  const useCase = new EditLoanUseCase(new EditLoanTypeormWriter(source as unknown as DataSource), new LoanFinancialTotalsTypeormReader());
  const execute = (body: LoanEditInput = input(), loan = LOAN, actor = ACTOR) => useCase.execute(normalizeLoanEditCommand(body, loan, actor));
  return { execute, source, calls, managers, state: () => committed, rollbacks: () => rollbacks,
    set: (edit: (state: State) => void) => { const copy = structuredClone(committed); edit(copy); committed = copy; },
    failClaim: (error: Error) => { failClaim = error; }, missingTotals: () => { missingTotals = true; },
    failUpdate: () => { failUpdate = true; }, race: (winner: (attempt: Operation) => Operation | null) => { race = winner; },
    tamperFinal: (edit: (state: State) => void) => { tamperFinal = edit; } };
}

describe('B3 internal ACTIVE loan edit (staged transactional entity manager)', () => {
  it('changes only normalized observations, clears null/blank, and preserves omission while editing a reference', async () => {
    for (const value of ['  revised ', null, '   '] as const) {
      const fake = setup(); const receipt = await fake.execute(input({ observations: value }));
      expect(receipt).toEqual({ operationId: 'operation-1', loanId: LOAN, createdAt });
      expect(fake.state().loans[LOAN]).toMatchObject({ observations: value?.trim() ? 'REVISED' : null, updatedAt: 2,
        status: 'ACTIVE', interestAmount: '20.00', totalAmount: '120.00' });
      expect(changed(fake.calls).map(({ sql }) => sql.split(' ')[0])).toEqual(['UPDATE', 'INSERT']);
      expect(fake.calls.find(({ sql }) => sql.startsWith('UPDATE'))?.sql).toMatch(/SET observations = \$1, updated_at = now\(\)/);
    }
    const fake = setup(); await fake.execute(input({ paymentFrequencyId: NEW_FREQUENCY }));
    expect(fake.state().loans[LOAN].observations).toBe('ORIGINAL');
    expect(fake.calls.find(({ sql }) => sql.startsWith('UPDATE'))?.sql).not.toContain('observations =');
  });

  it('accepts active changed frequency/method; checks only changed targets, not inactive unchanged references', async () => {
    const fake = setup(); fake.set((s) => { s.activeFrequencies = [NEW_FREQUENCY]; s.activeMethods = [NEW_METHOD]; });
    await fake.execute(input({ paymentFrequencyId: FREQUENCY, preferredPaymentMethodId: METHOD, observations: 'new' }));
    expect(fake.calls.some(({ sql }) => sql.includes('FROM payment_frequencies') || sql.includes('FROM payment_methods'))).toBe(false);
    const next = setup(); await next.execute(input({ paymentFrequencyId: NEW_FREQUENCY, preferredPaymentMethodId: NEW_METHOD }));
    expect(next.state().loans[LOAN]).toMatchObject({ paymentFrequencyId: NEW_FREQUENCY, preferredPaymentMethodId: NEW_METHOD });
    expect(next.calls.filter(({ sql }) => sql.includes('is_active = true')).map(({ sql }) => sql)).toEqual([
      expect.stringContaining('payment_frequencies'), expect.stringContaining('payment_methods')]);
    expect(next.calls.find(({ sql }) => sql.startsWith('UPDATE'))?.args).toEqual([NEW_FREQUENCY, NEW_METHOD, LOAN]);
  });

  it.each([['frequency', { paymentFrequencyId: NEW_FREQUENCY }], ['method', { preferredPaymentMethodId: NEW_METHOD }]] as const)
  ('rejects an inactive or missing changed %s before any write', async (kind, changes) => {
    const fake = setup(); fake.set((s) => { if (kind === 'frequency') s.activeFrequencies = [FREQUENCY]; else s.activeMethods = [METHOD]; });
    const before = structuredClone(fake.state());
    await expect(fake.execute(input(changes))).rejects.toBeInstanceOf(LoanEditValidationError);
    expect(fake.state()).toEqual(before); expect(changed(fake.calls)).toEqual([]);
  });

  it.each(['CANCELLED', 'REFINANCED', 'UNCOLLECTIBLE', 'ANNULLED'])('accepts only ACTIVE, not %s', async (status) => {
    const fake = setup(); fake.set((s) => { s.loans[LOAN].status = status; });
    await expect(fake.execute()).rejects.toBeInstanceOf(LoanEditConflictError);
    expect(changed(fake.calls)).toEqual([]);
    expect(fake.calls.map(({ sql }) => sql)).toEqual([expect.stringContaining('FOR UPDATE'), expect.stringContaining('FROM loan_edit_operations')]);
  });

  it('returns not found before replay or mutation when the requested loan is absent', async () => {
    const fake = setup(); await expect(fake.execute(input(), '99999999-9999-4999-8999-999999999999')).rejects.toBeInstanceOf(LoanEditNotFoundError);
    expect(fake.calls).toHaveLength(1); expect(changed(fake.calls)).toEqual([]);
  });

  it.each([
    ['interest', (s: State) => { s.loans[LOAN].interestAmount = '21.00'; s.loans[LOAN].totalAmount = '121.00'; s.plan[1].pendingAmount = '35.50'; }],
    ['frequency', (s: State) => { s.loans[LOAN].paymentFrequencyId = NEW_FREQUENCY; }],
    ['method', (s: State) => { s.loans[LOAN].preferredPaymentMethodId = NEW_METHOD; }],
    ['observations', (s: State) => { s.loans[LOAN].observations = 'OTHER'; }],
    ['payment balance', (s: State) => { s.payments[0].amount = '26.50'; s.payments[0].principal = '21.00'; s.plan[1].pendingAmount = '33.50'; }],
    ['annulment balance', (s: State) => { s.payments[0].status = 'ANNULLED'; s.plan[1].pendingAmount = '60.00'; }],
    ['row ID', (s: State) => { s.plan[0].id = ZERO; }],
    ['row date', (s: State) => { s.plan[0].dueDate = '2026-10-02'; }],
    ['row amount', (s: State) => { s.plan[0].pendingAmount = '61.00'; s.plan[1].pendingAmount = '33.50'; }],
    ['row removed', (s: State) => { s.plan[0].pendingAmount = '0.00'; s.plan[1].pendingAmount = '94.50'; }],
    ['row added', (s: State) => { s.plan[2].pendingAmount = '1.00'; s.plan[1].pendingAmount = '33.50'; }],
  ] as const)('rejects stale %s baseline after checking integrity, without writes', async (_, edit) => {
    const fake = setup(); fake.set(edit); const before = structuredClone(fake.state());
    await expect(fake.execute()).rejects.toBeInstanceOf(LoanEditConflictError);
    expect(fake.state()).toEqual(before); expect(changed(fake.calls)).toEqual([]);
  });

  it('matches reordered baseline and display equivalents, excluding zero rows and ANNULLED payments', async () => {
    const fake = setup(); const body = input();
    await fake.execute({ ...body, baseline: { ...body.baseline, plan: [...body.baseline.plan].reverse(),
      financialBalance: '94.5', interestAmount: '20', observations: ' original ', paymentFrequencyId: FREQUENCY.toUpperCase() } });
    expect(fake.state().operations['edit-key']).toMatchObject({ loanId: LOAN });
    expect(fake.calls.filter(({ sql }) => sql.includes('FROM payments WHERE loan_id'))).toHaveLength(1);
    expect(fake.calls.find(({ sql }) => sql.includes('FROM payments WHERE loan_id'))?.sql).toContain("status = 'VALID'");
    expect(fake.calls.every(({ manager }) => manager === fake.managers[0])).toBe(true);
    expect(fake.calls.map(({ sql }) => sql.match(/FROM (\w+)|^UPDATE (\w+)|^INSERT INTO (\w+)/)?.slice(1).find(Boolean)))
      .toEqual(['loans', 'loan_edit_operations', 'payment_plan_entries', 'payments', 'loans', 'loan_edit_operations']);
  });

  it.each([
    ['pending mismatch', (s: State) => { s.plan[1].pendingAmount = '34.49'; }],
    ['overapplied components', (s: State) => { s.payments[0].principal = '26.00'; s.payments[0].interest = '-0.50'; }],
    ['negative plan row', (s: State) => { s.plan[2].pendingAmount = '-1.00'; }],
    ['invalid positive date', (s: State) => { s.plan[1].dueDate = '2026-02-30'; }],
    ['duplicate positive row', (s: State) => { s.plan[1].id = FIRST; }],
  ] as const)('fails closed on preexisting %s without attempting repair', async (_, edit) => {
    const fake = setup(); fake.set(edit); const before = structuredClone(fake.state());
    await expect(fake.execute()).rejects.toBeInstanceOf(LoanEditConflictError);
    expect(fake.state()).toEqual(before); expect(changed(fake.calls)).toEqual([]);
  });

  it('fails closed when canonical payment totals are unavailable', async () => {
    const fake = setup(); fake.missingTotals();
    await expect(fake.execute()).rejects.toBeInstanceOf(LoanEditConflictError);
    expect(changed(fake.calls)).toEqual([]);
  });

  it('rejects plans without changed interest, changed interest without a plan, and no-ops; permits equal interest with an admin edit', async () => {
    for (const body of [{ ...input(), plan: [] }, { ...input(), plan: [input().baseline.plan[0]] }]) {
      const fake = setup(); await expect(fake.execute(body)).rejects.toBeInstanceOf(LoanEditValidationError);
      expect(changed(fake.calls)).toEqual([]);
    }
    const changedInterest = setup();
    await expect(changedInterest.execute(input({ interestAmount: '20.01', observations: 'new' })))
      .rejects.toBeInstanceOf(LoanEditValidationError);
    expect(changed(changedInterest.calls)).toEqual([]);
    for (const changes of [{ interestAmount: '20.00' }, { observations: ' original ' }, { paymentFrequencyId: FREQUENCY }]) {
      const fake = setup(); await expect(fake.execute(input(changes))).rejects.toBeInstanceOf(LoanEditValidationError);
      expect(fake.state().operations).toEqual({}); expect(changed(fake.calls)).toEqual([]);
    }
    const equal = setup(); await equal.execute(input({ interestAmount: '20', observations: null }));
    expect(equal.state().loans[LOAN]).toMatchObject({ interestAmount: '20.00', observations: null });
  });

  it('replays the persisted receipt before status, totals, baseline or unsupported-plan checks without another update', async () => {
    const fake = setup(); const body = input(); const original = await fake.execute(body);
    fake.set((s) => { s.loans[LOAN].status = 'CANCELLED'; s.loans[LOAN].interestAmount = '40.00'; s.plan = []; });
    const start = fake.calls.length;
    expect(await fake.execute(body)).toEqual(original);
    expect(fake.calls.slice(start).map(({ sql }) => sql)).toEqual([expect.stringContaining('FOR UPDATE'), expect.stringContaining('FROM loan_edit_operations')]);
    expect(fake.state().operations['edit-key'].createdAt).toEqual(original.createdAt);
    expect(fake.state().loans[LOAN].updatedAt).toBe(2);
  });

  it.each([['fingerprint', input({ observations: 'different' }), LOAN, ACTOR],
    ['loan', input(), OTHER, ACTOR], ['actor', input(), LOAN, SECOND_ACTOR]] as const)
  ('rejects a replay with mismatched %s globally, even if loan is nonACTIVE', async (_, body, loan, actor) => {
    const fake = setup(); await fake.execute(); fake.set((s) => { s.loans[loan].status = 'ANNULLED'; });
    const before = structuredClone(fake.state()); const start = fake.calls.length;
    await expect(fake.execute(body, loan, actor)).rejects.toBeInstanceOf(LoanEditIdempotencyConflictError);
    expect(fake.state()).toEqual(before); expect(changed(fake.calls.slice(start))).toEqual([]);
  });

  it('rolls back the admin UPDATE and has no receipt if the claim fails; propagates unexpected DB errors', async () => {
    const fake = setup(); const before = structuredClone(fake.state()); const failure = new Error('database unavailable');
    fake.failClaim(failure); await expect(fake.execute()).rejects.toBe(failure);
    expect(fake.state()).toEqual(before); expect(fake.rollbacks()).toBe(1);
    expect(changed(fake.calls).map(({ sql }) => sql.split(' ')[0])).toEqual(['UPDATE', 'INSERT']);
    expect(fake.source.transaction).toHaveBeenCalledTimes(1);
  });

  it('rolls back on an unexpected zero-row conditional UPDATE without claiming', async () => {
    const fake = setup(); fake.failUpdate(); const before = structuredClone(fake.state());
    await expect(fake.execute()).rejects.toBeInstanceOf(LoanEditConflictError);
    expect(fake.state()).toEqual(before); expect(changed(fake.calls)).toHaveLength(1);
  });

  it('recovers a matching committed winner only after rollback, using a fresh manager', async () => {
    const fake = setup(); let winner: Operation | undefined;
    fake.race((attempt) => { winner = { ...attempt, operationId: 'winner', createdAt: new Date('2026-09-29T14:00:00Z') }; return winner; });
    expect(await fake.execute()).toEqual({ operationId: 'winner', loanId: LOAN, createdAt: winner?.createdAt });
    expect(fake.rollbacks()).toBe(1); expect(fake.source.transaction).toHaveBeenCalledTimes(2);
    expect(fake.state().loans[LOAN]).toMatchObject({ observations: 'ORIGINAL', updatedAt: 1 });
    expect(fake.state().operations['edit-key']).toEqual(winner);
    expect(fake.managers[0]).not.toBe(fake.managers[1]);
    expect(fake.calls.slice(-1)[0]).toMatchObject({ manager: fake.managers[1], sql: expect.stringContaining('FROM loan_edit_operations') });
    expect(changed(fake.calls).map(({ sql }) => sql.split(' ')[0])).toEqual(['UPDATE', 'INSERT']);
  });

  it.each([['other loan', (row: Operation) => ({ ...row, loanId: OTHER })],
    ['other actor', (row: Operation) => ({ ...row, actorId: SECOND_ACTOR })],
    ['other fingerprint', (row: Operation) => ({ ...row, fingerprint: 'f'.repeat(64) })]] as const)
  ('rejects a global losing-claim race against %s after rolling back the admin UPDATE', async (_, winner) => {
    const fake = setup(); fake.race(winner);
    await expect(fake.execute()).rejects.toBeInstanceOf(LoanEditIdempotencyConflictError);
    expect(fake.rollbacks()).toBe(2); expect(fake.state().loans[LOAN].updatedAt).toBe(1);
    expect(fake.state().operations['edit-key']).toMatchObject({ operationId: 'operation-1' });
    expect(fake.managers).toHaveLength(2);
  });

  it('turns an unresolvable losing claim into a controlled conflict, not a silent success', async () => {
    const fake = setup(); fake.race(() => null);
    await expect(fake.execute()).rejects.toBeInstanceOf(LoanEditConflictError);
    expect(fake.state().loans[LOAN].updatedAt).toBe(1); expect(fake.state().operations).toEqual({});
    expect(fake.managers).toHaveLength(2);
  });
});

const financial = (interestAmount: string, plan: LoanEditInput['plan'], changes: LoanEditInput['changes'] = {}) =>
  ({ ...input(), changes: { interestAmount, ...changes }, plan });
const increase = () => financial('30.00', [
  { id: FIRST, dueDate: '2026-10-01', pendingAmount: '60.00' },
  { id: SECOND, dueDate: '2026-11-01', pendingAmount: '44.50' },
]);

describe('B4 internal interest and plan edit (real B1 helper, staged manager)', () => {
  it('increases interest with the canonical balance and rechecks persisted Loan, plan and VALID totals before claiming', async () => {
    const fake = setup(); const original = structuredClone(fake.state());
    expect(await fake.execute(increase())).toEqual({ operationId: 'operation-1', loanId: LOAN, createdAt });
    expect(fake.state().loans[LOAN]).toMatchObject({ principal: original.loans[LOAN].principal, startDate: '2026-01-01',
      status: 'ACTIVE', interestAmount: '30.00', totalAmount: '130.00', updatedAt: 2 });
    expect(fake.state().plan.map((row) => [row.id, row.pendingAmount])).toEqual([
      [FIRST, '60.00'], [SECOND, '44.50'], [ZERO, '0.00']]);
    expect(fake.state().payments).toEqual(original.payments);
    expect(fake.calls.filter(({ sql }) => sql.includes('FROM loans WHERE id = $1 FOR UPDATE'))).toHaveLength(2);
    expect(fake.calls.filter(({ sql }) => sql.includes('FROM payments WHERE loan_id'))).toHaveLength(2);
    expect(fake.calls.filter(({ sql }) => sql.includes('FROM payment_plan_entries'))).toHaveLength(5);
    expect(fake.calls.every(({ manager }) => manager === fake.managers[0])).toBe(true);
    expect(changed(fake.calls).map(({ sql }) => sql.split(' ')[0])).toEqual(['UPDATE', 'UPDATE', 'UPDATE', 'INSERT']);
    expect(fake.calls.find(({ sql }) => sql.startsWith('UPDATE loans SET'))?.sql).toMatch(/interest_amount = \$1::numeric\(18,2\), total_amount = \$2::numeric\(18,2\), updated_at = now\(\)/);
    expect(changed(fake.calls).every(({ sql }) => !/^(UPDATE|INSERT) (payments|payment_applications|payment_annulments|loan_disbursements|cash_movements|loan_status_history)/.test(sql))).toBe(true);
  });

  it('permits a legal interest decrease down to VALID interest applied and preserves the status', async () => {
    const fake = setup(); await fake.execute(financial('5.50', [
      { id: FIRST, dueDate: '2026-10-01', pendingAmount: '60.00' },
      { id: SECOND, dueDate: '2026-11-01', pendingAmount: '20.00' },
    ]));
    expect(fake.state().loans[LOAN]).toMatchObject({ status: 'ACTIVE', interestAmount: '5.50', totalAmount: '105.50' });
    expect(fake.state().plan[1].pendingAmount).toBe('20.00');
  });

  it('rejects interest below VALID applied and a new total below VALID paid before writing', async () => {
    const below = setup();
    await expect(below.execute(financial('5.49', []))).rejects.toBeInstanceOf(LoanEditValidationError);
    expect(changed(below.calls)).toEqual([]);
    const paid = setup(); paid.set((s) => {
      s.payments[0] = { status: 'VALID', amount: '120.00', principal: '100.00', interest: '20.00' };
      s.plan[0].pendingAmount = '0.00'; s.plan[1].pendingAmount = '0.00';
    });
    await expect(paid.execute({ ...financial('0', []), baseline: { ...input().baseline, financialBalance: '0', plan: [] } }))
      .rejects.toBeInstanceOf(LoanEditValidationError);
    expect(changed(paid.calls)).toEqual([]);
  });

  it('accepts a zero target with an empty plan by closing positive rows, without cancelling the loan', async () => {
    const fake = setup(); fake.set((s) => {
      s.payments[0] = { status: 'VALID', amount: '105.50', principal: '100.00', interest: '5.50' };
      s.plan[0].pendingAmount = '14.50'; s.plan[1].pendingAmount = '0.00';
    });
    const body = { ...financial('5.50', []), baseline: { ...input().baseline, financialBalance: '14.50',
      plan: [{ id: FIRST, dueDate: '2026-10-01', pendingAmount: '14.50' }] } };
    await fake.execute(body);
    expect(fake.state().loans[LOAN]).toMatchObject({ status: 'ACTIVE', interestAmount: '5.50', totalAmount: '105.50' });
    expect(fake.state().plan.map((row) => row.pendingAmount)).toEqual(['0.00', '0.00', '0.00']);
    expect(fake.calls.filter(({ sql }) => sql.startsWith('UPDATE payment_plan_entries SET pending_amount = 0'))).toHaveLength(1);
  });

  it('uses B1 identity, ordering, soft-close and MAX sequence including zero history for a mixed draft', async () => {
    const fake = setup(); fake.set((s) => { s.plan[2].sequence = 8; });
    await fake.execute(financial('30.00', [
      { id: null, dueDate: '2026-09-01', pendingAmount: '44.50' },
      { id: FIRST, dueDate: '2026-12-01', pendingAmount: '60.00' },
    ]));
    expect(fake.state().plan.find((row) => row.id === FIRST)).toMatchObject({ dueDate: '2026-12-01', pendingAmount: '60.00', sequence: 2 });
    expect(fake.state().plan.find((row) => row.id === SECOND)?.pendingAmount).toBe('0.00');
    expect(fake.state().plan.find((row) => row.id === ZERO)).toMatchObject({ sequence: 8, pendingAmount: '0.00' });
    expect(fake.state().plan.find((row) => row.id.startsWith('dddd'))).toMatchObject({ dueDate: '2026-09-01', sequence: 9, pendingAmount: '44.50' });
    expect(fake.calls.find(({ sql }) => sql.startsWith('INSERT INTO payment_plan_entries'))?.args[1]).toBe(9);
  });

  it('validates changed active admin targets before plan writes, then commits admin and finance together', async () => {
    const invalid = setup(); invalid.set((s) => { s.activeFrequencies = [FREQUENCY]; });
    await expect(invalid.execute(financial('30.00', increase().plan, { paymentFrequencyId: NEW_FREQUENCY })))
      .rejects.toBeInstanceOf(LoanEditValidationError);
    expect(changed(invalid.calls)).toEqual([]);
    const fake = setup(); await fake.execute(financial('30.00', increase().plan,
      { paymentFrequencyId: NEW_FREQUENCY, preferredPaymentMethodId: NEW_METHOD, observations: null }));
    expect(fake.state().loans[LOAN]).toMatchObject({ paymentFrequencyId: NEW_FREQUENCY,
      preferredPaymentMethodId: NEW_METHOD, observations: null, interestAmount: '30.00', totalAmount: '130.00' });
    expect(fake.calls.find(({ sql }) => sql.startsWith('UPDATE loans SET'))?.args).toEqual([
      NEW_FREQUENCY, NEW_METHOD, null, '30.00', '130.00', LOAN]);
  });

  it('rejects missing plans, equal-interest plans, and equal-interest no-ops; keeps equal-interest admin-only edits cheap', async () => {
    for (const body of [financial('30.00', undefined), financial('20.00', increase().plan), financial('20.00', [])]) {
      const fake = setup(); await expect(fake.execute(body)).rejects.toBeInstanceOf(LoanEditValidationError);
      expect(changed(fake.calls)).toEqual([]);
    }
    const noOp = setup(); await expect(noOp.execute(financial('20.00', undefined)))
      .rejects.toBeInstanceOf(LoanEditValidationError);
    const equal = setup(); await equal.execute(financial('20', undefined, { observations: 'new' }));
    expect(equal.state().loans[LOAN]).toMatchObject({ interestAmount: '20.00', totalAmount: '120.00', observations: 'NEW' });
    expect(equal.calls.filter(({ sql }) => sql.includes('FROM payments WHERE loan_id'))).toHaveLength(1);
    expect(changed(equal.calls).map(({ sql }) => sql.split(' ')[0])).toEqual(['UPDATE', 'INSERT']);
    expect(equal.calls.find(({ sql }) => sql.startsWith('UPDATE loans SET'))?.sql).not.toContain('interest_amount =');
  });

  it.each([
    ['wrong sum', [{ id: FIRST, dueDate: '2026-10-01', pendingAmount: '60.00' }]],
    ['foreign ID', [{ id: OTHER, dueDate: '2026-10-01', pendingAmount: '104.50' }]],
    ['date before start', [{ id: FIRST, dueDate: '2025-12-31', pendingAmount: '104.50' }]],
  ] as const)('rolls back invalid %s drafts without a Loan UPDATE or receipt', async (_, plan) => {
    const fake = setup(); const before = structuredClone(fake.state());
    await expect(fake.execute(financial('30.00', plan))).rejects.toThrow();
    expect(fake.state()).toEqual(before); expect(changed(fake.calls)).toEqual([]);
    expect(fake.rollbacks()).toBe(1);
  });

  it.each([
    ['payment', (s: State) => { s.payments[0].amount = '26.50'; s.payments[0].principal = '21.00'; s.plan[1].pendingAmount = '33.50'; }],
    ['plan', (s: State) => { s.plan[0].dueDate = '2026-10-02'; }],
    ['interest', (s: State) => { s.loans[LOAN].interestAmount = '21.00'; s.loans[LOAN].totalAmount = '121.00'; s.plan[1].pendingAmount = '35.50'; }],
    ['status', (s: State) => { s.loans[LOAN].status = 'CANCELLED'; }],
  ] as const)('rejects a concurrent %s edit against the opening baseline', async (_, edit) => {
    const fake = setup(); fake.set(edit); const before = structuredClone(fake.state());
    await expect(fake.execute(increase())).rejects.toBeInstanceOf(LoanEditConflictError);
    expect(fake.state()).toEqual(before); expect(changed(fake.calls)).toEqual([]);
  });

  it('replays before status/baseline/plan or totals reads and rejects global-key payload, actor and loan changes', async () => {
    const fake = setup(); const body = increase(); const receipt = await fake.execute(body);
    fake.set((s) => { s.loans[LOAN].status = 'CANCELLED'; s.payments = []; s.plan = []; });
    const start = fake.calls.length;
    expect(await fake.execute(body)).toEqual(receipt);
    expect(fake.calls.slice(start).map(({ sql }) => sql)).toEqual([
      expect.stringContaining('FROM loans WHERE id = $1 FOR UPDATE'), expect.stringContaining('FROM loan_edit_operations')]);
    for (const [draft, loan, actor] of [[financial('31.00', body.plan), LOAN, ACTOR], [body, OTHER, ACTOR], [body, LOAN, SECOND_ACTOR]] as const) {
      await expect(fake.execute(draft, loan, actor)).rejects.toBeInstanceOf(LoanEditIdempotencyConflictError);
    }
    expect(fake.calls.filter(({ sql }) => sql.startsWith('UPDATE payment_plan_entries'))).toHaveLength(2);
  });

  it('rolls back plan edits on Loan UPDATE failure, final persisted integrity failure or claim failure', async () => {
    for (const failure of ['loan', 'final', 'claim'] as const) {
      const fake = setup(); const before = structuredClone(fake.state());
      if (failure === 'loan') fake.failUpdate();
      if (failure === 'final') fake.tamperFinal((s) => { s.plan[0].dueDate = '2026-10-02'; });
      if (failure === 'claim') fake.failClaim(new Error('claim failed'));
      await expect(fake.execute(increase())).rejects.toThrow();
      expect(fake.state()).toEqual(before); expect(fake.rollbacks()).toBe(1);
      expect(changed(fake.calls).some(({ sql }) => sql.startsWith('UPDATE payment_plan_entries'))).toBe(true);
      expect(changed(fake.calls).some(({ sql }) => sql.startsWith('INSERT INTO loan_edit_operations'))).toBe(failure === 'claim');
    }
  });

  it('rejects a preexisting corrupt financial state before attempting interest or plan changes', async () => {
    const fake = setup(); fake.set((s) => { s.payments[0].interest = '25.50'; });
    await expect(fake.execute(increase())).rejects.toBeInstanceOf(LoanEditConflictError);
    expect(changed(fake.calls)).toEqual([]);
  });
});
