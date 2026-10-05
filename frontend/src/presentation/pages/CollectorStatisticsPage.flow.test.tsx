import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectorStatisticsController, type CollectorStatisticsPort } from '../../application/use-cases/collector-statistics-controller';
import { CollectorStatisticsPage, CollectorStatisticsView } from './CollectorStatisticsPage';

const hooks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, vi.fn()],
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));

describe('CollectorStatisticsPage request flow', () => {
  beforeEach(() => { hooks.effects = []; });

  it('loads the annual current period on entry and offers no future years', async () => {
    const api: CollectorStatisticsPort = { load: vi.fn(async () => { throw new Error('fixture not needed'); }) };
    const controller = new CollectorStatisticsController(api, 2026, 2026);
    const page = CollectorStatisticsPage({ controller, currentYear: 2026 });
    expect(page.type).toBe(CollectorStatisticsView);
    expect((page.props as { years: number[] }).years).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017]);
    await hooks.effects[0]();
    expect(api.load).toHaveBeenCalledExactlyOnceWith(2026, null, expect.any(AbortSignal));
  });
});
