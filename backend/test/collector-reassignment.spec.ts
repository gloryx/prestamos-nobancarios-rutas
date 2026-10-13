import type { DataSource, Repository } from 'typeorm';
import { CollectorTypeOrmRepository } from '../src/infrastructure/database/typeorm/repositories/collector.typeorm-repository';
import type { CollectorOrmEntity } from '../src/infrastructure/database/typeorm/entities/collector.orm-entity';
import type { UserOrmEntity } from '../src/infrastructure/database/typeorm/entities/user.orm-entity';

const collectorId = '11111111-1111-4111-8111-111111111111';
const currentUserId = '22222222-2222-4222-8222-222222222222';
const targetUserId = '33333333-3333-4333-8333-333333333333';
const actorId = '44444444-4444-4444-8444-444444444444';

function harness(obligations: Partial<{ custodyBalance: string; openPrecollections: boolean; openSettlements: boolean;
  activeRoutes: boolean; activeAuthorizations: boolean }> = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    calls.push({ sql, params });
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('FROM collectors WHERE id = $1 FOR UPDATE')) return [{ id: collectorId, userId: currentUserId }];
    if (sql.includes('FROM users u JOIN roles')) return [{ id: targetUserId }];
    if (sql.includes('FROM collectors WHERE user_id')) return [];
    if (sql.includes('AS "custodyBalance"')) return [{ custodyBalance: '0.00', openPrecollections: false,
      openSettlements: false, activeRoutes: false, activeAuthorizations: false, ...obligations }];
    if (sql.startsWith('UPDATE collector_user_assignments') || sql.startsWith('INSERT INTO collector_user_assignments')
      || sql.startsWith('UPDATE collectors SET user_id')) return [];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const source = { transaction: <T>(work: (manager: { query: typeof query }) => Promise<T>) => work({ query }) } as DataSource;
  const repository = new CollectorTypeOrmRepository({} as Repository<CollectorOrmEntity>, {} as Repository<UserOrmEntity>, source);
  jest.spyOn(repository, 'findById').mockResolvedValue({ id: collectorId, userId: targetUserId } as never);
  return { repository, calls };
}

describe('collector user reassignment financial guard', () => {
  it.each([
    [{ custodyBalance: '1.00' }, 'COLLECTOR_CUSTODY_BALANCE_NOT_ZERO'],
    [{ custodyBalance: '-1.00' }, 'COLLECTOR_CUSTODY_BALANCE_NOT_ZERO'],
    [{ openPrecollections: true }, 'COLLECTOR_HAS_OPEN_PRECOLLECTIONS'],
    [{ openSettlements: true }, 'COLLECTOR_HAS_OPEN_SETTLEMENTS'],
    [{ activeRoutes: true }, 'COLLECTOR_HAS_ACTIVE_ROUTE_ASSIGNMENTS'],
    [{ activeAuthorizations: true }, 'COLLECTOR_HAS_ACTIVE_SITE_AUTHORIZATIONS'],
  ] as const)('rejects unsafe reassignment for %j', async (obligations, reasonCode) => {
    const test = harness(obligations);
    await expect(test.repository.reassignUser(collectorId, targetUserId, actorId)).rejects.toMatchObject({ reasonCode });
    expect(test.calls.some(({ sql }) => sql.startsWith('UPDATE collectors SET user_id'))).toBe(false);
    expect(test.calls.some(({ sql }) => sql.startsWith('INSERT INTO collector_user_assignments'))).toBe(false);
  });

  it('closes the historical assignment and creates the replacement atomically after all guards pass', async () => {
    const test = harness();
    await expect(test.repository.reassignUser(collectorId, targetUserId, actorId)).resolves.toMatchObject({ userId: targetUserId });
    const writes = test.calls.filter(({ sql }) => /^(UPDATE|INSERT)\b/.test(sql));
    expect(writes.map(({ sql }) => sql.split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'UPDATE collector_user_assignments SET', 'INSERT INTO collector_user_assignments', 'UPDATE collectors SET',
    ]);
    expect(writes[0].params).toEqual([actorId, collectorId]);
    expect(writes[1].params).toEqual([collectorId, targetUserId, actorId]);
  });
});
