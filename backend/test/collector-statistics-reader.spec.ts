import { COLLECTOR_STATISTICS_SQL, CollectorStatisticsTypeOrmReader } from '../src/infrastructure/database/typeorm/repositories/collector-statistics.reader';

describe('CollectorStatisticsTypeOrmReader', () => {
  it('uses one statement and maps exact decimal strings and aggregate arrays', async () => {
    const row = {
      totalCollectors: 1, activeCollectors: 1, inactiveCollectors: 0,
      collectorsWithValidPayments: 1, collectorsWithoutValidPayments: 0,
      activeCollectorsWithoutValidPayments: 0, linkedCollectors: 1, unlinkedCollectors: 0,
      validPaymentsCount: 2, totalCollectedAmount: '100.00', principalAppliedAmount: '70.00',
      interestAppliedAmount: '30.00', averageValidPaymentAmount: '50.00',
      annulledPaymentsCount: 1, annulledAmount: '25.00',
      byCollector: [{ collectorId: 'c1' }], paymentMethods: [{ paymentMethodId: 'm1' }],
      evolution: [{ period: '2026-01' }],
      unattributedPayments: { validPaymentsCount: 0, totalCollectedAmount: '0.00',
        annulledPaymentsCount: 0, annulledAmount: '0.00' },
    };
    const source = { query: jest.fn().mockResolvedValue([row]), transaction: jest.fn() };
    const result = await new CollectorStatisticsTypeOrmReader(source as never).read({
      year: 2026, month: null, startDate: '2026-01-01', endDate: '2026-12-31', granularity: 'MONTH',
    });
    expect(source.query).toHaveBeenCalledTimes(1);
    expect(source.query).toHaveBeenCalledWith(COLLECTOR_STATISTICS_SQL,
      ['2026-01-01', '2026-12-31', 'MONTH']);
    expect(source.transaction).not.toHaveBeenCalled();
    expect(result.summary).toMatchObject({ totalCollectedAmount: '100.00',
      principalAppliedAmount: '70.00', interestAppliedAmount: '30.00' });
    expect(result.byCollector).toEqual(row.byCollector);
  });

  it('encodes attribution, validity, annulment audit, current assignments and complete zero buckets in SQL', () => {
    expect(COLLECTOR_STATISTICS_SQL).toContain('JOIN collectors collector ON collector.id = payment.collector_id');
    expect(COLLECTOR_STATISTICS_SQL).toContain(`payment.status = 'VALID'`);
    expect(COLLECTOR_STATISTICS_SQL).toContain(`payment.status = 'ANNULLED'`);
    expect(COLLECTOR_STATISTICS_SQL).toContain('SUM(payment.amount)');
    expect(COLLECTOR_STATISTICS_SQL).not.toContain('principal_applied +');
    expect(COLLECTOR_STATISTICS_SQL).toContain('assignment.ended_at IS NULL');
    expect(COLLECTOR_STATISTICS_SQL).toContain('COUNT(DISTINCT customer_assignment.customer_id)');
    expect(COLLECTOR_STATISTICS_SQL).toContain('generate_series($1::date, $2::date');
    expect(COLLECTOR_STATISTICS_SQL).toContain('NOT EXISTS (SELECT 1 FROM collectors');
  });
});
