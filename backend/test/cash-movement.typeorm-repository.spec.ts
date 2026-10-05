import { CashMovementTypeOrmRepository } from '../src/infrastructure/database/typeorm/repositories/cash-movement.typeorm-repository';
import { CashMovementConflictError } from '../src/domain/cash-movement/cash-movement.errors';

function queryBuilder(raw: unknown, rows: unknown[] = [], total = 0) {
  const calls: string[] = [];
  const builder = { calls, leftJoinAndSelect: (path: string, alias: string) => { calls.push(`join:${path}:${alias}`); return builder; }, leftJoin: (_entity: unknown, alias: string, condition: string) => { calls.push(`${alias}:${condition}`); return builder; }, andWhere: (sql: string) => { calls.push(sql); return builder; }, orderBy: (path: string) => { calls.push(path); return builder; }, addOrderBy: (path: string) => { calls.push(path); return builder; }, skip: (offset: number) => { calls.push(`skip:${offset}`); return builder; }, take: (limit: number) => { calls.push(`take:${limit}`); return builder; }, select: (sql: string) => { calls.push(sql); return builder; }, addSelect: (sql: string) => { calls.push(sql); return builder; }, getManyAndCount: async () => { calls.push('getManyAndCount'); return [rows, total]; }, getRawAndEntities: async () => ({ raw, entities: rows }), getCount: async () => total, getRawOne: async () => raw };
  return builder;
}

const movement = (id: string, concept: string, links: Record<string, string | null> = {}) => ({
  id, concept, direction: 'INFLOW', loanDisbursementId: null, paymentId: null, reversedMovementId: null,
  paymentMethod: { id: 'pm', name: 'Cash', isActive: true }, createdBy: { id: 'actor', fullName: 'Actor' }, ...links,
});

describe('CashMovementTypeOrmRepository', () => {
  it('resolves the new loan number for a refinancing new-money outflow', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ id: 'dis-new', loanNumber: '150' }]);
    const repo = new CashMovementTypeOrmRepository({ createQueryBuilder: () => queryBuilder(undefined,
      [movement('new-money', 'REFINANCING_NEW_MONEY_DISBURSEMENT', { loanDisbursementId: 'dis-new' })], 1) } as never,
    { query } as never);
    const result = await repo.list({ page: 1, pageSize: 20 });
    expect(result.items[0].loanNumber).toBe('150');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('uses entity property paths for ordering while retaining physical SQL filters', async () => {
    const builder = queryBuilder(undefined);
    const repository = new CashMovementTypeOrmRepository({ createQueryBuilder: () => builder } as never, {} as never);
    await repository.list({ page: 1, pageSize: 20, fromDate: '2026-01-01' });
    expect(builder.calls).toEqual(expect.arrayContaining(['m.movementDate', 'm.createdAt', 'm.movement_date >= :fromDate']));
    expect(builder.calls).not.toEqual(expect.arrayContaining(['m.movement_date', 'm.created_at']));
  });

  it('preserves the original paginated builder, including filtering, sorting, count, and page boundaries', async () => {
    const builder = queryBuilder(undefined, [movement('manual', 'OPERATING_EXPENSE')], 47);
    const query = jest.fn();
    const repository = new CashMovementTypeOrmRepository({ createQueryBuilder: () => builder } as never, { query } as never);
    const result = await repository.list({ page: 2, pageSize: 20, fromDate: '2026-01-01', search: 'Cash' });
    expect(builder.calls).toEqual([
      'join:m.paymentMethod:pm', 'join:m.createdBy:u', 'm.movement_date >= :fromDate',
      '(m.concept ILIKE :search OR m.observations ILIKE :search OR pm.name ILIKE :search OR u.full_name ILIKE :search)',
      'm.movementDate', 'm.createdAt', 'skip:20', 'take:20', 'getManyAndCount',
    ]);
    expect(query).not.toHaveBeenCalled();
    expect(result).toMatchObject({ total: 47, items: [{ id: 'manual', loanNumber: null, reversedConcept: null }] });
  });

  it('enriches mixed pages with three parameterized lookups and never changes the page order or count', async () => {
    const rows = [
      movement('payment', 'CUSTOMER_PAYMENT', { paymentId: 'pay-1' }),
      movement('reverse-payment', 'REVERSAL', { reversedMovementId: 'original-payment' }),
      movement('disbursement', 'LOAN_DISBURSEMENT', { loanDisbursementId: 'dis-1' }),
      movement('reverse-disbursement', 'REVERSAL', { reversedMovementId: 'original-disbursement' }),
      movement('reverse-manual', 'REVERSAL', { reversedMovementId: 'original-manual' }),
      movement('missing-original', 'REVERSAL', { reversedMovementId: 'missing' }),
      movement('reverse-chain', 'REVERSAL', { reversedMovementId: 'original-reversal' }),
      movement('reverse-legacy', 'REVERSAL', { reversedMovementId: 'original-legacy' }),
      movement('legacy-payment', 'CUSTOMER_PAYMENT'),
      movement('manual', 'OPERATING_EXPENSE', { paymentId: 'unrelated' }),
    ];
    const builder = queryBuilder(undefined, rows, 298);
    const query = jest.fn().mockResolvedValueOnce([
      { id: 'original-payment', concept: 'CUSTOMER_PAYMENT', paymentId: 'pay-1', loanDisbursementId: null },
      { id: 'original-disbursement', concept: 'LOAN_DISBURSEMENT', loanDisbursementId: 'dis-1', paymentId: null },
      { id: 'original-manual', concept: 'OPERATING_EXPENSE', paymentId: 'unrelated', loanDisbursementId: null },
      { id: 'original-reversal', concept: 'REVERSAL', paymentId: 'unrelated', loanDisbursementId: 'dis-1' },
      { id: 'original-legacy', concept: 'CUSTOMER_PAYMENT', paymentId: null, loanDisbursementId: null },
    ]).mockResolvedValueOnce([{ id: 'dis-1', loanNumber: '125' }]).mockResolvedValueOnce([{ id: 'pay-1', loanNumber: '126' }]);
    const repository = new CashMovementTypeOrmRepository({ createQueryBuilder: () => builder } as never, { query } as never);
    const result = await repository.list({ page: 3, pageSize: 20 });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]).toEqual([expect.stringContaining('FROM cash_movements WHERE id = ANY($1::uuid[])'), [['original-payment', 'original-disbursement', 'original-manual', 'missing', 'original-reversal', 'original-legacy']]]);
    expect(query.mock.calls[1]).toEqual([expect.stringContaining('FROM loan_disbursements d JOIN loans l ON l.id = d.loan_id WHERE d.id = ANY($1::uuid[])'), [['dis-1']]]);
    expect(query.mock.calls[2]).toEqual([expect.stringContaining('FROM payments p JOIN loans l ON l.id = p.loan_id WHERE p.id = ANY($1::uuid[])'), [['pay-1']]]);
    expect(query.mock.calls[1][0]).toContain('l.loan_number::text');
    expect(query.mock.calls[2][0]).toContain('l.loan_number::text');
    expect(query.mock.calls.flatMap(([sql]) => sql).join(' ')).not.toMatch(/status|observations|amount|movement_date/);
    expect(builder.calls).toEqual(['join:m.paymentMethod:pm', 'join:m.createdBy:u', 'm.movementDate', 'm.createdAt', 'skip:40', 'take:20', 'getManyAndCount']);
    expect(result.total).toBe(298);
    expect(result.items).toHaveLength(rows.length);
    expect(result.items.map(({ id, loanNumber, reversedConcept }) => [id, loanNumber, reversedConcept])).toEqual([
      ['payment', '126', null], ['reverse-payment', '126', 'CUSTOMER_PAYMENT'],
      ['disbursement', '125', null], ['reverse-disbursement', '125', 'LOAN_DISBURSEMENT'],
      ['reverse-manual', null, null], ['missing-original', null, null], ['reverse-chain', null, null],
      ['reverse-legacy', null, 'CUSTOMER_PAYMENT'],
      ['legacy-payment', null, null], ['manual', null, null],
    ]);
  });

  it('skips empty lookup groups, handles missing relations, and batches repeated IDs without per-row queries', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repositoryFor = (rows: unknown[], total: number) => new CashMovementTypeOrmRepository(
      { createQueryBuilder: () => queryBuilder(undefined, rows, total) } as never, { query } as never,
    );
    expect(await repositoryFor([], 12).list({ page: 2, pageSize: 20 })).toEqual({ items: [], total: 12 });
    expect(query).not.toHaveBeenCalled();
    const rows = Array.from({ length: 100 }, (_, index) => movement(`payment-${index}`, 'CUSTOMER_PAYMENT', { paymentId: 'same-payment' }));
    const result = await repositoryFor(rows, 240).list({ page: 1, pageSize: 100 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([['same-payment']]);
    expect(result.items).toHaveLength(100);
    expect(result.items.every((item) => item.loanNumber === null && item.reversedConcept === null)).toBe(true);
    expect(result.total).toBe(240);
  });

  it('returns SQL decimal strings exactly and null current availability without an opening', async () => {
    const builder = queryBuilder({ inflows: '9999999999999999.99', outflows: '0.01', net: '9999999999999999.98' });
    const movementRepository = { createQueryBuilder: () => builder };
    const openingRepository = { findOne: async () => null };
    const repository = new CashMovementTypeOrmRepository(movementRepository as never, { getRepository: (entity: unknown) => entity === undefined ? movementRepository : openingRepository } as never);
    const result = await repository.summary({});
    expect(result).toEqual({ inflows: '9999999999999999.99', outflows: '0.01', net: '9999999999999999.98', currentAvailable: null, openingDate: null });
    expect(builder.calls.some((call) => call.includes("'net'") || call.includes('INFLOW'))).toBe(true);
  });

  it('rejects a second reversal instead of returning the existing reversal', async () => {
    const existingReversal = { id: 'reversal-1' };
    const transactionalRepository = { findOne: async () => existingReversal };
    const repository = new CashMovementTypeOrmRepository({} as never, { transaction: async (callback: (manager: { getRepository: () => typeof transactionalRepository }) => Promise<unknown>) => callback({ getRepository: () => transactionalRepository }) } as never);
    await expect(repository.reverse({ id: 'original-1' } as never, {} as never)).rejects.toThrow(new CashMovementConflictError('El movimiento ya fue reversado.'));
  });

  it('runs create and reverse callbacks with the EntityManager before saving', async () => {
    const order: string[] = [];
    const entity = { ...movement('saved', 'CAPITAL_CONTRIBUTION'), amount: '10.00', movementDate: '2026-01-01',
      paymentMethodId: 'pm', observations: null, createdByUserId: 'actor', idempotencyKey: null, idempotencyFingerprint: null,
      createdAt: new Date() };
    const transactionalRepository = { findOne: jest.fn(async ({ where }: { where: { reversedMovementId?: string; id?: string } }) => {
      if (where.reversedMovementId) return null; return entity;
    }), findOneOrFail: jest.fn(async () => entity), create: jest.fn((input) => input),
    save: jest.fn(async (input) => { order.push('save'); return { ...input, id: 'saved' }; }) };
    const manager = { id: 'manager', getRepository: () => transactionalRepository };
    const repository = new CashMovementTypeOrmRepository({} as never, {
      transaction: async (work: (value: typeof manager) => Promise<unknown>) => work(manager),
    } as never);
    await repository.create({} as never, async (context) => { expect(context).toBe(manager); order.push('create-guard'); });
    await repository.reverse({ id: 'original' } as never, {} as never,
      async (context) => { expect(context).toBe(manager); order.push('reverse-guard'); });
    expect(order).toEqual(['create-guard', 'save', 'reverse-guard', 'save']);
  });
});
