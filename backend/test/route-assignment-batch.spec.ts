import type { AssignmentBatchOperation } from '../src/application/customer-site/customer-site.repository';
import { CustomerSiteConflictError, CustomerSiteNotFoundError } from '../src/domain/customer-site/customer-site.errors';
import { assignmentSnapshotToken, CustomerSiteTypeOrmRepository } from '../src/infrastructure/database/typeorm/repositories/customer-site.typeorm-repository';

type CustomerAssignment = { id: string; customerId: string; routeId: string; endedAt?: Date };
type CollectorAssignment = { id: string; routeId: string; collectorUserId: string; endedAt?: Date };
type State = { customers: CustomerAssignment[]; collectors: CollectorAssignment[]; validRoutes: string[]; validCustomers: string[]; eligibleCollectors: string[]; failInsertAt?: number };

const batchRepository = (initial: State) => {
  const state: State = structuredClone(initial);
  let inserts = 0;
  const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('FROM customer_route_assignments WHERE ended_at IS NULL')) return state.customers.filter((row) => !row.endedAt).map(({ endedAt: _endedAt, ...row }) => row);
    if (sql.includes('FROM collector_route_assignments WHERE ended_at IS NULL')) return state.collectors.filter((row) => !row.endedAt).map(({ endedAt: _endedAt, ...row }) => row);
    if (sql.startsWith('SELECT id FROM routes')) return state.validRoutes.filter((id) => (parameters[0] as string[]).includes(id)).map((id) => ({ id }));
    if (sql.startsWith('SELECT id FROM customers')) return state.validCustomers.filter((id) => (parameters[0] as string[]).includes(id)).map((id) => ({ id }));
    if (sql.includes('SELECT u.id FROM collectors')) return state.eligibleCollectors.filter((id) => (parameters[0] as string[]).includes(id)).map((id) => ({ id }));
    if (sql.startsWith('UPDATE customer_route_assignments')) {
      const row = state.customers.find((item) => item.id === parameters[0] && !item.endedAt);
      if (!row) return [];
      row.endedAt = parameters[1] as Date;
      return [{ id: row.id }];
    }
    if (sql.startsWith('UPDATE collector_route_assignments')) {
      const row = state.collectors.find((item) => item.id === parameters[0] && !item.endedAt);
      if (!row) return [];
      row.endedAt = parameters[1] as Date;
      return [{ id: row.id }];
    }
    if (sql.includes('INSERT INTO customer_route_assignments')) {
      inserts += 1;
      if (state.failInsertAt === inserts) throw { code: '23505' };
      const row = { id: `new-customer-${inserts}`, customerId: parameters[0] as string, routeId: parameters[1] as string };
      state.customers.push(row);
      return [row];
    }
    if (sql.includes('INSERT INTO collector_route_assignments')) {
      inserts += 1;
      if (state.failInsertAt === inserts) throw { code: '23505' };
      const row = { id: `new-collector-${inserts}`, routeId: parameters[0] as string, collectorUserId: parameters[1] as string };
      state.collectors.push(row);
      return [row];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const manager: { query: typeof query; transaction: (work: (manager: { query: typeof query }) => Promise<unknown>) => Promise<unknown> } = {
    query,
    transaction: async (work) => {
      const before = structuredClone(state);
      try { return await work(manager); } catch (error) { Object.assign(state, before); throw error; }
    },
  };
  const repository = new CustomerSiteTypeOrmRepository({ manager } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { repository, state, query };
};

const token = (state: State): string => assignmentSnapshotToken(
  state.customers.filter((row) => !row.endedAt).map((row) => ({ id: row.id, customerId: row.customerId, routeId: row.routeId })),
  state.collectors.filter((row) => !row.endedAt).map((row) => ({ id: row.id, routeId: row.routeId, collectorUserId: row.collectorUserId })),
);

describe('transactional route assignment batch', () => {
  const base = (): State => ({
    customers: [{ id: 'ca-1', customerId: 'customer-1', routeId: 'route-1' }, { id: 'ca-2', customerId: 'customer-2', routeId: 'route-2' }],
    collectors: [{ id: 'ra-1', routeId: 'route-1', collectorUserId: 'collector-1' }, { id: 'ra-2', routeId: 'route-2', collectorUserId: 'collector-2' }, { id: 'ra-4', routeId: 'route-4', collectorUserId: 'collector-3' }],
    validRoutes: ['route-1', 'route-2', 'route-3', 'route-4'], validCustomers: ['customer-1', 'customer-2', 'customer-3'], eligibleCollectors: ['collector-1', 'collector-2', 'collector-3'],
  });

  it('applies all six operation types atomically while preserving ended history', async () => {
    const initial = base();
    const { repository, state, query } = batchRepository(initial);
    const operations: AssignmentBatchOperation[] = [
      { type: 'MOVE_CUSTOMER_TO_ROUTE', customerId: 'customer-1', routeId: 'route-2', expectedAssignmentId: 'ca-1' },
      { type: 'UNASSIGN_CUSTOMER_FROM_ROUTE', customerId: 'customer-2', expectedAssignmentId: 'ca-2' },
      { type: 'ASSIGN_CUSTOMER_TO_ROUTE', customerId: 'customer-3', routeId: 'route-3' },
      { type: 'MOVE_ROUTE_TO_COLLECTOR', routeId: 'route-1', collectorUserId: 'collector-2', expectedAssignmentId: 'ra-1' },
      { type: 'UNASSIGN_ROUTE_FROM_COLLECTOR', routeId: 'route-2', expectedAssignmentId: 'ra-2' },
      { type: 'ASSIGN_ROUTE_TO_COLLECTOR', routeId: 'route-3', collectorUserId: 'collector-3' },
    ];
    const result = await repository.applyAssignmentBatch({ snapshotToken: token(initial), operations, actorId: 'admin-1' });
    expect(result.applied).toBe(6);
    expect(result.snapshotToken).toBe(token(state));
    expect(state.customers.filter((row) => row.endedAt)).toHaveLength(2);
    expect(state.collectors.filter((row) => row.endedAt)).toHaveLength(2);
    expect(state.customers.filter((row) => !row.endedAt).map((row) => [row.customerId, row.routeId])).toEqual(expect.arrayContaining([['customer-1', 'route-2'], ['customer-3', 'route-3']]));
    expect(state.collectors.filter((row) => !row.endedAt).map((row) => [row.routeId, row.collectorUserId])).toEqual(expect.arrayContaining([['route-1', 'collector-2'], ['route-3', 'collector-3'], ['route-4', 'collector-3']]));
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  });

  it('rejects a stale snapshot or expected assignment without applying changes', async () => {
    const initial = base();
    const { repository, state } = batchRepository(initial);
    await expect(repository.applyAssignmentBatch({ snapshotToken: '0'.repeat(64), operations: [{ type: 'UNASSIGN_CUSTOMER_FROM_ROUTE', customerId: 'customer-1', expectedAssignmentId: 'ca-1' }], actorId: 'admin-1' })).rejects.toBeInstanceOf(CustomerSiteConflictError);
    expect(state).toEqual(initial);
    await expect(repository.applyAssignmentBatch({ snapshotToken: token(initial), operations: [{ type: 'UNASSIGN_CUSTOMER_FROM_ROUTE', customerId: 'customer-1', expectedAssignmentId: 'wrong' }], actorId: 'admin-1' })).rejects.toBeInstanceOf(CustomerSiteConflictError);
    expect(state).toEqual(initial);
  });

  it('rolls the whole batch back and translates a unique-index race to a conflict', async () => {
    const initial = { ...base(), failInsertAt: 2 };
    const { repository, state } = batchRepository(initial);
    const operations: AssignmentBatchOperation[] = [
      { type: 'MOVE_CUSTOMER_TO_ROUTE', customerId: 'customer-1', routeId: 'route-2', expectedAssignmentId: 'ca-1' },
      { type: 'ASSIGN_CUSTOMER_TO_ROUTE', customerId: 'customer-3', routeId: 'route-3' },
    ];
    await expect(repository.applyAssignmentBatch({ snapshotToken: token(initial), operations, actorId: 'admin-1' })).rejects.toBeInstanceOf(CustomerSiteConflictError);
    expect(state).toEqual(initial);
  });

  it('rejects inactive references and a collector without an active linked user before writes', async () => {
    const initial = base();
    const withoutCollector = { ...initial, eligibleCollectors: ['collector-1', 'collector-2'] };
    const { repository, state } = batchRepository(withoutCollector);
    await expect(repository.applyAssignmentBatch({ snapshotToken: token(withoutCollector), operations: [{ type: 'ASSIGN_ROUTE_TO_COLLECTOR', routeId: 'route-3', collectorUserId: 'collector-3' }], actorId: 'admin-1' })).rejects.toBeInstanceOf(CustomerSiteNotFoundError);
    expect(state).toEqual(withoutCollector);
  });

  it.each([
    ['customer', { type: 'ASSIGN_CUSTOMER_TO_ROUTE', customerId: 'missing-customer', routeId: 'route-3' } as const],
    ['route', { type: 'ASSIGN_CUSTOMER_TO_ROUTE', customerId: 'customer-3', routeId: 'missing-route' } as const],
  ])('rejects a nonexistent or inactive %s reference', async (_kind, operation) => {
    const initial = base();
    const { repository, state } = batchRepository(initial);
    await expect(repository.applyAssignmentBatch({ snapshotToken: token(initial), operations: [operation], actorId: 'admin-1' })).rejects.toBeInstanceOf(CustomerSiteNotFoundError);
    expect(state).toEqual(initial);
  });

  it('never allows a second active owner even when the request calls it an assignment', async () => {
    const initial = base();
    const { repository, state } = batchRepository(initial);
    await expect(repository.applyAssignmentBatch({ snapshotToken: token(initial), operations: [{ type: 'ASSIGN_CUSTOMER_TO_ROUTE', customerId: 'customer-1', routeId: 'route-3' }], actorId: 'admin-1' })).rejects.toBeInstanceOf(CustomerSiteConflictError);
    await expect(repository.applyAssignmentBatch({ snapshotToken: token(initial), operations: [{ type: 'ASSIGN_ROUTE_TO_COLLECTOR', routeId: 'route-1', collectorUserId: 'collector-3' }], actorId: 'admin-1' })).rejects.toBeInstanceOf(CustomerSiteConflictError);
    expect(state).toEqual(initial);
  });
});
