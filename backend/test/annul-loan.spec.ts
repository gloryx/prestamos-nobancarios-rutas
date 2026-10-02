import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AnnulLoanUseCase } from '../src/application/loan/annul-loan.use-case';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { AnnulLoanTypeormWriter } from '../src/infrastructure/database/typeorm/repositories/annul-loan.writer';
import { paymentFingerprint } from '../src/domain/payment/payment-rules';
import { LoanController } from '../src/presentation/loan/loan.controller';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const LOAN = id(1); const ACTOR = id(2); const ORIGINAL = id(3); const DISBURSEMENT = id(4); const METHOD = id(5);
const at = '2026-09-30T06:00:00.000001Z';
const body = (resolution: 'NOT_DELIVERED' | 'RETURNED_IN_FULL' = 'NOT_DELIVERED') =>
  ({ reason: '  Not delivered as agreed  ', disbursementResolution: resolution, idempotencyKey: 'annul-key' });
const initial = () => ({ status: 'ACTIVE', plan: ['70.00', '50.00'], payments: [] as Array<{ status: string; amount: string }>,
  applications: [{ id: id(9), amount: '10.00' }], opening: '500.00', disbursement: { id: DISBURSEMENT, amount: '100.00', date: '2026-09-01', method: METHOD },
  original: { id: ORIGINAL, amount: '100.00', date: '2026-09-01', method: METHOD, direction: 'OUTFLOW', concept: 'LOAN_DISBURSEMENT' },
  reversal: null as null | { id: string; amount: string; date: string; method: string; actor: string; original: string; direction: string; concept: string; key: string; fingerprint: string },
  history: [{ id: id(6), loanId: LOAN, eventSequence: 1, eventKind: 'CREATED', fromStatus: null as string | null,
    toStatus: 'ACTIVE', actorId: ACTOR, reason: null as string | null, disbursementResolution: null as string | null,
    fingerprint: null as string | null, key: null as string | null, annulledAt: '', annulledBusinessDate: '' }] });

function harness(failure?: 'update' | 'count' | 'event' | 'cash' | 'raced-cash' | 'payment-after-lock') {
  let committed = initial(); let rollbacks = 0;
  const calls: Array<{ sql: string; params: unknown[]; manager: object }> = [];
  const source = { transaction: jest.fn(async <T>(run: (tx: { query: (sql: string, params: unknown[]) => Promise<unknown> }) => Promise<T>) => {
    const draft = structuredClone(committed);
    const manager = { query: async (sql: string, params: unknown[] = []): Promise<unknown> => {
      calls.push({ sql, params, manager });
      if (sql.includes('MAX(event_sequence)')) return [{ maxSequence: Math.max(...draft.history.map((e) => e.eventSequence)) }];
      if (sql.includes('FROM loan_status_history WHERE idempotency_key')) return draft.history.filter((e) => e.key === params[0]);
      if (sql.includes('FROM loan_status_history WHERE loan_id = $1 ORDER BY event_sequence DESC LIMIT 1'))
        return [draft.history.at(-1)];
      if (sql.startsWith('SELECT id, status FROM loans')) {
        expect(sql).toContain('FOR UPDATE');
        if (failure === 'payment-after-lock') draft.payments.push({ status: 'VALID', amount: '1.00' });
        return params[0] === LOAN ? [{ id: LOAN, status: draft.status }] : [];
      }
      if (sql.startsWith('SELECT EXISTS')) {
        expect(sql).toContain("status = 'VALID'");
        return [{ present: draft.payments.some((p) => p.status === 'VALID') }];
      }
      if (sql.includes('FROM loans l LEFT JOIN loan_disbursements d')) {
        expect(sql).toContain('reversal.reversed_movement_id = original.id');
        return [{ principal: '100.00', interestAmount: '20.00', totalAmount: '120.00', startDate: '2026-09-01',
          planCount: draft.plan.length, pendingPlan: draft.plan.reduce((sum, amount) => sum + Number(amount), 0).toFixed(2),
          disbursementId: draft.disbursement.id, disbursementAmount: draft.disbursement.amount,
          disbursementDate: draft.disbursement.date, disbursementMethodId: draft.disbursement.method,
          originalId: draft.original.id, originalAmount: draft.original.amount, originalDate: draft.original.date,
          originalMethodId: draft.original.method, originalDirection: draft.original.direction, originalConcept: draft.original.concept,
          reversalId: draft.reversal?.id ?? null, reversalAmount: draft.reversal?.amount ?? null,
          reversalDate: draft.reversal?.date ?? null, reversalMethodId: draft.reversal?.method ?? null,
          reversalDirection: draft.reversal?.direction ?? null, reversalConcept: draft.reversal?.concept ?? null,
          reversalActorId: draft.reversal?.actor ?? null, reversalKey: draft.reversal?.key ?? null,
          reversalFingerprint: draft.reversal?.fingerprint ?? null }];
      }
      if (sql.includes("FROM payments WHERE loan_id = $1 AND status = 'VALID'")) {
        const paid = draft.payments.filter((p) => p.status === 'VALID').reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2);
        return [{ paidAmount: paid, paidPrincipal: paid, paidInterest: '0.00', invalidCount: 0 }];
      }
      if (sql.startsWith('UPDATE loans SET status')) {
        expect(sql).toContain("AND status = 'ACTIVE' RETURNING id");
        if (failure === 'update' || draft.status !== 'ACTIVE') return [[], 0];
        draft.status = 'ANNULLED'; return [[{ id: LOAN }], failure === 'count' ? 0 : 1];
      }
      if (sql.startsWith('INSERT INTO loan_status_history')) {
        if (failure === 'event') throw new Error('private database failure');
        const e = { id: id(7), loanId: String(params[0]), eventSequence: Number(params[1]), eventKind: 'TRANSITION',
          fromStatus: 'ACTIVE', toStatus: 'ANNULLED', actorId: String(params[2]), reason: String(params[3]),
          disbursementResolution: String(params[4]), key: String(params[5]), fingerprint: String(params[6]),
          annulledAt: at, annulledBusinessDate: '2026-09-30' };
        draft.history.push(e); return [e];
      }
      if (sql.startsWith('INSERT INTO cash_movements')) {
        expect(sql).toContain("VALUES ('INFLOW','REVERSAL'"); expect(sql).toContain('ON CONFLICT DO NOTHING');
        if (failure === 'cash') throw new Error('private cash failure');
        if (failure === 'raced-cash' || draft.reversal) return [];
        draft.reversal = { id: id(8), amount: String(params[0]), date: String(params[1]), method: String(params[2]),
          actor: String(params[5]), original: String(params[4]), direction: 'INFLOW', concept: 'REVERSAL',
          key: String(params[6]), fingerprint: String(params[7]) };
        return [{ id: id(8) }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    } };
    try { const result = await run(manager); committed = draft; return result; }
    catch (e) { rollbacks++; throw e; }
  }) };
  const action = new AnnulLoanUseCase(new AnnulLoanTypeormWriter(source as unknown as DataSource), new LoanFinancialTotalsTypeormReader());
  const controller = new LoanController({} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    undefined, undefined, undefined, undefined, undefined, action);
  return { action, controller, source, calls, state: () => committed, rollbacks: () => rollbacks,
    change: (edit: (draft: ReturnType<typeof initial>) => void) => { const draft = structuredClone(committed); edit(draft); committed = draft; } };
}

describe('terminal Loan annulment transaction', () => {
  it.each(['NOT_DELIVERED', 'RETURNED_IN_FULL'] as const)('reverses exact principal once for %s and keeps all historical facts', async (resolution) => {
    const h = harness(); h.change((s) => { s.payments.push({ status: 'ANNULLED', amount: '5.00' }, { status: 'ANNULLED', amount: '7.00' }); });
    const before = structuredClone(h.state()); const result = await h.controller.annulLoan(LOAN, body(resolution), { id: ACTOR } as never);
    expect(result).toEqual({ loanId: LOAN, status: 'ANNULLED', annulledAt: at, annulledBusinessDate: '2026-09-30',
      reason: 'Not delivered as agreed', disbursementResolution: resolution });
    expect(h.state()).toMatchObject({ status: 'ANNULLED', plan: before.plan, payments: before.payments,
      applications: before.applications, disbursement: before.disbursement, original: before.original, opening: before.opening });
    expect(h.state().reversal).toMatchObject({ amount: before.original.amount, date: '2026-09-30', method: METHOD,
      actor: ACTOR, original: ORIGINAL, direction: 'INFLOW', concept: 'REVERSAL' });
    expect(-10000n + BigInt(h.state().reversal!.amount.replace('.', ''))).toBe(0n);
    expect(h.state().history.at(-1)).toMatchObject({ eventSequence: 2, eventKind: 'TRANSITION', fromStatus: 'ACTIVE',
      toStatus: 'ANNULLED', reason: 'Not delivered as agreed', actorId: ACTOR, disbursementResolution: resolution,
      fingerprint: paymentFingerprint({ operation: 'ANNUL_LOAN', loanId: LOAN, actorId: ACTOR,
        reason: 'Not delivered as agreed', disbursementResolution: resolution }) });
    expect(h.source.transaction).toHaveBeenCalledTimes(1);
    expect(new Set(h.calls.map((call) => call.manager)).size).toBe(1);
    const sql = h.calls.map(({ sql }) => sql);
    expect(sql.findIndex((s) => s.includes('FOR UPDATE'))).toBeLessThan(sql.findIndex((s) => s.startsWith('SELECT EXISTS')));
    expect(sql.findIndex((s) => s.startsWith('SELECT EXISTS'))).toBeLessThan(sql.findIndex((s) => s.startsWith('UPDATE loans')));
    expect(sql.filter((s) => /^(UPDATE|INSERT)/.test(s))).toHaveLength(3);
  });

  it('replays the exact durable receipt before checking ACTIVE or payments, without writing twice', async () => {
    const h = harness(); const first = await h.action.execute(LOAN, body(), ACTOR); const before = h.calls.length;
    expect(await h.action.execute(LOAN.toUpperCase(), { ...body(), reason: 'Not delivered as agreed' }, ACTOR)).toEqual(first);
    expect(h.calls.slice(before).map((c) => c.sql)).not.toEqual(expect.arrayContaining([expect.stringContaining('SELECT EXISTS')]));
    expect(h.calls.slice(before).filter(({ sql }) => /^(UPDATE|INSERT)/.test(sql))).toHaveLength(0);
    expect(h.state().history).toHaveLength(2);
  });

  it.each([{ reason: 'different' }, { disbursementResolution: 'RETURNED_IN_FULL' as const }])('rejects reused key with new payload %p', async (change) => {
    const h = harness(); await h.action.execute(LOAN, body(), ACTOR); const before = structuredClone(h.state());
    await expect(h.controller.annulLoan(LOAN, { ...body(), ...change }, { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(h.state()).toEqual(before);
  });

  it.each(['CANCELLED', 'REFINANCED', 'UNCOLLECTIBLE', 'ANNULLED'])('rejects %s without writing', async (status) => {
    const h = harness(); h.change((s) => { s.status = status; }); const before = structuredClone(h.state());
    await expect(h.controller.annulLoan(LOAN, body(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(h.state()).toEqual(before);
  });

  it.each([1, 3])('blocks %s VALID payments regardless of annulled history', async (count) => {
    const h = harness(); h.change((s) => { s.payments.push({ status: 'ANNULLED', amount: '1.00' },
      ...Array.from({ length: count }, () => ({ status: 'VALID', amount: '1.00' }))); }); const before = structuredClone(h.state());
    await expect(h.controller.annulLoan(LOAN, body(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(h.state()).toEqual(before);
  });

  it('rejects a payment becoming VALID before the locked absence check and rolls back', async () => {
    const h = harness('payment-after-lock');
    await expect(h.controller.annulLoan(LOAN, body(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 409 });
    expect(h.state()).toEqual(initial()); expect(h.rollbacks()).toBe(1);
  });

  it.each(['reversal', 'missing-disbursement', 'mismatched-cash', 'plan', 'history'] as const)('refuses corrupt %s before writes', async (kind) => {
    const h = harness(); h.change((s) => {
      if (kind === 'reversal') s.reversal = { id: id(8), amount: '100.00', date: '2026-09-30', method: METHOD,
        actor: ACTOR, original: ORIGINAL, direction: 'INFLOW', concept: 'REVERSAL', key: 'other', fingerprint: 'other' };
      if (kind === 'missing-disbursement') s.disbursement.id = '';
      if (kind === 'mismatched-cash') s.original.amount = '101.00';
      if (kind === 'plan') s.plan = ['119.00'];
      if (kind === 'history') s.history[0].toStatus = 'CANCELLED';
    }); const before = structuredClone(h.state());
    await expect(h.controller.annulLoan(LOAN, body(), { id: ACTOR } as never)).rejects.toMatchObject({ status: kind === 'reversal' ? 409 : 500 });
    expect(h.state()).toEqual(before); expect(h.calls.filter(({ sql }) => /^(UPDATE|INSERT)/.test(sql))).toHaveLength(0);
  });

  it.each([['update', 409], ['count', 409], ['event', 500], ['cash', 500], ['raced-cash', 409]] as const)(
    'rolls back status, history and cash for %s failure', async (failure, status) => {
      const h = harness(failure); const before = structuredClone(h.state());
      await expect(h.controller.annulLoan(LOAN, body(), { id: ACTOR } as never)).rejects.toMatchObject({ status });
      expect(h.state()).toEqual(before); expect(h.rollbacks()).toBe(1);
    });

  it('returns 404 for an absent Loan, 400 for invalid direct payload, and masks an unexpected SQL failure', async () => {
    const h = harness();
    await expect(h.controller.annulLoan(id(99), body(), { id: ACTOR } as never)).rejects.toMatchObject({ status: 404 });
    for (const reason of ['', ' '.repeat(20), 'a'.repeat(501)])
      await expect(h.controller.annulLoan(LOAN, { ...body(), reason }, { id: ACTOR } as never)).rejects.toMatchObject({ status: 400 });
    expect(h.source.transaction).toHaveBeenCalledTimes(1);
  });
});
