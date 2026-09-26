import { CashMovementTypeOrmRepository } from '../src/infrastructure/database/typeorm/repositories/cash-movement.typeorm-repository';
import { CashMovementConflictError } from '../src/domain/cash-movement/cash-movement.errors';

function queryBuilder(raw: unknown, rows: unknown[] = [], total = 0) {
  const calls: string[] = [];
  const builder = { calls, leftJoinAndSelect: () => builder, leftJoin: (_entity: unknown, alias: string, condition: string) => { calls.push(`${alias}:${condition}`); return builder; }, andWhere: (sql: string) => { calls.push(sql); return builder; }, orderBy: (path: string) => { calls.push(path); return builder; }, addOrderBy: (path: string) => { calls.push(path); return builder; }, skip: () => builder, take: () => builder, select: (sql: string) => { calls.push(sql); return builder; }, addSelect: (sql: string) => { calls.push(sql); return builder; }, getRawAndEntities: async () => ({ raw, entities: rows }), getCount: async () => total, getRawOne: async () => raw };
  return builder;
}

describe('CashMovementTypeOrmRepository', () => {
  it('uses entity property paths for ordering while retaining physical SQL filters', async () => {
    const builder = queryBuilder(undefined);
    const repository = new CashMovementTypeOrmRepository({ createQueryBuilder: () => builder } as never, {} as never);
    await repository.list({ page: 1, pageSize: 20, fromDate: '2026-01-01' });
    expect(builder.calls).toEqual(expect.arrayContaining(['m.movementDate', 'm.createdAt', 'm.movement_date >= :fromDate']));
    expect(builder.calls).not.toEqual(expect.arrayContaining(['m.movement_date', 'm.created_at']));
  });

  it('resolves loan numbers through disbursement and payment joins in the paginated query', async () => {
    const builder = queryBuilder([{ movementId: 'movement-1', loanNumber: '42' }], [{ id: 'movement-1', direction: 'INFLOW', concept: 'LOAN_DISBURSEMENT', paymentMethod: { id: 'pm', name: 'Cash', isActive: true }, createdBy: { id: 'actor', fullName: 'Actor' } }], 1);
    const repository = new CashMovementTypeOrmRepository({ createQueryBuilder: () => builder } as never, {} as never);
    const result = await repository.list({ page: 2, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(builder.calls).toEqual(expect.arrayContaining(['ld:ld.id = m.loan_disbursement_id', 'p:p.id = m.payment_id', 'COALESCE(disbursementLoan.loan_number, paymentLoan.loan_number)']));
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
});
