import { describe, expect, it, vi } from 'vitest';
import type { CustomerAgendaResult } from '../../domain/entities/customer-agenda';
import { CustomerAgendaController, type CustomerAgendaPort } from './customer-agenda-controller';

const result = (patch: Partial<CustomerAgendaResult> = {}): CustomerAgendaResult => ({
  summary: { total: 12, assigned: 8, unassigned: 4, withoutRoute: 2, routeWithoutCollector: 1, invalidRoute: 1, invalidCollector: 0 },
  pagination: { page: 1, pageSize: 20, total: 12, totalPages: 1 },
  options: { collectors: [{ id: 'collector-1', name: 'Ana' }], routes: [{ id: 'route-1', name: 'Centro', collectorId: 'collector-1' }], provinces: [], cantons: [], districts: [] },
  items: [], ...patch,
});
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('CustomerAgendaController', () => {
  it('loads default server pagination and authoritative data', async () => {
    const port: CustomerAgendaPort = { load: vi.fn(async () => result()) };
    const controller = new CustomerAgendaController(port);
    await controller.load();
    expect(port.load).toHaveBeenCalledWith(expect.objectContaining({ assignmentStatus: 'ALL', page: 1, pageSize: 20 }), expect.any(AbortSignal));
    expect(controller.getSnapshot().data?.summary).toEqual(result().summary);
  });

  it('adopts the authoritative page when the requested page is no longer available', async () => {
    const port: CustomerAgendaPort = { load: vi.fn(async () => result({ pagination: { page: 2, pageSize: 20, total: 40, totalPages: 2 } })) };
    const controller = new CustomerAgendaController(port);
    controller.setPage(3);
    await tick();
    expect(controller.getSnapshot().filters.page).toBe(2);
    expect(controller.getSnapshot().data?.pagination.page).toBe(2);
  });

  it('submits search, resets filters and maps Sin cobrador to UNASSIGNED', async () => {
    const port: CustomerAgendaPort = { load: vi.fn(async () => result()) };
    const controller = new CustomerAgendaController(port);
    controller.setPage(3); await tick();
    controller.setFilter('routeId', 'route-1'); await tick();
    controller.setCollector('UNASSIGNED'); await tick();
    controller.setFilter('provinceCode', '5'); await tick();
    controller.setFilter('cantonCode', '503'); await tick();
    controller.setFilter('districtCode', '50301'); await tick();
    controller.submitSearch(' Ana '); await tick();
    controller.setPageSize(50); await tick();
    expect(vi.mocked(port.load).mock.calls.at(-1)?.[0]).toMatchObject({ search: ' Ana ', collectorId: '', routeId: '', provinceCode: '5', cantonCode: '503', districtCode: '50301', assignmentStatus: 'UNASSIGNED', page: 1, pageSize: 50 });
    controller.setFilter('provinceCode', '1'); await tick();
    expect(vi.mocked(port.load).mock.calls.at(-1)?.[0]).toMatchObject({ provinceCode: '1', cantonCode: '', districtCode: '', page: 1 });
  });

  it('aborts stale work, retries after safe errors and disposes the active request', async () => {
    let firstSignal: AbortSignal | undefined;
    const port: CustomerAgendaPort = { load: vi.fn((_filters, signal) => {
      if (!firstSignal) { firstSignal = signal; return new Promise<CustomerAgendaResult>(() => {}); }
      return Promise.resolve(result());
    }) };
    const controller = new CustomerAgendaController(port);
    void controller.load();
    await controller.load();
    expect(firstSignal?.aborted).toBe(true);
    expect(controller.getSnapshot().data).toEqual(result());

    vi.mocked(port.load).mockRejectedValueOnce(Object.assign(new Error('private detail'), { status: 500 }));
    await controller.load();
    expect(controller.getSnapshot().error).toBe('No se pudo cargar la agenda de clientes.');
    expect(controller.getSnapshot().error).not.toContain('private detail');
    await controller.load();
    const active = vi.mocked(port.load).mock.calls.at(-1)?.[1];
    controller.dispose();
    expect(active?.aborted).toBe(false);
  });
});
