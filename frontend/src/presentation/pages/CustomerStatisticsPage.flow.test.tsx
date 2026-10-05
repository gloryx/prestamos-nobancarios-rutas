import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerStatisticsController, type CustomerStatisticsPort } from '../../application/use-cases/customer-statistics-controller';
import { CustomerStatisticsPage, CustomerStatisticsView } from './CustomerStatisticsPage';

const hooks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, vi.fn()],
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));

const statistics = {
  year: 2026,
  summary: { totalCustomers: 0, customersWithActiveDebt: 0, customersWithoutCurrentDebt: 0,
    customersWithUncollectibleDebt: 0, customersWithRefinancingHistory: 0,
    customersWithCancelledLoans: 0, customersWithAnnulledLoans: 0,
    customersWithMultipleLoans: 0, averageLoansPerCustomer: 0,
    newCustomersInYear: 0, newCustomersCurrentMonth: 0 },
  currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 0 },
  monthlyNewCustomers: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, newCustomers: 0 })),
  topCustomers: { capitalDisbursed: [], loansPlaced: [], realizedGain: [], recoveredPrincipal: [], currentBalance: [] },
};

const findById = (node: unknown, id: string): { props: Record<string, unknown> } | undefined => {
  if (!node || typeof node !== 'object' || !('props' in node)) return undefined;
  const element = node as { props: Record<string, unknown> };
  if (element.props.id === id) return element;
  const children = Array.isArray(element.props.children) ? element.props.children : [element.props.children];
  for (const child of children) {
    const match = findById(child, id);
    if (match) return match;
  }
  return undefined;
};

describe('CustomerStatisticsPage request flow', () => {
  beforeEach(() => { hooks.effects = []; });

  it('loads the current year on entry and offers no future years', async () => {
    const api: CustomerStatisticsPort = { load: vi.fn(async () => statistics) };
    const controller = new CustomerStatisticsController(api, 2026, 2026);
    const page = CustomerStatisticsPage({ controller, currentYear: 2026 });
    expect(page.type).toBe(CustomerStatisticsView);
    expect((page.props as { years: number[] }).years).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017]);
    await hooks.effects[0]();
    expect(api.load).toHaveBeenCalledExactlyOnceWith(2026, 10);
  });

  it('keeps limit typing local and requests the confirmed value on blur', async () => {
    const api: CustomerStatisticsPort = { load: vi.fn(async () => statistics) };
    const controller = new CustomerStatisticsController(api, 2026, 2026);
    const view = CustomerStatisticsView({ state: { year: 2026, limit: 10, statistics, loading: false, error: '' },
      controller, years: [2026] });
    const input = findById(view, 'customer-statistics-top-limit');
    expect(input).toBeDefined();
    (input!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '25' } });
    expect(api.load).not.toHaveBeenCalled();
    (input!.props.onBlur as (event: { target: { value: string } }) => void)({ target: { value: '25' } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(api.load).toHaveBeenCalledExactlyOnceWith(2026, 25);
  });
});
