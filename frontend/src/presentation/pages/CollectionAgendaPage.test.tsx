import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CollectionAgendaController, type CollectionAgendaState } from '../../application/use-cases/collection-agenda-controller';
import type { CollectionAgendaCustomer, CollectionAgendaResult } from '../../domain/entities/collection-agenda';
import { CollectionAgendaView } from './CollectionAgendaPage';

const customer: CollectionAgendaCustomer = { customerId: 'customer-1', customerName: 'Ana Mora', identification: '1-1111-1111', primaryPhone: '8888-0000', secondaryPhone: null,
  address: { exact: 'Frente al parque', district: 'Santa Cruz', canton: 'Santa Cruz', province: 'Guanacaste' }, coordinates: { latitude: '10.2', longitude: '-85.5' }, propertyPhoto: { available: true, accessPath: '/protected' },
  obligations: [
    { loanId: 'loan-1', loanNumber: '101', paymentPlanEntryId: 'entry-1', sequence: 1, dueDate: '2026-10-03', pendingAmount: '15000.00', collectionStatus: 'OVERDUE' },
    { loanId: 'loan-2', loanNumber: '245', paymentPlanEntryId: 'entry-2', sequence: 2, dueDate: '2026-10-05', pendingAmount: '20000.00', collectionStatus: 'DUE_TODAY' },
    { loanId: 'loan-3', loanNumber: '300', paymentPlanEntryId: 'entry-3', sequence: 1, dueDate: '2026-10-07', pendingAmount: '9000.00', collectionStatus: 'UPCOMING' },
  ] };
const data: CollectionAgendaResult = { referenceDate: '2026-10-05', period: { fromDate: null, toDate: '2026-10-11' },
  summary: { overdue: { obligations: 12, customers: 10, amount: '120000.00' }, dueToday: { obligations: 8, customers: 7, amount: '85000.00' }, upcoming: { obligations: 21, customers: 18, amount: '240000.00' } },
  pagination: { page: 1, pageSize: 20, totalObligations: 41, totalPages: 3 },
  collectors: [{ collectorId: 'collector-1', collectorUserId: 'user-1', collectorName: 'Gloriana Peña Ramírez', routes: [{ routeId: 'route-1', routeName: 'Santa-Cruz 01', customers: [customer] }] }],
  unassigned: { withoutRoute: [], withoutCollector: [], invalidCollector: [], invalidRoute: [] },
  warnings: [{ code: 'UNASSIGNED_ROUTE', obligations: 3, message: 'internal backend label' }, { code: 'UNASSIGNED_COLLECTOR', obligations: 1, message: 'internal backend label' }] };
const filters = { period: 'WEEK' as const, referenceDate: '2026-10-05', fromDate: '', toDate: '2026-10-11', collectorId: '', routeId: '', collectionStatus: 'ALL' as const, search: '', page: 1, pageSize: 20 as const };
const controller = new CollectionAgendaController({ load: async () => data }, () => '2026-10-05');
const render = (state: CollectionAgendaState) => renderToStaticMarkup(<CollectionAgendaView state={state} controller={controller} />);

describe('CollectionAgendaView', () => {
  it('renders authoritative summaries, hierarchy and independent obligations by status', () => {
    const html = render({ filters, data, collectors: [{ id: 'collector-1', name: 'Gloriana Peña Ramírez' }], routes: [{ id: 'route-1', name: 'Santa-Cruz 01', collectorId: 'collector-1' }], loading: false, error: '' });
    for (const text of ['Agenda de cobros', 'VENCIDOS', '12 obligaciones', '₡120.000 pendiente', 'PARA HOY', 'PRÓXIMOS', 'Gloriana Peña Ramírez', 'Santa-Cruz 01', 'Ana Mora', 'Vencido', 'Hoy', 'Próximo', 'Préstamo #101', 'Préstamo #245', 'Préstamo #300', 'Frente al parque', 'Ubicación disponible', 'Fotografía disponible']) expect(html).toContain(text);
    expect(html).toContain('Página 1 de 3 · 41 obligaciones');
    expect(html).not.toContain('Registrar pago');
    expect(html).not.toContain('/payments/new');
    expect(html).not.toContain('latitude');
    expect(html).not.toContain('/protected');
  });

  it('uses the personal title only in the collector view', () => {
    const state = { filters, data, collectors: [], routes: [], loading: false, error: '' };
    expect(renderToStaticMarkup(<CollectionAgendaView state={state} controller={controller} collectorView />)).toContain('Mi agenda de cobros');
    expect(render(state)).toContain('Agenda de cobros');
    expect(render(state)).not.toContain('Mi agenda de cobros');
  });

  it('renders presets, server filter controls and custom date inputs', () => {
    const html = render({ filters: { ...filters, period: 'CUSTOM', fromDate: '2026-10-01' }, data, collectors: [{ id: 'collector-1', name: 'Gloriana Peña Ramírez' }], routes: [{ id: 'route-1', name: 'Santa-Cruz 01', collectorId: 'collector-1' }], loading: false, error: '' });
    for (const text of ['Hoy', 'Mañana', 'Esta semana', 'Rango personalizado', 'Buscar cliente', 'Cobrador', 'Ruta', 'Estado', 'Desde', 'Hasta', 'Todos los cobradores', 'Todas las rutas']) expect(html).toContain(text);
  });

  it('shows operational integrity warnings without financial-loss language', () => {
    const html = render({ filters, data, collectors: [], routes: [], loading: false, error: '' });
    expect(html).toContain('Requieren atención');
    expect(html).toContain('3</strong> obligaciones de clientes sin ruta');
    expect(html).toContain('1</strong> obligaciones en rutas sin cobrador');
    expect(html).not.toContain('fraude');
  });

  it('distinguishes period and filtered empty states', () => {
    const empty = { ...data, collectors: [], summary: { overdue: { obligations: 0, customers: 0, amount: '0.00' }, dueToday: { obligations: 0, customers: 0, amount: '0.00' }, upcoming: { obligations: 0, customers: 0, amount: '0.00' } }, pagination: { page: 1, pageSize: 20, totalObligations: 0, totalPages: 0 }, warnings: [] };
    expect(render({ filters, data: empty, collectors: [], routes: [], loading: false, error: '' })).toContain('No hay cobros programados para este período');
    expect(render({ filters: { ...filters, search: 'Ana' }, data: empty, collectors: [], routes: [], loading: false, error: '' })).toContain('No hay resultados con los filtros seleccionados');
  });

  it('renders loading and retryable forbidden/error states', () => {
    expect(render({ filters, data: null, collectors: [], routes: [], loading: true, error: '' })).toContain('Cargando agenda de cobros');
    const error = render({ filters, data: null, collectors: [], routes: [], loading: false, error: 'No tienes permiso para consultar la agenda de cobros.' });
    expect(error).toContain('No pudimos cargar la agenda');
    expect(error).toContain('Reintentar');
  });
});
