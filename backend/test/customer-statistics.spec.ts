import { CustomerStatisticsUseCase, type CustomerStatisticsReader } from '../src/application/customer/customer-statistics.use-case';
import { calculateCustomerStatistics, CustomerStatisticsIntegrityError, type CustomerStatisticsFacts } from '../src/domain/customer/customer-statistics';
import { CustomerValidationError } from '../src/domain/customer/customer.errors';

const months = (values: Partial<Record<number, number>> = {}) => Array.from({ length: 12 }, (_, index) => ({
  month: index + 1, newCustomers: values[index + 1] ?? 0,
}));
const facts = (overrides: Partial<CustomerStatisticsFacts> = {}): CustomerStatisticsFacts => ({
  totalCustomers: 0,
  customersWithActiveDebt: 0,
  customersWithUncollectibleDebt: 0,
  customersWithRefinancingHistory: 0,
  customersWithCancelledLoans: 0,
  customersWithAnnulledLoans: 0,
  customersWithMultipleLoans: 0,
  validLoanCount: 0,
  newCustomersInYear: 0,
  newCustomersCurrentMonth: 0,
  currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 0 },
  monthlyNewCustomers: months(),
  topCustomers: { capitalDisbursed: [], loansPlaced: [], realizedGain: [], recoveredPrincipal: [], currentBalance: [] },
  ...overrides,
});
const calculate = (input: CustomerStatisticsFacts, year = 2026, currentYear = 2026) =>
  calculateCustomerStatistics(year, currentYear, 10, input);

describe('customer population statistics', () => {
  it('returns a stable zero snapshot with twelve empty months', () => {
    const result = calculate(facts());
    expect(result.summary).toEqual({
      totalCustomers: 0, customersWithActiveDebt: 0, customersWithoutCurrentDebt: 0,
      customersWithUncollectibleDebt: 0, customersWithRefinancingHistory: 0,
      customersWithCancelledLoans: 0, customersWithAnnulledLoans: 0,
      customersWithMultipleLoans: 0, averageLoansPerCustomer: 0,
      newCustomersInYear: 0, newCustomersCurrentMonth: 0,
    });
    expect(result.monthlyNewCustomers).toHaveLength(12);
    expect(result.monthlyNewCustomers.every((item) => item.newCustomers === 0)).toBe(true);
    expect(result.topCustomers).toEqual({ capitalDisbursed: [], loansPlaced: [], realizedGain: [], recoveredPrincipal: [], currentBalance: [] });
  });

  it.each([
    ['customer without loans', facts({ totalCustomers: 1,
      currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 1 } }),
      { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 1 }],
    ['one ACTIVE', facts({ totalCustomers: 1, customersWithActiveDebt: 1, validLoanCount: 1,
      currentSituation: { activeDebt: 1, uncollectibleOnly: 0, noCurrentDebt: 0 } }),
      { activeDebt: 1, uncollectibleOnly: 0, noCurrentDebt: 0 }],
    ['only CANCELLED', facts({ totalCustomers: 1, customersWithCancelledLoans: 1, validLoanCount: 1,
      currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 1 } }),
      { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 1 }],
    ['only UNCOLLECTIBLE', facts({ totalCustomers: 1, customersWithUncollectibleDebt: 1, validLoanCount: 1,
      currentSituation: { activeDebt: 0, uncollectibleOnly: 1, noCurrentDebt: 0 } }),
      { activeDebt: 0, uncollectibleOnly: 1, noCurrentDebt: 0 }],
    ['ACTIVE and UNCOLLECTIBLE prioritizes ACTIVE', facts({ totalCustomers: 1, customersWithActiveDebt: 1,
      customersWithUncollectibleDebt: 1, customersWithMultipleLoans: 1, validLoanCount: 2,
      currentSituation: { activeDebt: 1, uncollectibleOnly: 0, noCurrentDebt: 0 } }),
      { activeDebt: 1, uncollectibleOnly: 0, noCurrentDebt: 0 }],
  ] as const)('classifies %s as one mutually exclusive current situation', (_label, input, expected) => {
    const result = calculate(input);
    expect(result.currentSituation).toEqual(expected);
    expect(Object.values(result.currentSituation).reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(result.summary.customersWithoutCurrentDebt).toBe(expected.noCurrentDebt);
  });

  it('counts several ACTIVE loans once as a customer but includes both valid loans in the average', () => {
    const result = calculate(facts({ totalCustomers: 1, customersWithActiveDebt: 1,
      customersWithMultipleLoans: 1, validLoanCount: 2,
      currentSituation: { activeDebt: 1, uncollectibleOnly: 0, noCurrentDebt: 0 } }));
    expect(result.summary).toMatchObject({ customersWithActiveDebt: 1, customersWithMultipleLoans: 1,
      averageLoansPerCustomer: 2 });
  });

  it('allows overlapping CANCELLED and ACTIVE history without changing current ACTIVE classification', () => {
    const result = calculate(facts({ totalCustomers: 1, customersWithActiveDebt: 1,
      customersWithCancelledLoans: 1, customersWithMultipleLoans: 1, validLoanCount: 2,
      currentSituation: { activeDebt: 1, uncollectibleOnly: 0, noCurrentDebt: 0 } }));
    expect(result.summary).toMatchObject({ customersWithActiveDebt: 1, customersWithCancelledLoans: 1 });
  });

  it('counts formal refinancing once for a chain and treats its three non-annulled loans as multiple history', () => {
    const result = calculate(facts({ totalCustomers: 1, customersWithRefinancingHistory: 1,
      customersWithMultipleLoans: 1, validLoanCount: 3,
      currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 1 } }));
    expect(result.summary).toMatchObject({ customersWithRefinancingHistory: 1,
      customersWithMultipleLoans: 1, averageLoansPerCustomer: 3 });
  });

  it('reports ANNULLED as audit history but excludes it from valid loan count and average', () => {
    const result = calculate(facts({ totalCustomers: 1, customersWithAnnulledLoans: 1,
      currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 1 } }));
    expect(result.summary).toMatchObject({ customersWithAnnulledLoans: 1,
      customersWithMultipleLoans: 0, averageLoansPerCustomer: 0 });
  });

  it('divides valid loans by all customers and rounds the non-monetary average safely', () => {
    const result = calculate(facts({ totalCustomers: 3, validLoanCount: 4, customersWithMultipleLoans: 1,
      currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 3 } }));
    expect(result.summary.averageLoansPerCustomer).toBe(1.33);
    expect(Number.isFinite(result.summary.averageLoansPerCustomer)).toBe(true);
  });

  it('returns annual registrations, all months including zeroes, and an equal monthly sum', () => {
    const monthlyNewCustomers = months({ 1: 2, 3: 1, 12: 2 });
    const result = calculate(facts({ totalCustomers: 5, newCustomersInYear: 5, newCustomersCurrentMonth: 1,
      currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 5 }, monthlyNewCustomers }));
    expect(result.monthlyNewCustomers).toHaveLength(12);
    expect(result.monthlyNewCustomers[1]).toEqual({ month: 2, newCustomers: 0 });
    expect(result.monthlyNewCustomers.reduce((sum, item) => sum + item.newCustomers, 0)).toBe(result.summary.newCustomersInYear);
  });

  it('returns current-month registrations only for the current Costa Rica year', () => {
    const input = facts({ totalCustomers: 1, newCustomersInYear: 1, newCustomersCurrentMonth: 1,
      currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 1 }, monthlyNewCustomers: months({ 10: 1 }) });
    expect(calculate(input, 2026, 2026).summary.newCustomersCurrentMonth).toBe(1);
    expect(calculate(input, 2025, 2026).summary.newCustomersCurrentMonth).toBeNull();
  });

  it('rejects impossible monthly and current-situation identities instead of correcting them', () => {
    expect(() => calculate(facts({ totalCustomers: 1,
      currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 0 } })))
      .toThrow(CustomerStatisticsIntegrityError);
    expect(() => calculate(facts({ totalCustomers: 1, newCustomersInYear: 1,
      currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 1 } })))
      .toThrow(CustomerStatisticsIntegrityError);
  });

  it('returns validated descending rankings without recalculating their financial values', () => {
    const topCustomers = {
      capitalDisbursed: [{ customerId: 'c1', fullName: 'Ana', value: '1000.00' }, { customerId: 'c2', fullName: 'Bea', value: '500.00' }],
      loansPlaced: [{ customerId: 'c1', fullName: 'Ana', value: 4 }],
      realizedGain: [{ customerId: 'c2', fullName: 'Bea', value: '125.50' }],
      recoveredPrincipal: [{ customerId: 'c1', fullName: 'Ana', value: '600.00' }],
      currentBalance: [{ customerId: 'c2', fullName: 'Bea', value: '300.00' }],
    };
    expect(calculate(facts({ topCustomers })).topCustomers).toEqual(topCustomers);
  });

  it('rejects malformed, duplicate, unsorted or oversized rankings', () => {
    expect(() => calculate(facts({ topCustomers: { ...facts().topCustomers, capitalDisbursed: [
      { customerId: 'c1', fullName: 'Ana', value: '10.00' }, { customerId: 'c2', fullName: 'Bea', value: '20.00' },
    ] } }))).toThrow(CustomerStatisticsIntegrityError);
    expect(() => calculateCustomerStatistics(2026, 2026, 5, facts({ topCustomers: { ...facts().topCustomers, loansPlaced: Array.from({ length: 6 }, (_, index) => ({ customerId: `c${index}`, fullName: 'Cliente', value: 6 - index })) } }))).toThrow(CustomerStatisticsIntegrityError);
  });
});

describe('CustomerStatisticsUseCase', () => {
  it('uses the current Costa Rica period by default and forwards the current month', async () => {
    const reader: CustomerStatisticsReader = { read: jest.fn(async () => facts()) };
    const useCase = new CustomerStatisticsUseCase(reader, () => ({ year: 2026, month: 10 }));
    await expect(useCase.execute()).resolves.toMatchObject({ year: 2026 });
    expect(reader.read).toHaveBeenCalledWith(2026, 10, 10);
  });

  it('accepts a strict historical year and rejects malformed years', async () => {
    const reader: CustomerStatisticsReader = { read: jest.fn(async () => facts()) };
    const useCase = new CustomerStatisticsUseCase(reader, () => ({ year: 2026, month: 10 }));
    await expect(useCase.execute('2025')).resolves.toMatchObject({ year: 2025,
      summary: { newCustomersCurrentMonth: null } });
    for (const year of ['26', '02026', '2026.0', 'abcd', '0000'])
      await expect(useCase.execute(year)).rejects.toBeInstanceOf(CustomerValidationError);
    expect(reader.read).toHaveBeenCalledTimes(1);
  });

  it('forwards a positive ranking limit and rejects invalid values', async () => {
    const reader: CustomerStatisticsReader = { read: jest.fn(async () => facts()) };
    const useCase = new CustomerStatisticsUseCase(reader, () => ({ year: 2026, month: 10 }));
    await useCase.execute('2026', 25);
    expect(reader.read).toHaveBeenCalledWith(2026, 10, 25);
    for (const limit of [0, -1, 1.5, Number.NaN])
      await expect(useCase.execute('2026', limit)).rejects.toBeInstanceOf(CustomerValidationError);
    expect(reader.read).toHaveBeenCalledTimes(1);
  });
});
