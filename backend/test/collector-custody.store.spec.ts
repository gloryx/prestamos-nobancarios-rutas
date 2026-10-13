import type { DataSource } from 'typeorm';
import { CollectorCustodyTypeOrmStore } from '../src/infrastructure/database/typeorm/repositories/collector-custody.typeorm-store';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const actorId = uuid(1); const otherActorId = uuid(9); const collectorId = uuid(2); const methodId = uuid(3);
const command = { amount: '25.00', effectiveDate: '2026-10-12', paymentMethodId: methodId,
  reference: 'ref', reason: 'reason', notes: null, idempotencyKey: 'movement-1' };

function harness(balance = '100.00', summary = { declaredBalance: '0.00', pendingAmount: '0.00' }, reserved = '0.00') {
  const calls: Array<{ sql: string; params: unknown[] }> = []; const entries: Array<Record<string, unknown>> = [];
  const query = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    calls.push({ sql, params });
    if (sql.includes('collector-custody-idempotency')) return [];
    if (sql.includes('WHERE idempotency_key = $1 FOR SHARE')) return entries.filter((entry) => entry.key === params[0])
      .map((entry) => ({ id: entry.id, collectorId: entry.collectorId, createdByUserId: entry.createdByUserId,
        fingerprint: entry.fingerprint }));
    if (sql.includes('FROM users actor')) return [{ id: params[0], collectorId: params[0] === actorId ? collectorId : null }];
    if (sql.includes('FROM collectors WHERE')) return [{ id: collectorId }];
    if (sql.includes("pg_advisory_xact_lock_shared(hashtext('financial-closes-v2'))")) return [];
    if (sql.includes('FROM financial_openings')) return [{ openingDate: '2026-01-01' }];
    if (sql.includes('FROM financial_closes')) return [];
    if (sql.includes("pg_advisory_xact_lock(hashtext('collector-custody:'")) return [];
    if (sql.includes('FROM payment_methods')) return [{ id: methodId }];
    if (sql.includes('AS balance')) return [{ balance, reserved }];
    if (sql.includes('AS "declaredBalance"')) return [summary];
    if (sql.startsWith('INSERT INTO collector_custody_entries')) {
      const entry = { id: uuid(10 + entries.length), collectorId, direction: params[1], entryType: params[2], amount: params[3],
        effectiveDate: params[4], paymentMethodId: params[5], reference: params[6], reason: params[7], notes: params[8],
        createdByUserId: params[9], key: params[10], fingerprint: params[11] }; entries.push(entry); return [entry];
    }
    if (sql.includes('FROM collector_custody_entries WHERE id = $1')) return entries.filter((entry) => entry.id === params[0]);
    throw new Error(`Unexpected query: ${sql}`);
  };
  const source = { query, transaction: async <T>(work: (manager: { query: typeof query }) => Promise<T>) => work({ query }) };
  return { store: new CollectorCustodyTypeOrmStore(source as unknown as DataSource), calls, entries };
}

describe('collector custody TypeORM store', () => {
  it('records and replays a remittance without a duplicate debit', async () => {
    const test = harness();
    await test.store.record('remittance', command, 'fingerprint', actorId, false);
    await test.store.record('remittance', command, 'fingerprint', actorId, false);
    expect(test.entries).toHaveLength(1);
    expect(test.entries[0]).toMatchObject({ direction: 'DEBIT', entryType: 'REMITTANCE_TO_COMPANY' });
    const close = test.calls.findIndex(({ sql }) => sql.includes('pg_advisory_xact_lock_shared'));
    const custodyLock = test.calls.findIndex(({ sql }) => sql.includes("pg_advisory_xact_lock(hashtext('collector-custody:'"));
    const balance = test.calls.findIndex(({ sql }) => sql.includes('AS balance'));
    expect(close).toBeLessThan(custodyLock);
    expect(custodyLock).toBeLessThan(balance);
  });
  it('rejects a different payload key and a debit above available custody', async () => {
    const replay = harness(); await replay.store.record('topup', command, 'fingerprint', actorId, true);
    await expect(replay.store.record('topup', command, 'different', actorId, true)).rejects.toMatchObject({ reasonCode: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(harness('10.00').store.record('adjustment', { ...command, direction: 'DEBIT' }, 'debit', actorId, true))
      .rejects.toMatchObject({ reasonCode: 'INSUFFICIENT_AVAILABLE_CUSTODY' });
  });
  it('does not let a debit consume funds reserved by pending precollections', async () => {
    await expect(harness('100.00', { declaredBalance: '0.00', pendingAmount: '0.00' }, '80.00').store
      .record('remittance', command, 'fingerprint', actorId, false))
      .rejects.toMatchObject({ reasonCode: 'INSUFFICIENT_AVAILABLE_CUSTODY' });
    await expect(harness('100.00', { declaredBalance: '0.00', pendingAmount: '0.00' }, '75.00').store
      .record('remittance', command, 'fingerprint', actorId, false)).resolves.toMatchObject({ amount: '25.00' });
  });
  it('rejects replay by a different active actor even for the same target collector and payload', async () => {
    const test = harness();
    await test.store.record('topup', { ...command, collectorId }, 'fingerprint', actorId, true);
    await expect(test.store.record('topup', { ...command, collectorId }, 'fingerprint', otherActorId, true))
      .rejects.toMatchObject({ reasonCode: 'IDEMPOTENCY_KEY_REUSED' });
    expect(test.entries).toHaveLength(1);
    const actorLookup = test.calls.findIndex(({ sql, params }) => sql.includes('FROM users actor') && params[0] === otherActorId);
    const replayLookups = test.calls.map(({ sql }, index) => sql.includes('WHERE idempotency_key = $1 FOR SHARE') ? index : -1)
      .filter((index) => index >= 0);
    expect(actorLookup).toBeGreaterThan(-1);
    expect(actorLookup).toBeLessThan(replayLookups.at(-1)!);
  });
  it('records top-ups and credit adjustments as explicit immutable credits', async () => {
    const test = harness();
    await test.store.record('topup', command, 'topup', actorId, true);
    await test.store.record('adjustment', { ...command, idempotencyKey: 'adjust', direction: 'CREDIT' }, 'adjust', actorId, true);
    expect(test.entries.map((entry) => [entry.direction, entry.entryType])).toEqual([
      ['CREDIT', 'COMPANY_TOP_UP'], ['CREDIT', 'AUTHORIZED_ADJUSTMENT'],
    ]);
  });
  it('formats negative confirmed custody with one leading sign', async () => {
    const test = harness('100.00', { declaredBalance: '50.00', pendingAmount: '100.25' });
    await expect(test.store.summary(actorId, undefined, false)).resolves.toMatchObject({
      declaredBalance: '50.00', confirmedBalance: '-50.25', pendingAmount: '100.25',
    });
  });
});
