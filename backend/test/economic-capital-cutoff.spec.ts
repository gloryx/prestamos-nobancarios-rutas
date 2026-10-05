import { EconomicCapitalTypeOrmReader } from '../src/infrastructure/database/typeorm/repositories/economic-capital.reader';

describe('economic capital reader cutoff', () => {
  it('excludes annulments, status dates, and reversals after the requested cutoff', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ date: '2026-01-01', initialPortfolio: '0.00' }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await new EconomicCapitalTypeOrmReader({} as never).readSnapshot({ query } as never, '2026-01-31');
    const loansSql = query.mock.calls[1][0] as string;
    const paymentsSql = query.mock.calls[3][0] as string;
    expect(loansSql).toContain("changed_at AT TIME ZONE 'America/Costa_Rica'");
    expect(loansSql).toContain('reversal.movement_date <= $1::date');
    expect(loansSql).not.toContain('COALESCE(snapshot.status,l.status)');
    expect(paymentsSql).toContain("annulment.annulled_at AT TIME ZONE 'America/Costa_Rica'");
    expect(paymentsSql).toContain('reversal.movement_date <= $1::date');
    expect(paymentsSql).toContain("CASE WHEN annulment.id IS NULL THEN 'VALID' ELSE 'ANNULLED' END");
  });
});
