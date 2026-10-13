import type { DataSource } from 'typeorm';
import { CollectorPrecollectionTypeOrmStore } from '../src/infrastructure/database/typeorm/repositories/collector-precollection.typeorm-store';
import { CollectorPrecollectionConflictError, CollectorPrecollectionForbiddenError,
  CollectorPrecollectionValidationError } from '../src/domain/collector-precollection/collector-precollection.errors';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const actorUserId = uuid(1);
const collectorId = uuid(2);
const customerId = uuid(3);
const loanId = uuid(4);
const routeId = uuid(5);
const customerAssignmentId = uuid(6);
const collectorAssignmentId = uuid(7);
const methodId = uuid(8);

type Options = { actor?: boolean; assigned?: boolean; activeMethod?: boolean; closedThrough?: string | null;
  planBalance?: string; financialBalance?: string; reserved?: string; methodName?: string; custodyBalance?: string };

function harness(options: Options = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const rows: Array<Record<string, unknown>> = [];
  const custody: Array<Record<string, unknown>> = [];
  const query = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    calls.push({ sql, params });
    if (sql.includes('FROM collector_precollections WHERE idempotency_key')) {
      const found = rows.find((row) => row.idempotencyKey === params[0]);
      return found ? [{ id: found.id, fingerprint: found.fingerprint, collectorUserId: found.collectorUserId }] : [];
    }
    if (sql.includes('FROM users actor') && sql.includes('JOIN collectors collector')) {
      return options.actor === false ? [] : [{ collectorId }];
    }
    if (sql.includes('FROM loans WHERE id = $1 FOR UPDATE')) {
      return params[0] === loanId ? [{ id: loanId, customerId, status: 'ACTIVE', totalAmount: '100.00' }] : [];
    }
    if (sql.includes('pg_advisory_xact_lock_shared')) return [];
    if (sql.includes("pg_advisory_xact_lock(hashtext('collector-custody:'")) return [];
    if (sql.includes('FROM financial_openings')) return [{ openingDate: '2026-01-01' }];
    if (sql.includes('FROM financial_closes')) return options.closedThrough ? [{ toDate: options.closedThrough }] : [];
    if (sql.includes('FROM payment_methods') && sql.includes('FOR SHARE')) {
      return options.activeMethod === false ? [] : [{ id: methodId, name: options.methodName ?? 'EFECTIVO' }];
    }
    if (sql.includes('FROM customer_route_assignments')) return options.assigned === false ? [] : [{
      customerRouteAssignmentId: customerAssignmentId, collectorRouteAssignmentId: collectorAssignmentId, routeId,
    }];
    if (sql.includes('AS "planBalance"')) return [{ planBalance: options.planBalance ?? '100.00',
      financialBalance: options.financialBalance ?? '100.00', reserved: options.reserved ?? '0.00' }];
    if (sql.startsWith('INSERT INTO collector_precollections')) {
      const id = uuid(20 + rows.length);
      rows.push({ id, collectorId, collectorUserId: actorUserId, customerId, loanId, routeId,
        customerRouteAssignmentId: customerAssignmentId, collectorRouteAssignmentId: collectorAssignmentId,
        paymentMethodId: methodId, custodyTreatment: params[8], amount: params[9], effectiveDate: params[10], reference: params[11], notes: params[12],
        status: 'RECORDED', recordedByUserId: actorUserId, idempotencyKey: params[13], fingerprint: params[14],
        cancellationKey: null, cancellationReason: null });
      return [{ id }];
    }
    if (sql.startsWith('INSERT INTO collector_custody_entries')) {
      const entry = { id: uuid(80 + custody.length), type: sql.includes("'REVERSAL'") ? 'REVERSAL' : 'CUSTOMER_COLLECTION' };
      custody.push(entry); return [entry];
    }
    if (sql.includes('FROM collector_custody_entries') && sql.includes("entry_type = 'CUSTOMER_COLLECTION'")) {
      return custody.filter((entry) => entry.type === 'CUSTOMER_COLLECTION').map((entry) => ({ id: entry.id }));
    }
    if (sql.includes('AS balance') && sql.includes('collector_custody_entries')) return [{
      balance: options.custodyBalance ?? '25.00', reservedOther: '0.00',
    }];
    if (sql.includes('FROM collector_precollections cp') && sql.includes('WHERE cp.id = $1')) {
      const row = rows.find((item) => item.id === params[0]);
      return row ? [{ ...row, collectorName: 'Collector', customerName: 'Customer', customerIdentification: '1',
        loanNumber: '10', routeName: 'Route', paymentMethodName: options.methodName ?? 'EFECTIVO',
        recordedByName: 'Collector', cancelledByName: null }] : [];
    }
    if (sql.includes('cancellation_idempotency_key AS "cancellationKey"') && sql.includes('FOR UPDATE')) {
      return rows.filter((item) => item.id === params[0]).map((item) => ({ id: item.id, status: item.status,
        collectorId: item.collectorId, custodyTreatment: item.custodyTreatment, amount: item.amount,
        effectiveDate: item.effectiveDate, paymentMethodId: item.paymentMethodId, collectorUserId: item.collectorUserId,
        cancellationKey: item.cancellationKey, fingerprint: item.cancellationFingerprint }));
    }
    if (sql.includes('WHERE cancellation_idempotency_key = $1 FOR SHARE')) {
      return rows.filter((item) => item.cancellationKey === params[0]).map((item) => ({ id: item.id }));
    }
    if (sql.startsWith('UPDATE collector_precollections SET status')) {
      const row = rows.find((item) => item.id === params[4])!;
      Object.assign(row, { status: 'CANCELLED', cancellationReason: params[0], cancelledByUserId: params[1],
        cancelledAt: new Date(), cancellationKey: params[2], cancellationFingerprint: params[3] });
      return [];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const source = { query, transaction: async <T>(run: (manager: { query: typeof query }) => Promise<T>) => run({ query }) };
  return { store: new CollectorPrecollectionTypeOrmStore(source as unknown as DataSource), calls, rows, custody };
}

const command = { customerId, loanId, paymentMethodId: methodId, custodyTreatment: 'COLLECTOR_HELD' as const, amount: '25.00', effectiveDate: '2026-10-12',
  reference: null, notes: 'Customer receipt', idempotencyKey: 'capture-1' };

describe('collector precollection TypeORM store', () => {
  it('records only the operational fact with immutable assignment snapshots', async () => {
    const { store, rows, calls, custody } = harness();
    await expect(store.create(command, actorUserId, 'fingerprint')).resolves.toMatchObject({
      collectorId, customerId, loanId, routeId, customerRouteAssignmentId: customerAssignmentId,
      collectorRouteAssignmentId: collectorAssignmentId, amount: '25.00', status: 'RECORDED', notes: 'Customer receipt',
    });
    expect(rows).toHaveLength(1);
    expect(calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/.test(sql)).map(({ sql }) => sql.split(/\s+/).slice(0, 3).join(' ')))
      .toEqual(['INSERT INTO collector_precollections', 'INSERT INTO collector_custody_entries']);
    expect(custody).toHaveLength(1);
    expect(calls.some(({ sql }) => /INSERT INTO (payments|cash_movements|payment_applications)/.test(sql))).toBe(false);
  });

  it('replays the same create key and rejects a different fingerprint', async () => {
    const { store, rows } = harness();
    const first = await store.create(command, actorUserId, 'fingerprint');
    await expect(store.create(command, actorUserId, 'fingerprint')).resolves.toMatchObject({ id: first.id });
    expect(rows).toHaveLength(1);
    await expect(store.create(command, actorUserId, 'different')).rejects.toMatchObject({ reasonCode: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it.each([
    [{ actor: false }, CollectorPrecollectionForbiddenError],
    [{ assigned: false }, CollectorPrecollectionForbiddenError],
    [{ activeMethod: false }, CollectorPrecollectionValidationError],
    [{ closedThrough: '2026-10-12' }, CollectorPrecollectionConflictError],
    [{ reserved: '80.00' }, CollectorPrecollectionValidationError],
    [{ planBalance: '99.00' }, CollectorPrecollectionConflictError],
  ] as const)('rejects invalid operational context %j', async (configuration, ErrorType) => {
    const { store, rows } = harness(configuration);
    await expect(store.create(command, actorUserId, 'fingerprint')).rejects.toBeInstanceOf(ErrorType);
    expect(rows).toHaveLength(0);
  });

  it('requires references for non-cash methods', async () => {
    const { store } = harness({ methodName: 'SINPE' });
    await expect(store.create(command, actorUserId, 'fingerprint')).rejects.toMatchObject({ reasonCode: 'REFERENCE_REQUIRED' });
  });

  it('uses explicit custody treatment rather than the payment method name', async () => {
    const held = harness({ methodName: 'SINPE' });
    await held.store.create({ ...command, reference: 'electronic-ref' }, actorUserId, 'held');
    expect(held.custody).toHaveLength(1);
    const company = harness({ methodName: 'EFECTIVO' });
    await company.store.create({ ...command, custodyTreatment: 'COMPANY_RECEIVED' }, actorUserId, 'company');
    expect(company.custody).toHaveLength(0);
  });

  it('cancels once with audit and makes cancellation idempotent', async () => {
    const { store, rows, custody } = harness();
    const created = await store.create(command, actorUserId, 'fingerprint');
    await expect(store.cancel(created.id, 'Duplicate', 'cancel-1', 'cancel-fingerprint', actorUserId, false))
      .resolves.toMatchObject({ status: 'CANCELLED', cancellationReason: 'Duplicate' });
    await expect(store.cancel(created.id, 'Duplicate', 'cancel-1', 'cancel-fingerprint', actorUserId, false))
      .resolves.toMatchObject({ status: 'CANCELLED' });
    expect(rows).toHaveLength(1);
    expect(custody.map((entry) => entry.type)).toEqual(['CUSTOMER_COLLECTION', 'REVERSAL']);
  });

  it('serializes cancellation with custody debits and rejects a reversal that would make custody negative', async () => {
    const test = harness({ custodyBalance: '10.00' });
    const created = await test.store.create(command, actorUserId, 'fingerprint');
    await expect(test.store.cancel(created.id, 'Duplicate', 'cancel-1', 'cancel-fingerprint', actorUserId, false))
      .rejects.toMatchObject({ reasonCode: 'INSUFFICIENT_AVAILABLE_CUSTODY' });
    expect(test.custody.map((entry) => entry.type)).toEqual(['CUSTOMER_COLLECTION']);
    const lock = test.calls.findIndex(({ sql }) => sql.includes("pg_advisory_xact_lock(hashtext('collector-custody:'"));
    const balance = test.calls.findIndex(({ sql }) => sql.includes('AS balance'));
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(balance);
  });
});
