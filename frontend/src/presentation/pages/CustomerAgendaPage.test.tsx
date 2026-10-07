import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CustomerAgendaController, type CustomerAgendaState } from '../../application/use-cases/customer-agenda-controller';
import type { CustomerAgendaResult } from '../../domain/entities/customer-agenda';
import { CustomerAgendaView } from './CustomerAgendaPage';

const data: CustomerAgendaResult = {
  summary: { total: 16, assigned: 11, unassigned: 5, withoutRoute: 2, routeWithoutCollector: 1, invalidRoute: 1, invalidCollector: 1 },
  pagination: { page: 1, pageSize: 20, total: 4, totalPages: 1 },
  options: { collectors: [{ id: 'collector-1', name: 'Gloriana Peña' }], routes: [{ id: 'route-1', name: 'Santa Cruz 01', collectorId: 'collector-1' }, { id: 'route-2', name: 'Libre', collectorId: null }],
    provinces: [{ code: 5, name: 'Guanacaste' }], cantons: [{ code: 503, name: 'Santa Cruz', provinceCode: 5 }],
    districts: [{ code: 50301, name: 'Santa Cruz', cantonCode: 503 }] },
  items: [
    { customerId: 'customer-1', customerName: 'Ana Mora', identification: '1-1111-1111', primaryPhone: '8888-0000', activeLoanCount: 2, assignmentStatus: 'INVALID_ROUTE', route: { id: 'route-3', name: 'Ruta inactiva' }, collector: null, territory: null },
    { customerId: 'customer-2', customerName: 'Luis Solís', identification: '2-2222-2222', primaryPhone: null, activeLoanCount: 1, assignmentStatus: 'INVALID_COLLECTOR', route: { id: 'route-2', name: 'Libre' }, collector: null, territory: null },
    { customerId: 'customer-3', customerName: 'María Rojas', identification: '3-3333-3333', primaryPhone: null, activeLoanCount: 1, assignmentStatus: 'WITHOUT_ROUTE', route: null, collector: null, territory: null },
    { customerId: 'customer-4', customerName: 'José Vega', identification: '4-4444-4444', primaryPhone: '8444-4444', activeLoanCount: 3, assignmentStatus: 'WITHOUT_COLLECTOR', route: { id: 'route-2', name: 'Libre' }, collector: null, territory: null },
  ],
};
const filters = { search: '', collectorId: '', routeId: '', provinceCode: '', cantonCode: '', districtCode: '', assignmentStatus: 'ALL' as const, page: 1, pageSize: 20 as const };
const controller = new CustomerAgendaController({ load: async () => data });
const render = (state: CustomerAgendaState, permissions = { customers: true, loans: true }, collectorScoped = false) => renderToStaticMarkup(<MemoryRouter><CustomerAgendaView state={state} controller={controller} canViewCustomers={permissions.customers} canViewLoans={permissions.loans} collectorScoped={collectorScoped} /></MemoryRouter>);

describe('CustomerAgendaView', () => {
  it('renders only three summary cards and a dense table with explicit incidents', () => {
    const html = render({ filters, data, loading: false, error: '' });
    for (const text of ['Agenda de clientes', 'Clientes con préstamo activo', '>16<', 'Con cobrador', '>11<', 'Sin cobrador', '>5<', 'Cliente', 'Identificación', 'Teléfono', 'Cobrador', 'Ruta', 'Préstamos activos', 'Acción', 'Ana Mora', 'Ruta inactiva', 'Ruta no disponible', 'Cobrador no disponible', 'María Rojas', 'Sin ruta', 'José Vega', 'Ruta sin cobrador']) expect(html).toContain(text);
    expect(html.match(/customer-agenda__summary-card"/g)).toHaveLength(3);
    expect(html).toContain('customer-agenda__table-wrap');
    expect(html).not.toContain('customer-agenda__customer-card');
  });

  it('uses compact permission-gated links and remains read-only', () => {
    const html = render({ filters, data, loading: false, error: '' });
    expect(html).toContain('href="/customers/customer-1"');
    expect(html).toContain('href="/loans?search=1-1111-1111"');
    expect(html.indexOf('Ver cliente Ana Mora')).toBeLessThan(html.indexOf('Ver préstamos de Ana Mora'));
    expect(render({ filters, data, loading: false, error: '' }, { customers: true, loans: false })).not.toContain('Ver préstamos de Ana Mora');
    expect(render({ filters, data, loading: false, error: '' }, { customers: false, loans: true })).not.toContain('Ver cliente Ana Mora');
    expect(html).not.toMatch(/Asignar|Editar|Guardar/);
  });

  it('renders exact empty messages plus loading and retryable error states', () => {
    const empty = { ...data, items: [], pagination: { ...data.pagination, total: 0, totalPages: 0 } };
    expect(render({ filters, data: empty, loading: false, error: '' })).toContain('No hay clientes con préstamos activos para los filtros seleccionados.');
    expect(render({ filters: { ...filters, assignmentStatus: 'UNASSIGNED' }, data: empty, loading: false, error: '' })).toContain('No hay clientes con préstamos activos pendientes de asignación.');
    expect(render({ filters, data: null, loading: true, error: '' })).toContain('Cargando agenda de clientes…');
    const error = render({ filters, data: null, loading: false, error: 'No se pudo cargar la agenda de clientes.' });
    expect(error).toContain('No pudimos cargar la agenda de clientes');
    expect(error).toContain('Reintentar');
  });

  it('hides global collector and unassigned filters for the scoped collector view', () => {
    const scoped = { ...data, summary: { ...data.summary, total: 11, assigned: 11, unassigned: 0,
      withoutRoute: 0, routeWithoutCollector: 0, invalidRoute: 0, invalidCollector: 0 } };
    const html = render({ filters, data: scoped, loading: false, error: '' }, { customers: false, loans: false }, true);
    expect(html).not.toContain('<label>Cobrador');
    expect(html).not.toContain('Sin cobrador</option>');
    expect(html).toContain('Sin cobrador</span><strong>0</strong>');
    expect(html).toContain('Ruta<select');
    expect(html).toContain('Guanacaste');
    expect(html).not.toContain('Ver cliente Ana Mora');
    expect(html).not.toContain('Ver préstamos de Ana Mora');
  });
});
