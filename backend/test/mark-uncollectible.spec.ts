import 'reflect-metadata';
import { BadRequestException, ForbiddenException, InternalServerErrorException, ValidationPipe } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { MarkUncollectibleConflictError, MarkUncollectibleUseCase, MARK_UNCOLLECTIBLE_WRITER,
  type UncollectibleEvent } from '../src/application/loan/mark-uncollectible.use-case';
import { EvaluateUncollectibleEligibilityUseCase } from '../src/application/loan/uncollectible-eligibility.use-case';
import { paymentFingerprint } from '../src/domain/payment/payment-rules';
import { RegisterPaymentUseCase, CustomizePaymentPlanUseCase, PaymentConflictError, PaymentValidationError } from '../src/application/payment/payment.use-case';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { UncollectibleEligibilityTypeormReader } from '../src/infrastructure/database/typeorm/repositories/uncollectible-eligibility.reader';
import { MarkUncollectibleTypeormWriter } from '../src/infrastructure/database/typeorm/repositories/mark-uncollectible.writer';
import { LoanController } from '../src/presentation/loan/loan.controller';
import { MarkUncollectibleDto } from '../src/presentation/loan/loan.dto';
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
const eventTime = new Date('2026-02-01T12:34:56.789Z');
type Plan = { id: string; loanId: string; sequence: number; dueDate: string; pendingAmount: string };
type Payment = { loanId: string; status: 'VALID' | 'ANNULLED'; amount: string; principalApplied: string; interestApplied: string };
type State = { loans: Record<string, { id: string; status: string; principal: string; interestAmount: string; totalAmount: string; startDate: string }>;
  plans: Plan[]; payments: Payment[]; history: UncollectibleEvent[]; cash: string[] };
type Options = { rawUpdate?: 'zero' | 'zero-count' | 'wrong-id'; failInsert?: boolean; failRead?: boolean; raceKey?: boolean };
const cents = (value: string) => BigInt(value.replace('.', ''));
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const created = (loanId: string, id: string): UncollectibleEvent => ({ id, loanId, eventSequence: 1, eventKind: 'CREATED', fromStatus: null,
  toStatus: 'ACTIVE', changedAt: new Date('2026-01-01T00:00:00Z'), changedByUserId: ACTOR, reason: null, idempotencyFingerprint: null });
const initial = (): State => ({ loans: {
  [LOAN]: { id: LOAN, status: 'ACTIVE', principal: '100000.00', interestAmount: '20000.00', totalAmount: '120000.00', startDate: '2025-12-01' },
  [OTHER]: { id: OTHER, status: 'ACTIVE', principal: '100000.00', interestAmount: '20000.00', totalAmount: '120000.00', startDate: '2025-12-01' },
}, plans: [{ id: ROW, loanId: LOAN, sequence: 4, dueDate: '2026-01-01', pendingAmount: '40000.00' },
  { id: FUTURE, loanId: LOAN, sequence: 9, dueDate: '2026-12-01', pendingAmount: '60000.00' }],
payments: [{ loanId: LOAN, status: 'VALID', amount: '20000.00', principalApplied: '15000.00', interestApplied: '5000.00' },
  { loanId: LOAN, status: 'ANNULLED', amount: '30000.00', principalApplied: '25000.00', interestApplied: '5000.00' }],
history: [created(LOAN, 'created-loan'), created(OTHER, 'created-other')], cash: ['existing-disbursement'] });
const request = (reason = '  Cobro agotado  ', idempotencyKey = '  uncollectible:1  ') => ({ reason, idempotencyKey });
const changed = (calls: Array<{ sql: string }>) => calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/.test(sql));

function store(options: Options = {}) {
  let committed = initial();
  const calls: Array<{ sql: string; params: unknown[]; manager: object }> = [];
  const managers: object[] = [];
  let rollbacks = 0;
  const source = { transaction: jest.fn(async <T>(run: (manager: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<T>) => {
    const draft = structuredClone(committed);
    const manager = { query: async (sql: string, params: unknown[] = []): Promise<unknown> => {
      calls.push({ sql, params, manager });
      if (sql.startsWith('SELECT id, status FROM loans') && sql.includes('FOR UPDATE')) {
        if (options.failRead) throw new Error('Database read secret');
        const loan = draft.loans[String(params[0])?.toLowerCase()]; return loan ? [{ id: loan.id, status: loan.status }] : [];
      }
      if (sql.includes('FROM loans WHERE id = $1 FOR UPDATE')) {
        const loan = draft.loans[String(params[0])?.toLowerCase()]; return loan ? [{ ...loan }] : [];
      }
      if (sql.includes('FROM loans WHERE id = $1')) {
        const loan = draft.loans[String(params[0])?.toLowerCase()]; return loan ? [{ ...loan }] : [];
      }
      if (sql.includes('FROM loan_status_history WHERE idempotency_key')) {
        const event = draft.history.find((item) => (item as UncollectibleEvent & { key?: string }).key === params[0]);
        return event ? [event] : [];
      }
      if (sql.includes('MAX(event_sequence)')) {
        const sequences = draft.history.filter((event) => event.loanId === params[0]).map((event) => event.eventSequence);
        return [{ maxSequence: sequences.length ? Math.max(...sequences) : null }];
      }
      if (sql.startsWith('SELECT id, idempotency_fingerprint') && sql.includes('FROM payments')) return [];
      if (sql.includes('FROM payments WHERE loan_id')) {
        const matching = draft.payments.filter((item) => item.loanId === params[0] && (!sql.includes("status = 'VALID'") || item.status === 'VALID'));
        const sum = (field: 'amount' | 'principalApplied' | 'interestApplied') => money(matching.reduce((total, item) => total + cents(item[field]), 0n));
        return [{ paidAmount: sum('amount'), paidPrincipal: sum('principalApplied'), paidInterest: sum('interestApplied'), invalidCount: 0 }];
      }
      if (sql.includes('SUM(pending_amount)')) {
        const matching = draft.plans.filter((item) => item.loanId === params[0] && (!sql.includes('pending_amount > 0') || cents(item.pendingAmount) > 0n));
        return [{ pendingAmount: money(matching.reduce((total, item) => total + cents(item.pendingAmount), 0n)) }];
      }
      if (sql.includes('FROM payment_plan_entries')) return draft.plans.filter((item) => item.loanId === params[0] && (!sql.includes('pending_amount > 0') || cents(item.pendingAmount) > 0n))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence || a.id.localeCompare(b.id)).slice(0, sql.includes('LIMIT 1') ? 1 : undefined);
      if (sql.startsWith('UPDATE loans SET status')) {
        if (options.rawUpdate === 'zero' || draft.loans[String(params[0])].status !== 'ACTIVE') return [[], 0];
        draft.loans[String(params[0])].status = 'UNCOLLECTIBLE';
        return [[{ id: options.rawUpdate === 'wrong-id' ? OTHER : params[0] }], options.rawUpdate === 'zero-count' ? 0 : 1];
      }
      if (sql.startsWith('INSERT INTO loan_status_history')) {
        if (options.failInsert) throw new Error('Database insert secret');
        if (options.raceKey) {
          committed.history.push({ ...created(OTHER, 'competing-event'), eventSequence: 2, eventKind: 'TRANSITION', fromStatus: 'ACTIVE',
            toStatus: 'UNCOLLECTIBLE', key: params[4], idempotencyFingerprint: 'different' } as UncollectibleEvent);
          return [];
        }
        const [loanId, sequence, actor, reason, key, fingerprint] = params as [string, number, string, string, string, string];
        const event = { id: 'transition-1', loanId, eventSequence: sequence, eventKind: 'TRANSITION' as const, fromStatus: 'ACTIVE' as const,
          toStatus: 'UNCOLLECTIBLE' as const, changedAt: eventTime, changedByUserId: actor, reason, idempotencyFingerprint: fingerprint, key };
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
  const useCase = new MarkUncollectibleUseCase(new MarkUncollectibleTypeormWriter(source as unknown as DataSource), evaluator);
  const controller = new LoanController({} as never, {} as never, {} as never, {} as never, useCase, {} as never);
  return { useCase, controller, evaluator, totals, source, managers, calls, state: () => committed, rollbacks: () => rollbacks,
    set: (edit: (state: State) => void) => { const copy = structuredClone(committed); edit(copy); committed = copy; } };
}

describe('ACTIVE to UNCOLLECTIBLE transactional writer', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-02-01T10:00:00Z')));
  afterEach(() => jest.useRealTimers());

  it('records one canonical transition after locked financial eligibility, with no financial, plan or cash drift', async () => {
    const fake = store(); const before = structuredClone(fake.state());
    const evaluate = jest.spyOn(fake.evaluator, 'evaluate');
    const result = await fake.useCase.execute(LOAN.toUpperCase(), request(), ACTOR);
    expect(result).toEqual({ loanId: LOAN, status: 'UNCOLLECTIBLE', event: { id: 'transition-1', sequence: 2, changedAt: eventTime } });
    expect(fake.state().loans[LOAN].status).toBe('UNCOLLECTIBLE');
    expect(fake.state().plans).toEqual(before.plans);
    expect(fake.state().payments).toEqual(before.payments);
    expect(fake.state().cash).toEqual(before.cash);
    expect({ ...fake.state().loans[LOAN], status: 'ACTIVE' }).toEqual(before.loans[LOAN]);
    expect(fake.state().history).toHaveLength(before.history.length + 1);
    expect(fake.state().history.at(-1)).toMatchObject({ loanId: LOAN, eventSequence: 2, eventKind: 'TRANSITION', fromStatus: 'ACTIVE',
      toStatus: 'UNCOLLECTIBLE', changedByUserId: ACTOR, reason: 'Cobro agotado', changedAt: eventTime,
      key: 'uncollectible:1', idempotencyFingerprint: paymentFingerprint({ loanId: LOAN, operation: 'MARK_UNCOLLECTIBLE', reason: 'Cobro agotado', actorId: ACTOR }) });
    const sql = fake.calls.map((call) => call.sql);
    expect(sql.findIndex((text) => text.includes('FOR UPDATE'))).toBeLessThan(sql.findIndex((text) => text.includes('FROM loans WHERE id = $1') && !text.includes('FOR UPDATE')));
    expect(evaluate).toHaveBeenCalledWith(fake.managers[0], LOAN, '2026-02-01');
    expect(fake.calls.every((call) => call.manager === fake.managers[0])).toBe(true);
    expect(sql.findIndex((text) => text.includes('MAX(event_sequence)'))).toBeLessThan(sql.findIndex((text) => text.startsWith('UPDATE loans')));
    expect(changed(fake.calls).map(({ sql: text }) => text.match(/^(?:UPDATE|INSERT) (?:INTO )?(\w+)/)?.[1])).toEqual(['loans', 'loan_status_history']);
    expect(sql.at(-1)).toContain('clock_timestamp()');
    expect(sql.at(-1)).toContain('payment_id, payment_annulment_id');
    expect(sql.at(-1)).toContain('NULL,NULL');
    expect(sql.at(-1)).toContain('ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING');
    expect(fake.calls.at(-1)?.params).toEqual([LOAN, 2, ACTOR, 'Cobro agotado', 'uncollectible:1', fake.state().history.at(-1)?.idempotencyFingerprint]);
  });

  it('replays the original persisted event before status/eligibility checks and accepts normalized key and reason', async () => {
    const fake = store(); const first = await fake.useCase.execute(LOAN, request(), ACTOR);
    const evaluate = jest.spyOn(fake.evaluator, 'evaluate'); const before = fake.calls.length;
    expect(await fake.useCase.execute(LOAN, request('Cobro agotado', 'uncollectible:1'), ACTOR)).toEqual(first);
    expect(fake.calls.slice(before).map(({ sql }) => sql)).toEqual(expect.arrayContaining([expect.stringContaining('FOR UPDATE'), expect.stringContaining('WHERE idempotency_key = $1')]));
    expect(fake.calls.slice(before).some(({ sql }) => sql.includes('MAX(event_sequence)') || /^(UPDATE|INSERT)/.test(sql))).toBe(false);
    expect(evaluate).not.toHaveBeenCalled();
    expect(fake.state().history).toHaveLength(3);
  });

  it.each([['reason', 'Otra razón', ACTOR, LOAN], ['actor', 'Cobro agotado', SECOND_ACTOR, LOAN],
    ['loan', 'Cobro agotado', ACTOR, OTHER]] as const)('rejects a reused key with different %s without writes', async (_, reason, actor, loan) => {
    const fake = store(); await fake.useCase.execute(LOAN, request(), ACTOR);
    const before = structuredClone(fake.state()); const count = fake.calls.length;
    await expect(fake.useCase.execute(loan, request(reason), actor)).rejects.toBeInstanceOf(MarkUncollectibleConflictError);
    expect(fake.state()).toEqual(before); expect(changed(fake.calls.slice(count))).toEqual([]);
  });

  it.each([['blank reason', request('  ', 'key'), LOAN], ['blank key', request('reason', '  '), LOAN],
    ['bad key', request('reason', 'bad\nkey'), LOAN], ['long key', request('reason', 'a'.repeat(129)), LOAN],
    ['invalid UUID', request(), 'not-a-uuid']] as const)('rejects %s before opening a transaction', async (_, body, loan) => {
    const fake = store(); await expect(fake.controller.markAsUncollectible(loan, body, { id: ACTOR } as never)).rejects.toMatchObject({ status: 400 });
    expect(fake.source.transaction).not.toHaveBeenCalled(); expect(fake.calls).toEqual([]);
  });

  it('returns 404 for an unknown canonical UUID without writes', async () => {
    const fake = store(); await expect(fake.controller.markAsUncollectible('77777777-7777-4777-8777-777777777777', request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 404 });
    expect(changed(fake.calls)).toEqual([]);
  });

  it.each(['2026-02-01', '2026-12-01'])('rejects due date %s as not overdue, without writes', async (dueDate) => {
    const fake = store(); fake.set((state) => { state.plans[0].dueDate = dueDate; });
    await expect(fake.controller.markAsUncollectible(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 400,
      response: { message: 'El préstamo todavía no tiene obligaciones vencidas.' } });
    expect(changed(fake.calls)).toEqual([]);
  });

  it.each(['CANCELLED', 'REFINANCED', 'UNCOLLECTIBLE', 'ANNULLED'])('rejects non-ACTIVE %s as 409', async (status) => {
    const fake = store(); fake.set((state) => { state.loans[LOAN].status = status; });
    await expect(fake.controller.markAsUncollectible(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(changed(fake.calls)).toEqual([]);
  });

  it.each([['zero balance', (state: State) => { state.payments = [{ loanId: LOAN, status: 'VALID', amount: '120000.00', principalApplied: '100000.00', interestApplied: '20000.00' }]; state.plans = []; }],
    ['no operational row', (state: State) => { state.plans = []; }],
    ['financial mismatch', (state: State) => { state.plans[0].pendingAmount = '39999.99'; }]] as const)('rejects %s as 409 without mutations', async (_, edit) => {
    const fake = store(); fake.set(edit); const before = structuredClone(fake.state());
    await expect(fake.controller.markAsUncollectible(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(fake.state()).toEqual(before); expect(changed(fake.calls)).toEqual([]);
  });

  it.each(['zero', 'zero-count', 'wrong-id'] as const)('rolls back when raw UPDATE returns %s instead of exactly [[canonical id], 1]', async (rawUpdate) => {
    const fake = store({ rawUpdate }); const before = structuredClone(fake.state());
    await expect(fake.controller.markAsUncollectible(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(fake.state()).toEqual(before); expect(fake.rollbacks()).toBe(1);
    expect(changed(fake.calls).map(({ sql }) => sql.startsWith('UPDATE') ? 'UPDATE loans' : 'INSERT history')).toEqual(['UPDATE loans']);
  });

  it('fails closed when CREATED history is absent and does not write', async () => {
    const fake = store(); fake.set((state) => { state.history = state.history.filter((event) => event.loanId !== LOAN); });
    await expect(fake.controller.markAsUncollectible(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(changed(fake.calls)).toEqual([]);
  });

  it('rejects exhausted history sequences without a status change', async () => {
    const fake = store(); fake.set((state) => { state.history[0].eventSequence = 2147483647; });
    await expect(fake.controller.markAsUncollectible(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(changed(fake.calls)).toEqual([]);
  });

  it('rejects a key attached to a different history event kind or transition', async () => {
    const fake = store(); fake.set((state) => { Object.assign(state.history[0], { key: 'uncollectible:1' }); });
    await expect(fake.controller.markAsUncollectible(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(changed(fake.calls)).toEqual([]);
  });

  it('rolls back a successful status UPDATE if history insertion fails, and masks the SQL error', async () => {
    const fake = store({ failInsert: true }); const before = structuredClone(fake.state());
    await expect(fake.controller.markAsUncollectible(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 500,
      response: { message: 'No se pudo actualizar el estado del préstamo.' } });
    expect(fake.state()).toEqual(before); expect(fake.rollbacks()).toBe(1);
  });

  it('masks unexpected loan lock/read failures without committing changes', async () => {
    const fake = store({ failRead: true });
    await expect(fake.controller.markAsUncollectible(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 500,
      response: { message: 'No se pudo actualizar el estado del préstamo.' } });
    expect(changed(fake.calls)).toEqual([]); expect(fake.rollbacks()).toBe(1);
  });

  it('rolls back when a competing loan wins the global idempotency key during conflict-safe INSERT', async () => {
    const fake = store({ raceKey: true });
    await expect(fake.controller.markAsUncollectible(LOAN, request(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(fake.state().loans[LOAN].status).toBe('ACTIVE');
    expect(fake.state().history.filter((event) => event.loanId === LOAN)).toHaveLength(1);
    expect(fake.state().history.at(-1)?.loanId).toBe(OTHER);
    expect(fake.rollbacks()).toBe(1);
  });

  it('does not reopen payment registration or plan customization after marking uncollectible', async () => {
    const fake = store(); await fake.useCase.execute(LOAN, request(), ACTOR); const before = structuredClone(fake.state());
    const register = new RegisterPaymentUseCase(fake.source as never, fake.totals);
    await expect(register.execute({ loanId: LOAN, amount: '10.00', paymentDate: '2026-02-01', methodId: ROW, collectorId: OTHER, idempotencyKey: 'payment-key' }, ACTOR))
      .rejects.toBeInstanceOf(PaymentValidationError);
    const plan = new CustomizePaymentPlanUseCase(fake.source as never, fake.totals);
    const entries = before.plans.map(({ id, dueDate, pendingAmount }) => ({ id, dueDate, pendingAmount }));
    await expect(plan.execute(LOAN, entries, 'plan-key', { financialBalance: '100000.00', entries })).rejects.toBeInstanceOf(PaymentConflictError);
    expect(fake.state()).toEqual(before);
    expect(changed(fake.calls)).toHaveLength(2);
  });
});

describe('uncollectible HTTP and permission boundary', () => {
  it('preserves the mark permission, route and provider', () => {
    const codes = PERMISSIONS.map(([code]) => code);
    expect(codes.filter((code) => code === 'loans.status.uncollectible')).toHaveLength(1);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype.markAsUncollectible)).toEqual(['loans.status.uncollectible']);
    expect(Reflect.getMetadata('path', LoanController.prototype.markAsUncollectible)).toBe(':id/uncollectible');
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, LoanModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find(({ provide }) => provide === MarkUncollectibleUseCase)?.inject).toEqual([MARK_UNCOLLECTIBLE_WRITER, EvaluateUncollectibleEligibilityUseCase]);
  });

  it('denies unauthorized callers and allows authorized users and superadmins via central guard', () => {
    const guard = new PermissionGuard(new Reflector());
    const context = (permissions: string[], isSuperAdmin = false) => ({ getHandler: () => LoanController.prototype.markAsUncollectible,
      getClass: () => LoanController, switchToHttp: () => ({ getRequest: () => ({ currentUser: { role: { isSuperAdmin }, permissions } }) }) }) as never;
    expect(() => guard.canActivate(context(['loans.view']))).toThrow(ForbiddenException);
    expect(guard.canActivate(context(['loans.status.uncollectible']))).toBe(true);
    expect(guard.canActivate(context([], true))).toBe(true);
  });

  it('validates the exact DTO body and masks unexpected read failures as HTTP 500', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const metadata = { type: 'body' as const, metatype: MarkUncollectibleDto };
    await expect(pipe.transform({ reason: '  ', idempotencyKey: 'key' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ reason: 'reason', idempotencyKey: 'x'.repeat(129) }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...request(), amount: '1' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    const controller = new LoanController({} as never, {} as never, {} as never, {} as never,
      { execute: () => Promise.reject(new Error('internal SQL secret')) } as never, {} as never);
    await expect(controller.markAsUncollectible(LOAN, request(), { id: ACTOR } as never)).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
