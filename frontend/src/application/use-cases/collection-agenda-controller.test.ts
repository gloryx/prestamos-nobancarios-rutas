import { describe, expect, it, vi } from 'vitest';
import type { CollectionAgendaResult } from '../../domain/entities/collection-agenda';
import { CollectionAgendaController, type CollectionAgendaPort } from './collection-agenda-controller';

const result = (patch: Partial<CollectionAgendaResult> = {}): CollectionAgendaResult => ({
  referenceDate: '2026-10-05', period: { fromDate: null, toDate: '2026-10-05' },
  summary: { overdue: { obligations: 12, customers: 10, amount: '120000.00' }, dueToday: { obligations: 8, customers: 7, amount: '85000.00' }, upcoming: { obligations: 21, customers: 18, amount: '240000.00' } },
  pagination: { page: 1, pageSize: 20, totalObligations: 41, totalPages: 3 },
  collectors: [{ collectorId: 'collector-1', collectorUserId: 'user-1', collectorName: 'Gloriana Peña', routes: [{ routeId: 'route-1', routeName: 'Santa-Cruz 01', customers: [] }] }],
  unassigned: { withoutRoute: [], withoutCollector: [{ routeId: 'route-2', routeName: 'Sin cobrador', customers: [] }], invalidCollector: [], invalidRoute: [] }, warnings: [], ...patch,
});
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const setup = () => {
  const port: CollectionAgendaPort = { load: vi.fn(async () => result()) };
  return { port, controller: new CollectionAgendaController(port, () => '2026-10-05') };
};

describe('CollectionAgendaController', () => {
  it('loads today with overdue obligations included and preserves authoritative summaries', async () => {
    const { port, controller } = setup();
    await controller.load();
    expect(port.load).toHaveBeenCalledWith(expect.objectContaining({ period: 'TODAY', referenceDate: '2026-10-05', fromDate: '', toDate: '2026-10-05', page: 1, pageSize: 20 }), expect.any(AbortSignal));
    expect(controller.getSnapshot().data?.summary.overdue.obligations).toBe(12);
    expect(controller.getSnapshot().data?.pagination.totalObligations).toBe(41);
  });

  it('builds tomorrow, current-week and custom ranges without UTC conversion', async () => {
    const { port, controller } = setup();
    controller.setPeriod('TOMORROW'); await tick();
    expect(vi.mocked(port.load).mock.calls.at(-1)?.[0]).toMatchObject({ referenceDate: '2026-10-05', fromDate: '2026-10-06', toDate: '2026-10-06', page: 1 });
    controller.setPeriod('WEEK'); await tick();
    expect(vi.mocked(port.load).mock.calls.at(-1)?.[0]).toMatchObject({ fromDate: '', toDate: '2026-10-11' });
    controller.setPeriod('CUSTOM'); await tick(); controller.setCustomDate('fromDate', '2026-10-02'); await tick();
    expect(vi.mocked(port.load).mock.calls.at(-1)?.[0]).toMatchObject({ period: 'CUSTOM', fromDate: '2026-10-02', toDate: '2026-10-11' });
  });

  it('sends search and filters server-side, resets page and clears route when collector changes', async () => {
    const { port, controller } = setup();
    controller.setPage(3); await tick();
    controller.setFilter('routeId', 'route-1'); await tick();
    controller.setFilter('collectorId', 'collector-1'); await tick();
    controller.setFilter('collectionStatus', 'OVERDUE'); await tick();
    controller.setFilter('search', '  Ana  '); await tick();
    expect(vi.mocked(port.load).mock.calls.at(-1)?.[0]).toMatchObject({ collectorId: 'collector-1', routeId: '', collectionStatus: 'OVERDUE', search: '  Ana  ', page: 1 });
  });

  it('retains discovered collector and route options across server pages', async () => {
    const { port, controller } = setup();
    await controller.load();
    vi.mocked(port.load).mockResolvedValueOnce(result({ collectors: [{ collectorId: 'collector-2', collectorUserId: 'user-2', collectorName: 'María Soto', routes: [{ routeId: 'route-3', routeName: 'Santa-Cruz 02', customers: [] }] }], unassigned: { withoutRoute: [], withoutCollector: [], invalidCollector: [], invalidRoute: [] } }));
    controller.setPage(2); await tick();
    expect(controller.getSnapshot().collectors.map((option) => option.id)).toEqual(['collector-1', 'collector-2']);
    expect(controller.getSnapshot().routes.map((option) => option.id)).toEqual(['route-1', 'route-3', 'route-2']);
  });

  it('maps forbidden and network failures, supports retry and aborts stale work', async () => {
    const { port, controller } = setup();
    vi.mocked(port.load).mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await controller.load();
    expect(controller.getSnapshot().error).toContain('No tienes permiso');
    vi.mocked(port.load).mockRejectedValueOnce(new TypeError('network'));
    await controller.load();
    expect(controller.getSnapshot().error).toContain('conectar');
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ data: result(), error: '' });
    void controller.load();
    const signal = vi.mocked(port.load).mock.calls.at(-1)?.[1];
    controller.dispose();
    expect(signal?.aborted).toBe(true);
  });
});
