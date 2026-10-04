import { CUSTOMER_STATISTICS_SQL, CustomerStatisticsTypeOrmReader } from '../src/infrastructure/database/typeorm/repositories/customer-statistics.reader';

describe('CustomerStatisticsTypeOrmReader', () => {
  it('uses one aggregate statement, one row per customer and formal refinancing relations', async () => {
    const row: Record<string, number> = {
      totalCustomers: 3, customersWithActiveDebt: 1, customersWithUncollectibleDebt: 1,
      customersWithRefinancingHistory: 1, customersWithCancelledLoans: 1, customersWithAnnulledLoans: 1,
      customersWithMultipleLoans: 1, validLoanCount: 4, newCustomersInYear: 3, newCustomersCurrentMonth: 0,
      activeDebt: 1, uncollectibleOnly: 1, noCurrentDebt: 1, month1: 1, month2: 2,
    };
    const source = { query: jest.fn().mockResolvedValue([row]), transaction: jest.fn() };
    const result = await new CustomerStatisticsTypeOrmReader(source as never).read(2026, 10);
    expect(source.query).toHaveBeenCalledTimes(1);
    expect(source.query).toHaveBeenCalledWith(CUSTOMER_STATISTICS_SQL, [2026, 10]);
    expect(source.transaction).not.toHaveBeenCalled();
    expect(result.currentSituation).toEqual({ activeDebt: 1, uncollectibleOnly: 1, noCurrentDebt: 1 });
    expect(result.monthlyNewCustomers).toHaveLength(12);
    expect(result.monthlyNewCustomers.slice(0, 3)).toEqual([
      { month: 1, newCustomers: 1 }, { month: 2, newCustomers: 2 }, { month: 3, newCustomers: 0 },
    ]);
  });

  it('encodes uniqueness, ANNULLED exclusion, status priority and Costa Rica registration dates in SQL', () => {
    expect(CUSTOMER_STATISTICS_SQL).toContain('GROUP BY l.customer_id');
    expect(CUSTOMER_STATISTICS_SQL).toContain('SELECT DISTINCT origin.customer_id');
    expect(CUSTOMER_STATISTICS_SQL).toContain('FROM loan_refinancings refinancing');
    expect(CUSTOMER_STATISTICS_SQL).toContain(`l.status <> 'ANNULLED'`);
    expect(CUSTOMER_STATISTICS_SQL).toContain('NOT "hasActiveDebt" AND "hasUncollectibleDebt"');
    expect(CUSTOMER_STATISTICS_SQL).toContain(`AT TIME ZONE 'America/Costa_Rica'`);
    expect(CUSTOMER_STATISTICS_SQL).not.toContain('loan_status =');
  });
});
