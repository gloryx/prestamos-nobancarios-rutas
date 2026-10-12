import { EconomicCapitalTypeOrmReader } from '../src/infrastructure/database/typeorm/repositories/economic-capital.reader';

describe('economic capital reader cutoff', () => {
  it('uses economic dates, applies corrections retroactively and applies refunds on their real date', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ date: '2026-01-01', initialPortfolio: '0.00' }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await new EconomicCapitalTypeOrmReader({} as never).readSnapshot({ query } as never, '2026-01-31');
    const loansSql = query.mock.calls[1][0] as string;
    const refinancingsSql = query.mock.calls[2][0] as string;
    const paymentsSql = query.mock.calls[3][0] as string;
    expect(loansSql).toContain("changed_at AT TIME ZONE 'America/Costa_Rica'");
    expect(loansSql).toContain('l.start_date AS effective_date');
    expect(loansSql).toContain('r.refinancing_date AS effective_date');
    expect(loansSql).toContain("'REFINANCED'::text AS status");
    expect(loansSql).toContain("annulment.annulment_type = 'DATA_CORRECTION'");
    expect(loansSql).toContain("annulment.annulment_type = 'CASH_REFUND'");
    expect(loansSql).toContain("'ANNULLED'::text AS status");
    expect(loansSql).toContain("'ACTIVE'::text AS status");
    expect(loansSql).toContain("h.event_kind = 'TRANSITION'");
    expect(loansSql).toContain('h.refinancing_id IS NULL');
    expect(loansSql).toContain("h.to_status = 'REFINANCED'");
    expect(loansSql).toContain('historical_refinancing.origin_loan_id = h.loan_id');
    expect(loansSql).toContain("correction.annulment_type = 'DATA_CORRECTION'");
    expect(loansSql).toContain('h.payment_annulment_id');
    expect(loansSql).toContain('candidate.effective_date DESC, candidate.priority DESC, candidate.event_sequence DESC');
    expect(loansSql).toContain("CASE WHEN snapshot.status = 'CANCELLED' THEN snapshot.effective_date::text END");
    expect(loansSql).toContain('reversal.movement_date <= $1::date');
    expect(loansSql).toContain('corrected.new_loan_id = l.id');
    expect(loansSql).toContain("correction.annulment_type = 'DATA_CORRECTION'");
    expect(loansSql).not.toContain('COALESCE(snapshot.status');
    expect(paymentsSql).toContain("annulment.annulled_at AT TIME ZONE 'America/Costa_Rica'");
    expect(paymentsSql).toContain("annulment.annulment_type = 'DATA_CORRECTION'");
    expect(paymentsSql).toContain("annulment.annulment_type = 'CASH_REFUND'");
    expect(paymentsSql).toContain("annulment.annulment_type IS DISTINCT FROM 'DATA_CORRECTION'");
    expect(paymentsSql).toContain('reversal.movement_date <= $1::date');
    expect(paymentsSql).toContain("CASE WHEN annulment.id IS NULL THEN 'VALID' ELSE 'ANNULLED' END");
    expect(refinancingsSql).toContain('r.status AS status');
    expect(refinancingsSql).toContain('annulment.annulment_type AS "annulmentType"');
    expect(refinancingsSql).toContain('annulment.effective_date::text AS "annulmentEffectiveDate"');
    expect(refinancingsSql).toContain("annulment.annulment_type IS DISTINCT FROM 'DATA_CORRECTION'");
  });
});
