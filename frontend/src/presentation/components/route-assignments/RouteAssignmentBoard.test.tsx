import { renderToStaticMarkup } from 'react-dom/server';
import { DndContext } from '@dnd-kit/core';
import { describe, expect, it, vi } from 'vitest';
import type { AssignmentWorkspace } from '../../../domain/entities/route-assignment';
import { RouteAssignmentBoard } from './RouteAssignmentBoard';
import { filterVisibleCustomers } from './route-assignment-visibility';

const workspace: AssignmentWorkspace = {
  snapshotToken: 'a'.repeat(64),
  collectors: [{ collectorId: 'collector', collectorUserId: 'user', name: 'Gloriana Peña', active: true, routes: [{ routeId: 'route', routeName: 'Santa Cruz Centro', collectorAssignmentId: 'ra', customers: [{ customerId: 'customer', name: 'María López', identification: '1-1111', phone: '8888-0000', customerRouteAssignmentId: 'ca' }] }] }],
  unassignedRoutes: [{ routeId: 'free-route', routeName: 'Tamarindo', customers: [] }],
  unassignedCustomers: { items: [{ customerId: 'free-customer', name: 'Carlos Vega', identification: '2-2222', phone: '8777-0000', cantonName: 'Santa Cruz', districtName: 'Tamarindo' }], total: 1, totalUnassigned: 377, page: 1, pageSize: 20 },
};
const render = (canMoveRoutes: boolean, canMoveCustomers: boolean, showUnassignedCustomers = false, dragging: 'route' | 'customer' | null = null, filters: { search?: string; cantonCode?: number; districtCode?: number } = {}, currentWorkspace = workspace) => renderToStaticMarkup(<DndContext><RouteAssignmentBoard workspace={currentWorkspace} selectedCollectorUserId="user" selectedRouteId="route" showUnassignedCustomers={showUnassignedCustomers} pendingRoutes={new Set(['route'])} pendingCustomers={new Set(['customer'])} dragging={dragging} canMoveRoutes={canMoveRoutes} canMoveCustomers={canMoveCustomers} unassignedSearch={filters.search ?? ''} cantonCode={filters.cantonCode} districtCode={filters.districtCode} cantons={[{ code: 503, name: 'Santa Cruz', province: { code: 5, name: 'Guanacaste' } }, { code: 505, name: 'Carrillo', province: { code: 5, name: 'Guanacaste' } }]} districts={filters.cantonCode === 503 ? [{ code: 50301, name: 'Tamarindo', canton: { code: 503, name: 'Santa Cruz' }, province: { code: 5, name: 'Guanacaste' } }] : []} territorialLoading={false} territorialError="" onUnassignedSearchChange={vi.fn()} onSearchUnassigned={vi.fn()} onCantonChange={vi.fn()} onDistrictChange={vi.fn()} onClearFilters={vi.fn()} onUnassignedPage={vi.fn()} onSelectCollector={vi.fn()} onSelectRoute={vi.fn()} onShowUnassignedCustomers={vi.fn()} onMoveRoute={vi.fn()} onMoveCustomer={vi.fn()} /></DndContext>);

describe('route assignment board presentation', () => {
  it('communicates collector to route to customer and both unassigned trays', () => {
    const html = render(true, true);
    for (const content of ['Gloriana Peña', 'Santa Cruz Centro', 'María López', 'Rutas sin cobrador', 'Clientes sin ruta', 'Cambio pendiente']) expect(html).toContain(content);
    expect(html).not.toContain('saldo');
    expect(html).not.toContain('mora');
  });

  it('provides named drag handles and select-based keyboard alternatives', () => {
    const html = render(true, true);
    expect(html).toContain('aria-label="Arrastrar ruta Santa Cruz Centro"');
    expect(html).toContain('title="Arrastrar ruta Santa Cruz Centro"');
    expect(html).toContain('aria-label="Arrastrar cliente María López"');
    expect(html).toContain('title="Acciones de cliente María López"');
    expect(html).toContain('aria-label="Cobrador para Santa Cruz Centro"');
    expect(html).toContain('aria-label="Ruta para María López"');
    expect(html).toContain('Quitar cobrador');
    expect(html).toContain('Quitar de esta ruta');
  });

  it('removes mutation controls when assignment permissions are absent', () => {
    const html = render(false, false);
    expect(html).not.toContain('Arrastrar ruta Santa Cruz Centro');
    expect(html).not.toContain('Arrastrar cliente María López');
    expect(html).not.toContain('Cobrador para Santa Cruz Centro');
    expect(html).not.toContain('Ruta para María López');
  });

  it('renders server-side unassigned search and paging without loading hidden pages', () => {
    const html = render(true, true, true);
    expect(html).toContain('Buscar clientes sin ruta');
    expect(html).toContain('Carlos Vega');
    expect(html).toContain('Página 1');
    expect(html).toContain('Siguiente');
    expect(html).toContain('Asignar a ruta');
    expect(html).toContain('Todos los cantones');
    expect(html).toContain('Seleccione un cantón');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Clientes sin ruta</span><strong>377</strong>');
  });

  it('does not apply the private route search to server-paged unassigned customers', () => {
    expect(filterVisibleCustomers(workspace.unassignedCustomers.items, 'NO-COINCIDE', true)).toEqual(workspace.unassignedCustomers.items);
    expect(filterVisibleCustomers(workspace.unassignedCustomers.items, 'NO-COINCIDE', false)).toEqual([]);
  });

  it('always renders search and territorial controls when the unassigned result is empty', () => {
    const emptyWorkspace: AssignmentWorkspace = { ...workspace, unassignedCustomers: { items: [], total: 0, totalUnassigned: 377, page: 1, pageSize: 20 } };
    const html = render(true, true, true, null, {}, emptyWorkspace);
    expect(html).toContain('Buscar clientes sin ruta');
    expect(html).toContain('Filtrar por cantón');
    expect(html).toContain('Filtrar por distrito');
    expect(html).toContain('Todos los clientes están asignados.');
    expect(html).toMatch(/Página 1<\/span><button type="button" disabled=""[^>]*>Siguiente/);
  });

  it('renders dependent territorial options, filtered count, clear action and compact location', () => {
    const html = render(true, true, true, null, { search: 'Carlos', cantonCode: 503, districtCode: 50301 });
    expect(html).toContain('value="503" selected=""');
    expect(html).toContain('value="50301" selected=""');
    expect(html).toContain('1 resultados');
    expect(html).toContain('Limpiar filtros');
    expect(html).toContain('Santa Cruz · Tamarindo');
  });

  it('activates only drop targets compatible with the dragged resource', () => {
    const routeDrag = render(true, true, false, 'route');
    expect(routeDrag).toMatch(/data-drop-target="collector:user"[^>]*assignment-drop--active/);
    expect(routeDrag).toMatch(/data-drop-target="unassigned-routes"[^>]*assignment-drop--active/);
    expect(routeDrag).not.toMatch(/data-drop-target="route:route"[^>]*assignment-drop--active/);
    expect(routeDrag).not.toMatch(/data-drop-target="unassigned-customers"[^>]*assignment-drop--active/);
    expect(routeDrag).toContain('Soltar aquí para quitar cobrador');

    const customerDrag = render(true, true, false, 'customer');
    expect(customerDrag).toMatch(/data-drop-target="route:route"[^>]*assignment-drop--active/);
    expect(customerDrag).toMatch(/data-drop-target="unassigned-customers"[^>]*assignment-drop--active/);
    expect(customerDrag).not.toMatch(/data-drop-target="collector:user"[^>]*assignment-drop--active/);
    expect(customerDrag).not.toMatch(/data-drop-target="unassigned-routes"[^>]*assignment-drop--active/);
    expect(customerDrag).toContain('Soltar aquí para quitar de esta ruta');
  });

  it('keeps action menus separate from drag activators and exposes pending state', () => {
    const html = render(true, true);
    expect(html).toContain('class="assignment-drag-handle"');
    expect(html).toContain('<summary aria-label="Acciones de ruta Santa Cruz Centro"');
    expect(html).toContain('<summary aria-label="Acciones de cliente María López"');
    expect(html).toContain('assignment-card--pending');
  });
});
