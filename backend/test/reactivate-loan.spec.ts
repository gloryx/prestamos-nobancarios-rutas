import 'reflect-metadata';
import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { ReactivateLoanUseCase, REACTIVATE_LOAN_WRITER } from '../src/application/loan/reactivate-loan.use-case';
import { EvaluateUncollectibleEligibilityUseCase } from '../src/application/loan/uncollectible-eligibility.use-case';
import { RegisterPaymentUseCase, CustomizePaymentPlanUseCase } from '../src/application/payment/payment.use-case';
import { paymentFingerprint } from '../src/domain/payment/payment-rules';
import type { UncollectibleEvent } from '../src/application/loan/mark-uncollectible.use-case';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { UncollectibleEligibilityTypeormReader } from '../src/infrastructure/database/typeorm/repositories/uncollectible-eligibility.reader';
import { ReactivateLoanTypeormWriter } from '../src/infrastructure/database/typeorm/repositories/reactivate-loan.writer';
import { LoanController } from '../src/presentation/loan/loan.controller';
import { ReactivateLoanDto } from '../src/presentation/loan/loan.dto';
import { LoanModule } from '../src/presentation/loan/loan.module';
import { PermissionGuard } from '../src/presentation/security/permission.guard';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { PERMISSIONS } from '../src/shared/constants/security';

const LOAN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const SECOND_ACTOR = '44444444-4444-4444-8444-444444444444';
const ROW = '55555555-5555-4555-8555-555555555555';
const FUTURE = '66666666-6666-4666-8666-666666666666';
const changedAt = new Date('2026-02-01T12:34:56.789Z');
type Event = UncollectibleEvent & { key?: string; paymentId?: string | null; paymentAnnulmentId?: string | null };
type Loan = { id: string; status: string; principal: string; interestAmount: string; totalAmount: string; startDate: string };
type Plan = { id: string; loanId: string; sequence: number; dueDate: string; pendingAmount: string };
type Payment = { loanId: string; status: 'VALID' | 'ANNULLED'; amount: string; principalApplied: string; interestApplied: string };
type State = { loans: Record<string, Loan>; plans: Plan[]; payments: Payment[]; cash: string[]; history: Event[] };
type Options = { rawUpdate?: 'zero' | 'zero-count' | 'wrong-id'; failInsert?: boolean; raceKey?: boolean; failRead?: boolean; noFirstRow?: boolean };
const cents = (value: string) => BigInt(value.replace('.', ''));
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const request = (reason = '  Gestión retomada  ', idempotencyKey = '  reactivate:1  ') => ({ reason, idempotencyKey });
const writes = (calls: Array<{ sql: string }>) => calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/.test(sql));
const created = (id: string): Event => ({ id: `created-${id}`, loanId: id, eventSequence: 1, eventKind: 'CREATED', fromStatus: null,
  toStatus: 'ACTIVE', changedAt: new Date('2026-01-01'), changedByUserId: ACTOR, reason: null, idempotencyFingerprint: null });
const initial = (): State => ({ loans: Object.fromEntries([LOAN, OTHER].map((id) => [id,
  { id, status: 'UNCOLLECTIBLE', principal: '100000.00', interestAmount: '20000.00', totalAmount: '120000.00', startDate: '2025-12-01' }])),
  plans: [{ id: ROW, loanId: LOAN, sequence: 4, dueDate: '2026-12-01', pendingAmount: '40000.00' },
    { id: FUTURE, loanId: LOAN, sequence: 9, dueDate: '2027-01-01', pendingAmount: '60000.00' },
    { id: 'historical', loanId: LOAN, sequence: 2, dueDate: '2026-01-01', pendingAmount: '0.00' }],
  payments: [{ loanId: LOAN, status: 'VALID', amount: '20000.00', principalApplied: '15000.00', interestApplied: '5000.00' },
    { loanId: LOAN, status: 'ANNULLED', amount: '30000.00', principalApplied: '25000.00', interestApplied: '5000.00' }],
  cash: ['existing-disbursement'], history: [created(LOAN), { id: 'mark-event', loanId: LOAN, eventSequence: 2, eventKind: 'TRANSITION',
    fromStatus: 'ACTIVE', toStatus: 'UNCOLLECTIBLE', changedAt: new Date('2026-01-10'), changedByUserId: ACTOR, reason: 'Cobro agotado',
    idempotencyFingerprint: paymentFingerprint({ loanId: LOAN, operation: 'MARK_UNCOLLECTIBLE', reason: 'Cobro agotado', actorId: ACTOR }), key: 'mark:1' }, created(OTHER)] });

function store(options: Options = {}) {
  let committed = initial(); let rollbacks = 0;
  const calls: Array<{ sql: string; params: unknown[]; manager: object }> = []; const managers: object[] = [];
  const source = { transaction: jest.fn(async <T>(run: (manager: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<T>) => {
    const draft = structuredClone(committed);
    const manager = { query: async (sql: string, params: unknown[] = []): Promise<unknown> => {
      calls.push({ sql, params, manager });
      if (sql.startsWith('SELECT id, status FROM loans') && sql.includes('FOR UPDATE')) {
        if (options.failRead) throw new Error('Database secret');
        const loan = draft.loans[String(params[0]).toLowerCase()]; return loan ? [{ id: loan.id, status: loan.status }] : [];
      }
      if (sql.includes('FROM loans WHERE id = $1')) {
        const loan = draft.loans[String(params[0]).toLowerCase()]; return loan ? [{ ...loan }] : [];
      }
      if (sql.includes('FROM loan_status_history WHERE idempotency_key')) return draft.history.filter((event) => event.key === params[0]);
      if (sql.includes('MAX(event_sequence)')) {
        const sequences = draft.history.filter((event) => event.loanId === params[0]).map((event) => event.eventSequence);
        return [{ maxSequence: sequences.length ? Math.max(...sequences) : null }];
      }
      if (sql.startsWith('SELECT id, idempotency_fingerprint') && sql.includes('FROM payments')) return [];
      if (sql.includes('FROM payments WHERE loan_id')) {
        const valid = draft.payments.filter((payment) => payment.loanId === params[0] && (!sql.includes("status = 'VALID'") || payment.status === 'VALID'));
        const sum = (field: 'amount' | 'principalApplied' | 'interestApplied') => money(valid.reduce((acc, payment) => acc + cents(payment[field]), 0n));
        return [{ paidAmount: sum('amount'), paidPrincipal: sum('principalApplied'), paidInterest: sum('interestApplied'), invalidCount: 0 }];
      }
      if (sql.includes('SUM(pending_amount)')) {
        const positive = draft.plans.filter((row) => row.loanId === params[0] && cents(row.pendingAmount) > 0n);
        return [{ pendingAmount: money(positive.reduce((acc, row) => acc + cents(row.pendingAmount), 0n)) }];
      }
      if (sql.includes('FROM payment_plan_entries') && sql.includes('LIMIT 1') && options.noFirstRow) return [];
      if (sql.includes('FROM payment_plan_entries')) return draft.plans.filter((row) => row.loanId === params[0] && (!sql.includes('pending_amount > 0') || cents(row.pendingAmount) > 0n))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence || a.id.localeCompare(b.id)).slice(0, sql.includes('LIMIT 1') ? 1 : undefined);
      if (sql.includes('FROM financial_openings')) return [];
      if (sql.startsWith('UPDATE loans SET status')) {
        if (options.rawUpdate === 'zero' || draft.loans[String(params[0])].status !== 'UNCOLLECTIBLE') return [[], 0];
        draft.loans[String(params[0])].status = 'ACTIVE';
        return [[{ id: options.rawUpdate === 'wrong-id' ? OTHER : params[0] }], options.rawUpdate === 'zero-count' ? 0 : 1];
      }
      if (sql.startsWith('INSERT INTO loan_status_history')) {
        if (options.failInsert) throw new Error('Database insert secret');
        if (options.raceKey) { committed.history.push({ ...created(OTHER), id: 'competing-event', key: String(params[4]) }); return []; }
        const [loanId, sequence, actor, reason, key, fingerprint] = params as [string, number, string, string, string, string];
        const event: Event = { id: 'reactivated-event', loanId, eventSequence: sequence, eventKind: 'TRANSITION', fromStatus: 'UNCOLLECTIBLE',
          toStatus: 'ACTIVE', changedAt, changedByUserId: actor, reason, key, idempotencyFingerprint: fingerprint, paymentId: null, paymentAnnulmentId: null };
        draft.history.push(event); return [event];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    } };
    managers.push(manager);
    try { const result = await run(manager); committed = draft; return result; }
    catch (error) { rollbacks++; throw error; }
  }) };
  const totals = new LoanFinancialTotalsTypeormReader();
  const evaluator = new EvaluateUncollectibleEligibilityUseCase(totals, new UncollectibleEligibilityTypeormReader());
  const useCase = new ReactivateLoanUseCase(new ReactivateLoanTypeormWriter(source as unknown as DataSource), evaluator);
  const controller = new LoanController({} as never, {} as never, {} as never, {} as never, {} as never, useCase);
  return { source, calls, managers, totals, evaluator, useCase, controller, state: () => committed, rollbacks: () => rollbacks,
    set: (edit: (state: State) => void) => { const copy = structuredClone(committed); edit(copy); committed = copy; } };
}

describe('manual UNCOLLECTIBLE to ACTIVE backend transaction', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-02-01T10:00:00Z')));
  afterEach(() => jest.useRealTimers());

  it('appends event 3 using the locked canonical id and unchanged financial, payment, plan and cash facts even when not overdue', async () => {
    const fake = store(); const before = structuredClone(fake.state());
    const financeBefore = await fake.source.transaction((manager) => fake.evaluator.evaluate(manager as never, LOAN, '2026-02-01')) as Awaited<ReturnType<typeof fake.evaluator.evaluate>>;
    const evaluate = jest.spyOn(fake.evaluator, 'evaluate'); fake.calls.length = 0; fake.managers.length = 0;
    const result = await fake.controller.reactivate(LOAN.toUpperCase(), request(), { id: ACTOR } as never);
    expect(result).toEqual({ loanId: LOAN, status: 'ACTIVE', event: { id: 'reactivated-event', sequence: 3, changedAt } });
    expect(evaluate).toHaveBeenCalledWith(fake.managers[0], LOAN, '2026-02-01');
    expect(financeBefore).toMatchObject({ blockingReason: 'LOAN_NOT_ACTIVE', isOverdue: false, isFinanciallyValid: true, financialBalance: 10000000n });
    const financeAfter = await fake.source.transaction((manager) => fake.evaluator.evaluate(manager as never, LOAN, '2026-02-01')) as Awaited<ReturnType<typeof fake.evaluator.evaluate>>;
    expect({ ...financeAfter, status: 'UNCOLLECTIBLE', blockingReason: 'LOAN_NOT_ACTIVE', canMarkUncollectible: false })
      .toEqual(financeBefore);
    expect(fake.state().loans[LOAN]).toEqual({ ...before.loans[LOAN], status: 'ACTIVE' });
    expect(fake.state().plans).toEqual(before.plans); expect(fake.state().payments).toEqual(before.payments); expect(fake.state().cash).toEqual(before.cash);
    expect(fake.state().history.slice(0, -1)).toEqual(before.history);
    expect(fake.state().history.at(-1)).toMatchObject({ loanId: LOAN, eventKind: 'TRANSITION', eventSequence: 3, fromStatus: 'UNCOLLECTIBLE', toStatus: 'ACTIVE',
      changedByUserId: ACTOR, reason: 'Gestión retomada', changedAt, paymentId: null, paymentAnnulmentId: null, key: 'reactivate:1',
      idempotencyFingerprint: paymentFingerprint({ loanId: LOAN, operation: 'REACTIVATE_LOAN', reason: 'Gestión retomada', actorId: ACTOR }) });
    const sql = fake.calls.map(({ sql: text }) => text);
    expect(sql.indexOf('SELECT id, status FROM loans WHERE id = $1 FOR UPDATE')).toBeLessThan(sql.findIndex((text) => text.includes('WHERE idempotency_key = $1')));
    expect(sql.findIndex((text) => text.includes('WHERE idempotency_key = $1'))).toBeLessThan(sql.findIndex((text) => text.includes('FROM loans WHERE id = $1') && !text.includes('FOR UPDATE')));
    expect(sql.findIndex((text) => text.includes('MAX(event_sequence)'))).toBeLessThan(sql.findIndex((text) => text.startsWith('UPDATE loans')));
    expect(writes(fake.calls).map(({ sql: text }) => text.match(/^(?:UPDATE|INSERT) (?:INTO )?(\w+)/)?.[1])).toEqual(['loans', 'loan_status_history']);
    expect(fake.calls.every(({ manager }) => manager === fake.managers[0] || manager === fake.managers[1])).toBe(true);
    const insertSql = sql.find((text) => text.startsWith('INSERT INTO loan_status_history'));
    expect(insertSql).toContain('clock_timestamp()'); expect(insertSql).toContain('NULL,NULL');
    expect(insertSql).toContain('ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING');
    expect(fake.calls.find(({ sql: text }) => text.startsWith('UPDATE loans'))?.sql).toContain("WHERE id = $1 AND status = 'UNCOLLECTIBLE' RETURNING id");
    expect(fake.calls.find(({ sql: text }) => text.startsWith('INSERT INTO loan_status_history'))?.params).toEqual([LOAN, 3, ACTOR, 'Gestión retomada', 'reactivate:1', fake.state().history.at(-1)?.idempotencyFingerprint]);
  });

  it('replays the original persisted event before the now-ACTIVE status guard with no eligibility or writes', async () => {
    const fake = store(); const first = await fake.useCase.execute(LOAN, request(), ACTOR); const before = fake.calls.length;
    const evaluate = jest.spyOn(fake.evaluator, 'evaluate');
    expect(await fake.useCase.execute(LOAN, request('Gestión retomada', 'reactivate:1'), ACTOR)).toEqual(first);
    expect(fake.calls.slice(before).map(({ sql }) => sql)).toEqual([expect.stringContaining('FOR UPDATE'), expect.stringContaining('WHERE idempotency_key = $1')]);
    expect(evaluate).not.toHaveBeenCalled(); expect(fake.state().history).toHaveLength(4);
  });

  it.each([['reason', 'Otro motivo', ACTOR, LOAN], ['actor', 'Gestión retomada', SECOND_ACTOR, LOAN],
    ['loan', 'Gestión retomada', ACTOR, OTHER]] as const)('rejects a globally reused key for another %s without writes', async (_, reason, actor, loan) => {
    const fake = store(); await fake.useCase.execute(LOAN, request(), ACTOR); const before = structuredClone(fake.state()); const count = fake.calls.length;
    await expect(fake.controller.reactivate(loan, request(reason), { id: actor } as never)).rejects.toMatchObject({ status: 409 });
    expect(fake.state()).toEqual(before); expect(writes(fake.calls.slice(count))).toEqual([]);
  });

  it.each(['mark:1', 'reactivate:1'])('rejects a key for another operation or event shape', async (key) => {
    const fake = store();
    if (key === 'reactivate:1') fake.set((state) => { Object.assign(state.history[0], { key }); });
    await expect(fake.controller.reactivate(LOAN, request('Gestión retomada', key), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(writes(fake.calls)).toEqual([]);
  });

  it.each(['ACTIVE', 'CANCELLED', 'REFINANCED', 'ANNULLED'])('rejects a new key from %s without financial reads or writes', async (status) => {
    const fake = store(); fake.set((state) => { state.loans[LOAN].status = status; });
    const evaluate = jest.spyOn(fake.evaluator, 'evaluate');
    await expect(fake.controller.reactivate(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(evaluate).not.toHaveBeenCalled(); expect(writes(fake.calls)).toEqual([]);
  });

  it.each([['zero balance', (state: State) => { state.payments = [{ loanId: LOAN, status: 'VALID', amount: '120000.00', principalApplied: '100000.00', interestApplied: '20000.00' }]; state.plans = []; }],
    ['no positive row', (state: State) => { state.plans = state.plans.map((row) => ({ ...row, pendingAmount: '0.00' })); }],
    ['invalid reconciliation', (state: State) => { state.plans[0].pendingAmount = '39999.99'; }],
    ['component cap', (state: State) => { state.payments[0] = { ...state.payments[0], amount: '105001.00', principalApplied: '100001.00' };
      state.plans[0].pendingAmount = '14999.00'; state.plans[1].pendingAmount = '0.00'; }]] as const)
  ('blocks %s with no writes or plan repair', async (_, edit) => {
    const fake = store(); fake.set(edit); const before = structuredClone(fake.state());
    await expect(fake.controller.reactivate(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(fake.state()).toEqual(before); expect(writes(fake.calls)).toEqual([]);
  });

  it('rejects a missing first operational row even when the canonical balance still reconciles', async () => {
    const fake = store({ noFirstRow: true }); const before = structuredClone(fake.state());
    await expect(fake.controller.reactivate(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(fake.state()).toEqual(before); expect(writes(fake.calls)).toEqual([]);
  });

  it.each(['zero', 'zero-count', 'wrong-id'] as const)('rolls back when PostgreSQL UPDATE returns %s', async (rawUpdate) => {
    const fake = store({ rawUpdate }); const before = structuredClone(fake.state());
    await expect(fake.controller.reactivate(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(fake.state()).toEqual(before); expect(fake.rollbacks()).toBe(1); expect(writes(fake.calls)).toHaveLength(1);
  });

  it.each(['missing', 'overflow'])('rejects %s history without changing the loan', async (scenario) => {
    const fake = store(); fake.set((state) => { if (scenario === 'missing') state.history = state.history.filter((event) => event.loanId !== LOAN);
      else state.history[1].eventSequence = 2147483647; });
    await expect(fake.controller.reactivate(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(writes(fake.calls)).toEqual([]);
  });

  it('rolls back an UPDATE on history insert failure and masks SQL errors, including read failures', async () => {
    for (const options of [{ failInsert: true }, { failRead: true }]) {
      const fake = store(options); const before = structuredClone(fake.state());
      await expect(fake.controller.reactivate(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 500,
        response: { message: 'No se pudo actualizar el estado del préstamo.' } });
      expect(fake.state()).toEqual(before); expect(fake.rollbacks()).toBe(1);
    }
  });

  it('rolls back when another loan concurrently wins the global history key', async () => {
    const fake = store({ raceKey: true });
    await expect(fake.controller.reactivate(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(fake.state().loans[LOAN].status).toBe('UNCOLLECTIBLE'); expect(fake.state().history.filter((event) => event.loanId === LOAN)).toHaveLength(2);
    expect(fake.state().history.at(-1)?.loanId).toBe(OTHER); expect(fake.rollbacks()).toBe(1);
  });

  it('enforces Payment POST and plan PUT ACTIVE guards before reactivation, then reaches their independent validations', async () => {
    const fake = store(); const payment = new RegisterPaymentUseCase(fake.source as never, fake.totals);
    const plan = new CustomizePaymentPlanUseCase(fake.source as never, fake.totals);
    const capture = () => payment.execute({ loanId: LOAN, amount: '10.00', paymentDate: '2026-02-01', methodId: ROW, collectorId: OTHER, idempotencyKey: 'payment-key' }, ACTOR);
    const entries = fake.state().plans.filter((row) => cents(row.pendingAmount) > 0n).map(({ id, dueDate, pendingAmount }) => ({ id, dueDate, pendingAmount }));
    const base = { financialBalance: '100000.00', entries: entries.map((row) => ({ ...row, dueDate: '2026-11-01' })) };
    const customize = () => plan.execute(LOAN, entries, 'plan-key', base);
    await expect(capture()).rejects.toThrow('Only active loans accept payments.');
    await expect(customize()).rejects.toThrow('The loan is no longer active.');
    await fake.useCase.execute(LOAN, request(), ACTOR);
    const snapshot = structuredClone(fake.state()); const count = fake.calls.length;
    await expect(capture()).rejects.toThrow('The financial opening is required.');
    await expect(customize()).rejects.toThrow('The payment plan changed since it was opened.');
    expect(fake.state()).toEqual(snapshot); expect(writes(fake.calls.slice(count))).toEqual([]);
  });
});

describe('reactivate HTTP permission and DTO boundary', () => {
  it('registers exactly one route and central permission without granting roles or replacing mark', () => {
    expect(PERMISSIONS.filter(([code]) => code === 'loans.status.reactivate')).toHaveLength(1);
    expect(PERMISSIONS.filter(([code]) => code === 'loans.status.uncollectible')).toHaveLength(1);
    expect(Reflect.getMetadata('path', LoanController.prototype.reactivate)).toBe(':id/reactivate');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype.reactivate)).toEqual(['loans.status.reactivate']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype.markAsUncollectible)).toEqual(['loans.status.uncollectible']);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, LoanModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find(({ provide }) => provide === ReactivateLoanUseCase)?.inject).toEqual([REACTIVATE_LOAN_WRITER, EvaluateUncollectibleEligibilityUseCase]);
  });

  it('denies non-granted users and allows explicitly authorized users or superadmins via the single guard', () => {
    const guard = new PermissionGuard(new Reflector());
    const context = (permissions: string[], isSuperAdmin = false) => ({ getHandler: () => LoanController.prototype.reactivate,
      getClass: () => LoanController, switchToHttp: () => ({ getRequest: () => ({ currentUser: { role: { isSuperAdmin }, permissions } }) }) }) as never;
    expect(() => guard.canActivate(context(['loans.status.uncollectible']))).toThrow(ForbiddenException);
    expect(guard.canActivate(context(['loans.status.reactivate']))).toBe(true);
    expect(guard.canActivate(context([], true))).toBe(true);
  });

  it('requires the exact body, authenticated actor, nonempty reason and key; returns 404 for unknown loans', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const metadata = { type: 'body' as const, metatype: ReactivateLoanDto };
    expect(await pipe.transform(request(), metadata)).toMatchObject(request());
    for (const body of [request(' '), request('reason', ' '), request('reason', 'x'.repeat(129)), { ...request(), actorId: SECOND_ACTOR }]) {
      await expect(pipe.transform(body, metadata)).rejects.toBeInstanceOf(BadRequestException);
    }
    const fake = store();
    for (const body of [request('  '), request('reason', '  '), request('reason', 'bad\nkey')]) {
      await expect(fake.controller.reactivate(LOAN, body, { id: ACTOR } as never)).rejects.toMatchObject({ status: 400 });
    }
    await expect(fake.controller.reactivate('77777777-7777-4777-8777-777777777777', request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 404 });
    expect(writes(fake.calls)).toEqual([]);
  });
});
