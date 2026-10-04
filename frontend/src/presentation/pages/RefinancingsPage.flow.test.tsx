import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoanRefinancingList, RefinancingCustomerLookup } from '../../application/ports/loan-refinancing.repository';
import { RefinancingListController } from '../../application/use-cases/refinancing-list-controller';
import { RefinancingsPage } from './RefinancingsPage';

type EffectSlot = { deps?: unknown[]; pending?: () => void | (() => void); cleanup?: () => void };
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as Array<{ current: unknown }>,
  effects: [] as EffectSlot[], stateIndex: 0, refIndex: 0, effectIndex: 0, allowCustomers: true }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === 'function' ?
      (value as (previous: unknown) => unknown)(hooks.states[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.refIndex++;
    return hooks.refs[index] ?? (hooks.refs[index] = { current: initial }); },
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = hooks.effectIndex++;
    const previous = hooks.effects[index];
    if (previous && deps && previous.deps?.length === deps.length &&
      deps.every((value, position) => Object.is(value, previous.deps?.[position]))) return;
    previous?.cleanup?.();
    hooks.effects[index] = { deps, pending: effect };
  },
}));
vi.mock('../hooks/auth-context', () => ({ useAuth: () => ({
  can: (permission: string) => permission !== 'customers.view' || hooks.allowCustomers,
}) }));

function setup() {
  const repository: LoanRefinancingList = { list: vi.fn(async (query) => ({ items: [], total: 0,
    page: query.page, pageSize: query.pageSize, totalPages: 0 })) };
  const customers: RefinancingCustomerLookup = { search: vi.fn(async () => ({ items: [], total: 0 })) };
  const controller = new RefinancingListController(repository, customers);
  const render = () => { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effectIndex = 0;
    return RefinancingsPage({ controller }); };
  const runEffect = (index: number) => { const slot = hooks.effects[index];
    if (slot.pending) { const cleanup = slot.pending(); slot.pending = undefined; slot.cleanup = cleanup || undefined; } };
  return { repository, customers, controller, render, runEffect };
}

describe('refinancing list request scheduling', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', { setTimeout, clearTimeout });
    hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.allowCustomers = true; });
  afterEach(() => { hooks.effects.forEach((effect) => effect.cleanup?.()); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('loads on entry, debounces only search, and does not refetch on an unrelated render', async () => {
    const { repository, controller, render, runEffect } = setup();
    render(); runEffect(0); await vi.advanceTimersByTimeAsync(0);
    expect(repository.list).toHaveBeenCalledTimes(1);
    controller.setFilter('search', 'Ana');
    render(); runEffect(0);
    await vi.advanceTimersByTimeAsync(249);
    expect(repository.list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(repository.list).toHaveBeenCalledTimes(2);
    expect(repository.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, search: 'Ana' });
    render(); runEffect(0); await vi.advanceTimersByTimeAsync(500);
    expect(repository.list).toHaveBeenCalledTimes(2);
    controller.setPage(2);
    render(); runEffect(0); await vi.advanceTimersByTimeAsync(0);
    expect(repository.list).toHaveBeenCalledTimes(3);
    expect(repository.list).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, search: 'Ana' });
  });

  it('cancels an obsolete search timer and requests only the final query', async () => {
    const { repository, controller, render, runEffect } = setup();
    render(); runEffect(0); await vi.advanceTimersByTimeAsync(0);
    controller.setFilter('search', 'An');
    render(); runEffect(0); await vi.advanceTimersByTimeAsync(100);
    controller.setFilter('search', 'Ana');
    render(); runEffect(0); await vi.advanceTimersByTimeAsync(249);
    expect(repository.list).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(repository.list).toHaveBeenCalledTimes(2);
    expect(repository.list).toHaveBeenLastCalledWith({ search: 'Ana', page: 1, pageSize: 20 });
  });

  it('debounces the existing paged customer lookup only while open and with customers.view', async () => {
    const { customers, controller, render, runEffect } = setup();
    let page = render();
    (page.props as { onOpenCustomer: () => void }).onOpenCustomer();
    page = render(); runEffect(1); await vi.advanceTimersByTimeAsync(0);
    expect(customers.search).toHaveBeenCalledOnce();
    controller.setCustomerSearch('Ana');
    render(); runEffect(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(customers.search).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(customers.search).toHaveBeenLastCalledWith({ search: 'Ana', page: 1 });
    (page.props as { onCloseCustomer: () => void }).onCloseCustomer();
    hooks.allowCustomers = false;
    render(); runEffect(1); await vi.advanceTimersByTimeAsync(500);
    expect(customers.search).toHaveBeenCalledTimes(2);
  });
});
