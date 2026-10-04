import { describe, expect, it, vi } from 'vitest';
import type { CustomerStatistics } from '../../domain/entities/customer-statistics';
import { CustomerStatisticsController, type CustomerStatisticsPort } from './customer-statistics-controller';

const statistics = (year = 2026): CustomerStatistics => ({
  year,
  summary: { totalCustomers: 10, customersWithActiveDebt: 3, customersWithoutCurrentDebt: 6,
    customersWithUncollectibleDebt: 2, customersWithRefinancingHistory: 2,
    customersWithCancelledLoans: 4, customersWithAnnulledLoans: 1,
    customersWithMultipleLoans: 3, averageLoansPerCustomer: 1.7,
    newCustomersInYear: 3, newCustomersCurrentMonth: year === 2026 ? 1 : null },
  currentSituation: { activeDebt: 3, uncollectibleOnly: 1, noCurrentDebt: 6 },
  monthlyNewCustomers: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, newCustomers: index < 3 ? 1 : 0 })),
});
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const api: CustomerStatisticsPort = { load: vi.fn(async (year) => statistics(year)) };
  return { api, controller: new CustomerStatisticsController(api, 2026, 2026) };
}

describe('CustomerStatisticsController', () => {
  it('loads the current year from the aggregate statistics endpoint', async () => {
    const { api, controller } = setup();
    expect(controller.getSnapshot()).toMatchObject({ year: 2026, statistics: null, loading: true });
    await controller.load();
    expect(api.load).toHaveBeenCalledExactlyOnceWith(2026);
    expect(controller.getSnapshot()).toMatchObject({ statistics: statistics(), loading: false, error: '' });
  });

  it('clears old figures immediately and requests the selected historical year', async () => {
    const { api, controller } = setup();
    await controller.load();
    controller.setYear(2025);
    expect(controller.getSnapshot()).toMatchObject({ year: 2025, statistics: null, loading: true, error: '' });
    await tick();
    expect(api.load).toHaveBeenLastCalledWith(2025);
    expect(controller.getSnapshot().statistics).toEqual(statistics(2025));
  });

  it('ignores stale responses from the previous year', async () => {
    const { api, controller } = setup();
    let resolve!: (value: CustomerStatistics) => void;
    vi.mocked(api.load).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const oldRequest = controller.load();
    controller.setYear(2025);
    await tick();
    resolve(statistics(2026));
    await oldRequest;
    expect(controller.getSnapshot()).toMatchObject({ year: 2025, statistics: statistics(2025), loading: false });
  });

  it('rejects future/invalid selectors without a request', () => {
    const { api, controller } = setup();
    for (const year of [2027, 999, 2025.5, Number.NaN]) controller.setYear(year);
    expect(api.load).not.toHaveBeenCalled();
    expect(controller.getSnapshot().year).toBe(2026);
  });

  it('maps permission and network errors and retries without stale values', async () => {
    const { api, controller } = setup();
    vi.mocked(api.load).mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ statistics: null,
      error: 'No tienes permiso para consultar estadísticas de clientes.' });
    vi.mocked(api.load).mockRejectedValueOnce(new TypeError('network'));
    await controller.load();
    expect(controller.getSnapshot().error).toContain('No se pudo conectar');
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ statistics: statistics(), error: '' });
  });
});
