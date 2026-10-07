import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { PATH_METADATA } from '@nestjs/common/constants';
import { CollectorFinancialSummaryForbiddenError, CollectorFinancialSummaryIntegrityError, CollectorFinancialSummaryUseCase, type CollectorFinancialSummaryReader } from '../src/application/collector/collector-financial-summary.use-case';
import { CollectorFinancialSummaryTypeormReader } from '../src/infrastructure/database/typeorm/repositories/collector-financial-summary.reader';
import { CollectorController } from '../src/presentation/collector/collector.controller';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

const actor = (id = '550e8400-e29b-41d4-a716-446655440000') => ({ id, username: 'collector', fullName: 'Collector', sessionId: 'session',
  permissions: ['collectors.financial-summary.view'], role: { id: 'role', code: 'COLLECTOR', name: 'Collector', isSuperAdmin: false } });
const zero = { totalPlaced: '0.00', totalOutstanding: '0.00', realizedGain: '0.00', activeLoansCount: 0 };

const readWith = async (row = zero) => {
  let sql = ''; let params: unknown[] = [];
  const source = { query: jest.fn(async (statement: string, values: unknown[]) => {
    sql = statement; params = values; return [{ ...row, integrityFailures: 0 }];
  }) };
  const result = await new CollectorFinancialSummaryTypeormReader(source as unknown as DataSource).read(actor().id);
  return { result, sql, params, query: source.query };
};

describe('collector financial summary', () => {
  it('derives the scope only from the authenticated active collector without accepting collectorId', async () => {
    const reader = { read: jest.fn(async (_userId: string) => zero) } as jest.Mocked<CollectorFinancialSummaryReader>;
    const useCase = new CollectorFinancialSummaryUseCase(reader);
    await expect(useCase.execute(actor())).resolves.toEqual(zero);
    expect(reader.read).toHaveBeenCalledWith(actor().id);
    expect(CollectorFinancialSummaryUseCase.prototype.execute).toHaveLength(1);
  });

  it('returns zero values for an active collector without routes or customers', async () => {
    const reader = { read: jest.fn(async (_userId: string) => zero) } as jest.Mocked<CollectorFinancialSummaryReader>;
    await expect(new CollectorFinancialSummaryUseCase(reader).execute(actor())).resolves.toEqual(zero);
  });

  it('rejects invalid collectors and non-collector identities', async () => {
    const reader = { read: jest.fn(async (_userId: string) => null) } as jest.Mocked<CollectorFinancialSummaryReader>;
    await expect(new CollectorFinancialSummaryUseCase(reader).execute(actor())).rejects.toBeInstanceOf(CollectorFinancialSummaryForbiddenError);
    await expect(new CollectorFinancialSummaryUseCase(reader).execute({ ...actor(), role: { ...actor().role, code: 'ADMIN' } })).rejects.toBeInstanceOf(CollectorFinancialSummaryForbiddenError);
  });

  it('uses one aggregate snapshot with current active route ownership and excludes another collector scope', async () => {
    const { result, sql, params, query } = await readWith();
    expect(result).toEqual(zero);
    expect(query).toHaveBeenCalledTimes(1);
    expect(params).toEqual([actor().id]);
    expect(sql).toContain("role.code='COLLECTOR'");
    expect(sql).toContain('cl.user_id=u.id AND cl.is_active=true');
    expect(sql).toContain('cra.collector_user_id=$1::uuid');
    expect(sql).toContain('SELECT DISTINCT c.id');
    expect(sql).toContain('cra.ended_at IS NULL');
    expect(sql).toContain('ca.ended_at IS NULL');
    expect(sql).toContain('r.is_active=true');
    expect(sql).toContain('c.is_active=true');
  });

  it('includes only ACTIVE loans, excluding CANCELLED, REFINANCED, UNCOLLECTIBLE and ANNULLED', async () => {
    const { sql } = await readWith();
    expect(sql.match(/l\.status='ACTIVE'/g)).toHaveLength(1);
    for (const status of ['CANCELLED', 'REFINANCED', 'UNCOLLECTIBLE', 'ANNULLED']) expect(sql).not.toContain(`l.status='${status}'`);
  });

  it('sums contractual principal once per scoped active loan for total placed', async () => {
    const { result, sql } = await readWith({ totalPlaced: '300000.00', totalOutstanding: '275000.00', realizedGain: '5000.00', activeLoansCount: 2 });
    expect(result!.totalPlaced).toBe('300000.00');
    expect(sql).toContain('SELECT l.id,l.customer_id,l.principal,l.interest_amount,l.total_amount');
    expect(sql).toContain('COALESCE(SUM(principal),0)::numeric(38,2)::text AS total_placed');
    expect(sql).not.toContain('outstanding_principal_transferred');
    expect(sql).not.toContain('new_money_disbursed');
  });

  it('uses total contractual amount minus VALID payments for total outstanding and fails closed on inconsistency', async () => {
    let sql = '';
    const source = { query: jest.fn(async (statement: string) => { sql = statement; return [{ ...zero, integrityFailures: 1 }]; }) };
    await expect(new CollectorFinancialSummaryTypeormReader(source as unknown as DataSource).read(actor().id))
      .rejects.toBeInstanceOf(CollectorFinancialSummaryIntegrityError);
    expect(sql).toContain("p.status='VALID'");
    expect(sql).toContain('l.total_amount-COALESCE(p.paid_amount,0)');
    expect(sql).toContain('p.principal_applied');
    expect(sql).toContain('p.interest_applied');
    expect(sql).toContain('COALESCE(plan.pending_amount,0)');
  });

  it('calculates realized gain only from interest actually applied by VALID payments', async () => {
    const { result, sql } = await readWith({ totalPlaced: '100000.00', totalOutstanding: '10000.00', realizedGain: '15000.00', activeLoansCount: 1 });
    expect(result!.realizedGain).toBe('15000.00');
    expect(sql).toContain("WHERE p.status='VALID'");
    expect(sql).toContain('COALESCE(SUM(p.interest_applied),0) AS paid_interest');
    expect(sql).toContain('COALESCE(p.paid_interest,0) AS realized_gain');
    expect(sql).not.toContain('paid_amount-paid_principal');
    expect(sql).not.toContain('interest_amount-paid_interest');
  });

  it('does not treat a payment applied only to principal as realized gain', async () => {
    const { sql } = await readWith({ totalPlaced: '100000.00', totalOutstanding: '50000.00', realizedGain: '0.00', activeLoansCount: 1 });
    expect(sql).toContain('SUM(p.principal_applied)');
    expect(sql).toContain('SUM(p.interest_applied)');
    expect(sql).toContain('SUM(realized_gain)');
    expect(sql).not.toContain('SUM(p.amount) AS paid_interest');
  });

  it('increments realized gain when the authoritative payment allocation reaches interest', async () => {
    const { result } = await readWith({ totalPlaced: '100000.00', totalOutstanding: '25000.00', realizedGain: '7500.00', activeLoansCount: 1 });
    expect(result!.realizedGain).toBe('7500.00');
  });

  it('counts active loans rather than customers, including two loans for one assigned customer', async () => {
    const { result, sql } = await readWith({ totalPlaced: '200000.00', totalOutstanding: '175000.00', realizedGain: '5000.00', activeLoansCount: 2 });
    expect(result!.activeLoansCount).toBe(2);
    expect(sql).toContain('COUNT(*)::int AS active_loans_count');
    expect(sql).not.toContain('COUNT(DISTINCT customer_id)');
  });

  it('exposes one me endpoint with a dedicated scoped permission and no input DTO', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CollectorController.prototype.getFinancialSummary)).toBe('me/financial-summary');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CollectorController.prototype.getFinancialSummary)).toEqual(['collectors.financial-summary.view']);
    expect(CollectorController.prototype.getFinancialSummary).toHaveLength(1);
  });
});
