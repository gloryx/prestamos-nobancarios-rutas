import { CollectorStatisticsUseCase, type CollectorStatisticsReader } from '../src/application/collector/collector-statistics.use-case';
import {
  buildCollectorStatistics,
  CollectorStatisticsIntegrityError,
  type CollectorStatisticsFacts,
  type CollectorStatisticsPeriod,
} from '../src/domain/collector/collector-statistics';
import { CollectorValidationError } from '../src/domain/collector/collector.errors';

const evolution = (year: number, month: number | null) => {
  const length = month === null ? 12 : new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length }, (_, index) => ({
    period: month === null ? `${year}-${String(index + 1).padStart(2, '0')}` :
      `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
    validPaymentsCount: 0, uniqueCustomersServed: 0, totalCollectedAmount: '0.00',
    annulledPaymentsCount: 0, annulledAmount: '0.00',
  }));
};
const facts = (year = 2026, month: number | null = null): CollectorStatisticsFacts => ({
  summary: {
    totalCollectors: 0, activeCollectors: 0, inactiveCollectors: 0,
    collectorsWithValidPayments: 0, collectorsWithoutValidPayments: 0,
    activeCollectorsWithoutValidPayments: 0, linkedCollectors: 0, unlinkedCollectors: 0,
    validPaymentsCount: 0, uniqueCustomersServed: 0, totalCollectedAmount: '0.00', principalAppliedAmount: '0.00',
    interestAppliedAmount: '0.00', averageValidPaymentAmount: '0.00',
    annulledPaymentsCount: 0, annulledAmount: '0.00',
  },
  byCollector: [], paymentMethods: [], evolution: evolution(year, month),
  unattributedPayments: {
    validPaymentsCount: 0, totalCollectedAmount: '0.00', annulledPaymentsCount: 0, annulledAmount: '0.00',
  },
});
const period = (month: number | null = null): CollectorStatisticsPeriod => ({
  year: 2026, month, startDate: month === null ? '2026-01-01' : '2026-02-01',
  endDate: month === null ? '2026-12-31' : '2026-02-28', granularity: month === null ? 'MONTH' : 'DAY',
});

describe('collector statistics', () => {
  it('returns an exact zero annual snapshot with explicit semantics and twelve buckets', () => {
    const result = buildCollectorStatistics(period(), facts());
    expect(result.period).toEqual({ year: 2026, month: null, startDate: '2026-01-01',
      endDate: '2026-12-31', timeZone: 'America/Costa_Rica' });
    expect(result.semantics).toEqual({ paymentDateBasis: 'PAYMENT_DATE',
      paymentValidityBasis: 'CURRENT_STATUS', assignmentSnapshot: 'CURRENT' });
    expect(result.summary.averageAssignedCustomersPerActiveCollector).toBe(0);
    expect(result.evolution).toHaveLength(12);
  });

  it('keeps valid, annulled and unattributed amounts separate and averages current assignments', () => {
    const input = facts();
    input.summary = { ...input.summary, totalCollectors: 2, activeCollectors: 1, inactiveCollectors: 1,
      collectorsWithValidPayments: 1, collectorsWithoutValidPayments: 1, activeCollectorsWithoutValidPayments: 0,
      linkedCollectors: 1, unlinkedCollectors: 1, validPaymentsCount: 2, uniqueCustomersServed: 1,
      totalCollectedAmount: '150.00',
      principalAppliedAmount: '100.00', interestAppliedAmount: '50.00', averageValidPaymentAmount: '75.00',
      annulledPaymentsCount: 1, annulledAmount: '40.00' };
    input.byCollector = [
      { collectorId: 'c1', identification: '1', fullName: 'ANA PEREZ', isActive: true, userLinked: true,
        validPaymentsCount: 2, uniqueCustomersServed: 1, totalCollectedAmount: '150.00', principalAppliedAmount: '100.00',
        interestAppliedAmount: '50.00', averageValidPaymentAmount: '75.00', annulledPaymentsCount: 1,
        annulledAmount: '40.00', currentActiveRoutes: 2, currentAssignedActiveCustomers: 3 },
      { collectorId: 'c2', identification: '2', fullName: 'LUIS ROJAS', isActive: false, userLinked: false,
        validPaymentsCount: 0, uniqueCustomersServed: 0, totalCollectedAmount: '0.00', principalAppliedAmount: '0.00',
        interestAppliedAmount: '0.00', averageValidPaymentAmount: '0.00', annulledPaymentsCount: 0,
        annulledAmount: '0.00', currentActiveRoutes: 0, currentAssignedActiveCustomers: 0 },
    ];
    input.paymentMethods = [{ paymentMethodId: 'm1', name: 'Efectivo', currentlyActive: true,
      validPaymentsCount: 2, totalCollectedAmount: '150.00' }];
    input.evolution[0] = { ...input.evolution[0], validPaymentsCount: 2, uniqueCustomersServed: 1,
      totalCollectedAmount: '150.00', annulledPaymentsCount: 1, annulledAmount: '40.00' };
    input.unattributedPayments = { validPaymentsCount: 1, totalCollectedAmount: '20.00',
      annulledPaymentsCount: 1, annulledAmount: '10.00' };
    const result = buildCollectorStatistics(period(), input);
    expect(result.summary.averageAssignedCustomersPerActiveCollector).toBe(3);
    expect(result.summary.uniqueCustomersServed).toBe(1);
    expect(result.byCollector[0].uniqueCustomersServed).toBe(1);
    expect(result.evolution[0].uniqueCustomersServed).toBe(1);
    expect(result.summary.totalCollectedAmount).toBe('150.00');
    expect(result.unattributedPayments.totalCollectedAmount).toBe('20.00');
  });

  it('rejects incomplete timelines and allocation or aggregate mismatches', () => {
    const incomplete = facts();
    incomplete.evolution.pop();
    expect(() => buildCollectorStatistics(period(), incomplete)).toThrow(CollectorStatisticsIntegrityError);
    const mismatch = facts();
    mismatch.summary.totalCollectedAmount = '1.00';
    expect(() => buildCollectorStatistics(period(), mismatch)).toThrow('Capital e interés');
    const impossibleCustomers = facts();
    impossibleCustomers.summary.uniqueCustomersServed = 1;
    expect(() => buildCollectorStatistics(period(), impossibleCustomers)).toThrow('clientes atendidos');
  });
});

describe('CollectorStatisticsUseCase', () => {
  it('uses the current Costa Rica year by default and supports a complete leap-month period', async () => {
    const reader: CollectorStatisticsReader = { read: jest.fn(async (value) => facts(value.year, value.month)) };
    const useCase = new CollectorStatisticsUseCase(reader, () => ({ year: 2024, month: 10 }));
    await useCase.execute(undefined, '2');
    expect(reader.read).toHaveBeenCalledWith({ year: 2024, month: 2, startDate: '2024-02-01',
      endDate: '2024-02-29', granularity: 'DAY' });
  });

  it('accepts an annual year and rejects malformed years and months before reading', async () => {
    const reader: CollectorStatisticsReader = { read: jest.fn(async (value) => facts(value.year, value.month)) };
    const useCase = new CollectorStatisticsUseCase(reader, () => ({ year: 2026, month: 10 }));
    await expect(useCase.execute('2025')).resolves.toMatchObject({ period: { year: 2025, month: null } });
    for (const [year, month] of [['26', undefined], ['02026', undefined], ['2026.0', undefined],
      ['2026', '0'], ['2026', '01'], ['2026', '13'], ['2026', 'x']] as const)
      await expect(useCase.execute(year, month)).rejects.toBeInstanceOf(CollectorValidationError);
    expect(reader.read).toHaveBeenCalledTimes(1);
  });
});
