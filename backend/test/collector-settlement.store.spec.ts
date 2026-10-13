import type { DataSource } from 'typeorm';
import { CollectorSettlementTypeOrmStore } from '../src/infrastructure/database/typeorm/repositories/collector-settlement.typeorm-store';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const settlementId = uuid(1); const collectorId = uuid(2); const actorId = uuid(3); const otherActorId = uuid(5);
const methodId = uuid(4);

function harness(options: { failSecond?: boolean; status?: string; collectorUserId?: string } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const actions: Array<{ settlementId: string; action: string; actorUserId: string; reason: unknown; key: string; fingerprint: string }> = [];
  const state = { status: options.status ?? 'UNDER_REVIEW', collectorUserId: options.collectorUserId ?? actorId };
  const registrar = { register: jest.fn().mockImplementation(async (_manager, input) => {
    if (options.failSecond && input.loanId === uuid(12)) throw new Error('Injected item failure');
    return { id: input.loanId === uuid(11) ? uuid(21) : uuid(22) };
  }) };
  const query = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    calls.push({ sql, params });
    if (sql.includes('FROM users actor')) return [{ id: params[0], collectorId: params[0] === state.collectorUserId ? collectorId : null }];
    if (sql.includes("pg_advisory_xact_lock(hashtext('collector-settlement-action:'")) return [];
    if (sql.includes('FROM collector_settlement_actions action')) return actions.filter((item) => item.key === params[0]).map((item) => ({
      settlementId: item.settlementId, action: item.action, actorUserId: item.actorUserId,
      fingerprint: item.fingerprint, collectorUserId: state.collectorUserId,
    }));
    if (sql.includes("pg_advisory_xact_lock_shared(hashtext('financial-closes-v2'))")) return [];
    if (sql.includes("pg_advisory_xact_lock(hashtext('collector-custody:'")) return [];
    if (sql.includes('FROM collector_settlements WHERE id = $1 FOR UPDATE')) return [{ id: settlementId, status: state.status,
      collectorId, collectorUserId: state.collectorUserId, actionKey: null, actionFingerprint: null }];
    if (sql.includes('FROM financial_openings')) return [{ openingDate: '2026-01-01' }];
    if (sql.includes('FROM financial_closes')) return [];
    if (sql.includes('FROM collector_settlement_items item')) return [
      { id: uuid(31), precollectionId: uuid(41), loanId: uuid(11), collectorId, paymentMethodId: methodId,
        amount: '60.00', effectiveDate: '2026-10-10', custodyTreatment: 'COLLECTOR_HELD', status: 'SUBMITTED' },
      { id: uuid(32), precollectionId: uuid(42), loanId: uuid(12), collectorId, paymentMethodId: methodId,
        amount: '40.00', effectiveDate: '2026-10-11', custodyTreatment: 'COMPANY_RECEIVED', status: 'SUBMITTED' },
    ];
    if (sql.startsWith('SELECT id FROM loans')) return [{ id: uuid(11) }, { id: uuid(12) }];
    if (sql.includes('AS balance') && sql.includes('collector_custody_entries')) return [{ balance: '60.00', reservedOther: '0.00' }];
    if (sql.includes('FROM payment_methods')) return [{ id: methodId }];
    if (sql.startsWith('SELECT precollection_id AS "precollectionId"')) return [{ precollectionId: uuid(41) }];
    if (sql.startsWith('INSERT INTO collector_settlement_actions')) {
      if (sql.includes("VALUES ($1,'CONFIRM'")) actions.push({ settlementId: params[0] as string, action: 'CONFIRM',
        actorUserId: params[1] as string, reason: null, key: params[2] as string, fingerprint: params[3] as string });
      else actions.push({ settlementId: params[0] as string, action: params[1] as string, actorUserId: params[2] as string,
        reason: params[3], key: params[4] as string, fingerprint: params[5] as string });
      return [];
    }
    if (sql.startsWith('UPDATE collector_settlements SET status')) {
      state.status = sql.includes("status = 'CONFIRMED'") ? 'CONFIRMED' : params[0] as string; return [];
    }
    if (sql.startsWith('UPDATE') || sql.startsWith('INSERT INTO collector_custody_entries')) return [];
    if (sql.includes('FROM collector_settlements settlement')) return [{ id: settlementId, status: state.status,
      collectorUserId: state.collectorUserId, totalDeclared: '100.00', totalConfirmed: '100.00',
      amountDelivered: '25.00', retainedAmount: '35.00' }];
    if (sql.includes('FROM collector_settlement_items WHERE')) return [];
    if (sql.includes('FROM collector_settlement_actions WHERE')) return actions.map((item, index) => ({
      id: uuid(70 + index), action: item.action, actorUserId: item.actorUserId, reason: item.reason,
      createdAt: new Date('2026-10-12T12:00:00.000Z'),
    }));
    throw new Error(`Unexpected query: ${sql}`);
  };
  const source = { query, transaction: async <T>(work: (manager: { query: typeof query }) => Promise<T>) => work({ query }) };
  return { store: new CollectorSettlementTypeOrmStore(source as unknown as DataSource, registrar as never),
    registrar, calls, actions, state };
}

const command = { amountDelivered: '25.00', deliveryDate: '2026-10-12', deliveryPaymentMethodId: methodId,
  deliveryReference: 'receipt', deliveryNotes: 'partial', idempotencyKey: 'confirm-1' };

describe('collector settlement TypeORM confirmation', () => {
  it('uses canonical payments once, retains partial custody and never repeats customer collection credits', async () => {
    const test = harness();
    await expect(test.store.confirm(settlementId, command, 'fingerprint', actorId)).resolves.toMatchObject({ status: 'CONFIRMED' });
    await expect(test.store.confirm(settlementId, command, 'fingerprint', actorId)).resolves.toMatchObject({ status: 'CONFIRMED' });
    expect(test.registrar.register).toHaveBeenCalledTimes(2);
    expect(test.registrar.register.mock.calls.map((call) => call[1].idempotencyKey)).toEqual([
      `collector-settlement:precollection:${uuid(41)}`, `collector-settlement:precollection:${uuid(42)}`]);
    const ledgerWrites = test.calls.filter(({ sql }) => sql.startsWith('INSERT INTO collector_custody_entries'));
    expect(ledgerWrites).toHaveLength(1);
    expect(ledgerWrites[0].sql).toContain("'REMITTANCE_TO_COMPANY'");
    expect(test.calls.some(({ sql }) => sql.includes("'CUSTOMER_COLLECTION'"))).toBe(false);
    expect(test.actions).toEqual([expect.objectContaining({ action: 'CONFIRM', actorUserId: actorId, key: 'confirm-1' })]);
    await expect(test.store.detail(settlementId)).resolves.toMatchObject({
      actions: [expect.objectContaining({ action: 'CONFIRM', actorUserId: actorId })],
    });
    const final = test.calls.find(({ sql }) => sql.startsWith('UPDATE collector_settlements SET status'))!;
    expect(final.params.slice(0, 3)).toEqual(['100.00', '25.00', '35.00']);
  });

  it('stops the transaction before remittance, action journal and confirmation when any canonical item fails', async () => {
    const test = harness({ failSecond: true });
    await expect(test.store.confirm(settlementId, command, 'fingerprint', actorId)).rejects.toThrow('Injected item failure');
    expect(test.calls.some(({ sql }) => sql.startsWith('INSERT INTO collector_custody_entries'))).toBe(false);
    expect(test.actions).toHaveLength(0);
    expect(test.calls.some(({ sql }) => sql.startsWith('UPDATE collector_settlements SET status'))).toBe(false);
  });

  it('takes close, settlement, item, loan and custody locks before reading custody balance', async () => {
    const test = harness(); await test.store.confirm(settlementId, command, 'fingerprint', actorId);
    const index = (part: string) => test.calls.findIndex(({ sql }) => sql.includes(part));
    expect(index('pg_advisory_xact_lock_shared')).toBeLessThan(index('FROM collector_settlements WHERE id = $1 FOR UPDATE'));
    expect(index('FROM collector_settlements WHERE id = $1 FOR UPDATE')).toBeLessThan(index('FROM collector_settlement_items item'));
    expect(index('FROM collector_settlement_items item')).toBeLessThan(index('SELECT id FROM loans'));
    expect(index('SELECT id FROM loans')).toBeLessThan(index("pg_advisory_xact_lock(hashtext('collector-custody:'"));
    expect(index("pg_advisory_xact_lock(hashtext('collector-custody:'")).toBeLessThan(index('AS balance'));
  });
});

describe('collector settlement durable action idempotency', () => {
  it('replays an earlier submit after review and returns current detail without a second action', async () => {
    const test = harness({ status: 'DRAFT' });
    await test.store.transition(settlementId, 'submit', null, 'submit-key', 'submit-fp', actorId, false);
    await test.store.transition(settlementId, 'review', null, 'review-key', 'review-fp', actorId, true);
    await expect(test.store.transition(settlementId, 'submit', null, 'submit-key', 'submit-fp', actorId, false))
      .resolves.toMatchObject({ status: 'UNDER_REVIEW' });
    expect(test.actions.map((item) => item.action)).toEqual(['SUBMIT', 'REVIEW']);
  });

  it('rejects action replay by another actor and rejects self cancellation under review', async () => {
    const replay = harness({ status: 'DRAFT' });
    await replay.store.transition(settlementId, 'submit', null, 'submit-key', 'submit-fp', actorId, false);
    await expect(replay.store.transition(settlementId, 'submit', null, 'submit-key', 'submit-fp', otherActorId, true))
      .rejects.toMatchObject({ reasonCode: 'IDEMPOTENCY_KEY_REUSED' });
    const cancellation = harness({ status: 'UNDER_REVIEW' });
    await expect(cancellation.store.transition(settlementId, 'cancel', 'reason', 'cancel-key', 'cancel-fp', actorId, false))
      .rejects.toMatchObject({ reasonCode: 'SETTLEMENT_STATE_INVALID' });
    await expect(cancellation.store.transition(settlementId, 'cancel', 'reason', 'cancel-key', 'cancel-fp', actorId, true))
      .resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('rejects a durable action key reused with another payload or settlement', async () => {
    const test = harness({ status: 'DRAFT' });
    await test.store.transition(settlementId, 'submit', null, 'submit-key', 'submit-fp', actorId, false);
    await expect(test.store.transition(settlementId, 'submit', null, 'submit-key', 'different-fp', actorId, false))
      .rejects.toMatchObject({ reasonCode: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(test.store.transition(uuid(99), 'submit', null, 'submit-key', 'submit-fp', actorId, true))
      .rejects.toMatchObject({ reasonCode: 'IDEMPOTENCY_KEY_REUSED' });
  });
});
