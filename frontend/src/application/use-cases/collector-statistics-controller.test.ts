import { describe, expect, it, vi } from 'vitest';
import type { CollectorStatistics } from '../../domain/entities/collector-statistics';
import { CollectorStatisticsController, type CollectorStatisticsPort } from './collector-statistics-controller';

const statistics = (year = 2026, month: number | null = null): CollectorStatistics => ({
  period: { year, month, startDate: month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`,
    endDate: month ? `${year}-${String(month).padStart(2, '0')}-28` : `${year}-12-31`, timeZone: 'America/Costa_Rica' },
  semantics: { paymentDateBasis: 'PAYMENT_DATE', paymentValidityBasis: 'CURRENT_STATUS', assignmentSnapshot: 'CURRENT' },
  summary: { totalCollectors: 1, activeCollectors: 1, inactiveCollectors: 0, collectorsWithValidPayments: 0,
    collectorsWithoutValidPayments: 1, activeCollectorsWithoutValidPayments: 1, linkedCollectors: 1,
    unlinkedCollectors: 0, validPaymentsCount: 0, uniqueCustomersServed: 0, totalCollectedAmount: '0.00',
    principalAppliedAmount: '0.00', interestAppliedAmount: '0.00', averageValidPaymentAmount: '0.00',
    annulledPaymentsCount: 0, annulledAmount: '0.00', averageAssignedCustomersPerActiveCollector: 2 },
  byCollector: [], paymentMethods: [], evolution: [],
  unattributedPayments: { validPaymentsCount: 0, totalCollectedAmount: '0.00', annulledPaymentsCount: 0, annulledAmount: '0.00' },
});
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const api: CollectorStatisticsPort = { load: vi.fn(async (year, month) => statistics(year, month)) };
  return { api, controller: new CollectorStatisticsController(api, 2026, 2026) };
}

describe('CollectorStatisticsController', () => {
  it('loads the annual period once and deduplicates the same in-flight request', async () => {
    const { api, controller } = setup();
    let resolve!: (value: CollectorStatistics) => void;
    vi.mocked(api.load).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const first = controller.load();
    const duplicate = controller.load();
    expect(first).toBe(duplicate);
    expect(api.load).toHaveBeenCalledTimes(1);
    expect(api.load).toHaveBeenCalledWith(2026, null, expect.any(AbortSignal));
    resolve(statistics());
    await first;
    expect(controller.getSnapshot()).toMatchObject({ statistics: statistics(), loading: false, error: '' });
  });

  it('clears old figures and requests an unpadded selected month', async () => {
    const { api, controller } = setup();
    await controller.load();
    controller.setMonth(10);
    expect(controller.getSnapshot()).toMatchObject({ month: 10, statistics: null, loading: true });
    await tick();
    expect(api.load).toHaveBeenLastCalledWith(2026, 10, expect.any(AbortSignal));
    expect(controller.getSnapshot().statistics).toEqual(statistics(2026, 10));
  });

  it('preserves the selected month on year change and ignores the aborted response', async () => {
    const { api, controller } = setup();
    let resolveOld!: (value: CollectorStatistics) => void;
    vi.mocked(api.load).mockImplementationOnce((_year, _month, signal) => new Promise((done) => {
      resolveOld = done;
      expect(signal?.aborted).toBe(false);
    }));
    const oldRequest = controller.load();
    controller.setMonth(2);
    controller.setYear(2025);
    await tick();
    resolveOld(statistics(2026));
    await oldRequest;
    expect(controller.getSnapshot()).toMatchObject({ year: 2025, month: 2, statistics: statistics(2025, 2) });
  });

  it('rejects future years and invalid months without requests', () => {
    const { api, controller } = setup();
    for (const year of [2027, 999, 2025.5, Number.NaN]) controller.setYear(year);
    for (const month of [0, 13, 1.5, Number.NaN]) controller.setMonth(month);
    expect(api.load).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ year: 2026, month: null });
  });

  it('maps permission and network errors and retries without stale values', async () => {
    const { api, controller } = setup();
    vi.mocked(api.load).mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ statistics: null,
      error: 'No tienes permiso para consultar estadísticas de cobradores.' });
    vi.mocked(api.load).mockRejectedValueOnce(new TypeError('network'));
    await controller.load();
    expect(controller.getSnapshot().error).toContain('No se pudo conectar');
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ statistics: statistics(), error: '' });
  });

  it('aborts an active request when disposed', () => {
    const { api, controller } = setup();
    void controller.load();
    const signal = vi.mocked(api.load).mock.calls[0][2];
    controller.dispose();
    expect(signal?.aborted).toBe(true);
  });
});
