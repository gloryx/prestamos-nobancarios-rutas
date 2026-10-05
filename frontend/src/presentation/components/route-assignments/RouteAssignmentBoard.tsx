import { useState, type ReactElement, type ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronLeft, CircleAlert, GripVertical, MapPinned, MoreVertical, Route, Search, UserRound, Users } from 'lucide-react';
import type { AssignmentWorkspace, AssignmentWorkspaceCollector, AssignmentWorkspaceCustomer, AssignmentWorkspaceRoute } from '../../../domain/entities/route-assignment';
import type { Canton, District } from '../../../domain/entities/territorial';
import { filterVisibleCustomers } from './route-assignment-visibility';

type MobileStep = 'collectors' | 'routes' | 'customers';
type Props = {
  workspace: AssignmentWorkspace;
  selectedCollectorUserId: string | null;
  selectedRouteId: string | null;
  showUnassignedCustomers: boolean;
  pendingRoutes: Set<string>;
  pendingCustomers: Set<string>;
  dragging: 'route' | 'customer' | null;
  canMoveRoutes: boolean;
  canMoveCustomers: boolean;
  unassignedSearch: string;
  cantonCode?: number;
  districtCode?: number;
  cantons: Canton[];
  districts: District[];
  territorialLoading: boolean;
  territorialError: string;
  onUnassignedSearchChange(value: string): void;
  onSearchUnassigned(): void;
  onCantonChange(value?: number): void;
  onDistrictChange(value?: number): void;
  onClearFilters(): void;
  onUnassignedPage(page: number): void;
  onSelectCollector(id: string | null): void;
  onSelectRoute(id: string): void;
  onShowUnassignedCustomers(): void;
  onMoveRoute(routeId: string, collectorUserId: string | null): void;
  onMoveCustomer(customerId: string, routeId: string | null): void;
};

const countCustomers = (collector: AssignmentWorkspaceCollector) => collector.routes.reduce((total, route) => total + route.customers.length, 0);
function DropTarget({ id, active, className, children }: { id: string; active: boolean; className: string; children: (drop: { setNodeRef(node: HTMLElement | null): void; isOver: boolean }) => ReactNode }): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !active });
  return <div ref={setNodeRef} data-drop-target={id} className={`${className}${active ? ' assignment-drop--active' : ''}${isOver ? ' assignment-drop--over' : ''}`}>{children({ setNodeRef, isOver })}</div>;
}

function DragHandle({ id, kind, label, disabled }: { id: string; kind: 'route' | 'customer'; label: string; disabled: boolean }): ReactElement | null {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, isDragging } = useDraggable({ id: `${kind}:${id}`, disabled });
  if (disabled) return null;
  return <button ref={(node) => { setNodeRef(node); setActivatorNodeRef(node); }} className={`assignment-drag-handle${isDragging ? ' assignment-drag-handle--dragging' : ''}`} type="button" aria-label={label} title={label} {...listeners} {...attributes}><GripVertical aria-hidden="true" /></button>;
}

function CollectorCard({ collector, selected, pending, dragging, canMoveRoutes, onSelect }: { collector: AssignmentWorkspaceCollector; selected: boolean; pending: boolean; dragging: Props['dragging']; canMoveRoutes: boolean; onSelect(): void }): ReactElement {
  return <DropTarget id={`collector:${collector.collectorUserId}`} active={dragging === 'route' && canMoveRoutes} className="assignment-drop-shell">
    {() => <article className={`assignment-card assignment-card--collector${selected ? ' assignment-card--selected' : ''}${pending ? ' assignment-card--pending' : ''}`}>
      <button className="assignment-card__select" type="button" aria-pressed={selected} onClick={onSelect}>
        <span className="assignment-card__icon"><UserRound aria-hidden="true" /></span><span className="assignment-card__body"><strong>{collector.name}</strong><small>{collector.routes.length} {collector.routes.length === 1 ? 'ruta' : 'rutas'} · {countCustomers(collector)} clientes</small></span><ChevronLeft className="assignment-card__chevron" aria-hidden="true" />
      </button>{dragging === 'route' && <span className="assignment-drop-label">Soltar para asignar o mover ruta</span>}
    </article>}
  </DropTarget>;
}

function RouteCard({ route, owner, collectors, selected, pending, dragging, canMoveRoutes, canMoveCustomers, onSelect, onMove }: { route: AssignmentWorkspaceRoute; owner: string | null; collectors: AssignmentWorkspaceCollector[]; selected: boolean; pending: boolean; dragging: Props['dragging']; canMoveRoutes: boolean; canMoveCustomers: boolean; onSelect(): void; onMove(owner: string | null): void }): ReactElement {
  return <DropTarget id={`route:${route.routeId}`} active={dragging === 'customer' && canMoveCustomers} className="assignment-drop-shell">
    {() => <article className={`assignment-card assignment-card--route${selected ? ' assignment-card--selected' : ''}${pending ? ' assignment-card--pending' : ''}`}>
      <DragHandle id={route.routeId} kind="route" label={`Arrastrar ruta ${route.routeName}`} disabled={!canMoveRoutes} />
      <button className="assignment-card__select" type="button" aria-pressed={selected} onClick={onSelect}><span className="assignment-card__icon"><Route aria-hidden="true" /></span><span className="assignment-card__body"><strong>{route.routeName}</strong><small>{route.customers.length} {route.customers.length === 1 ? 'cliente' : 'clientes'}</small>{pending && <em>Cambio pendiente</em>}</span></button>
      {canMoveRoutes && <details className="assignment-menu"><summary aria-label={`Acciones de ruta ${route.routeName}`} title={`Acciones de ruta ${route.routeName}`}><MoreVertical aria-hidden="true" /></summary><label>{owner ? 'Cambiar cobrador' : 'Asignar cobrador'}<select aria-label={`Cobrador para ${route.routeName}`} value={owner ?? ''} onChange={(event) => onMove(event.target.value || null)}><option value="">Sin cobrador</option>{collectors.map((collector) => <option key={collector.collectorUserId} value={collector.collectorUserId}>{collector.name}</option>)}</select></label></details>}
      {dragging === 'customer' && <span className="assignment-drop-label">Soltar para asignar o mover cliente</span>}
    </article>}
  </DropTarget>;
}

function CustomerCard({ customer, routeId, routes, pending, canMove, showLocation, onMove }: { customer: AssignmentWorkspaceCustomer; routeId: string | null; routes: AssignmentWorkspaceRoute[]; pending: boolean; canMove: boolean; showLocation: boolean; onMove(routeId: string | null): void }): ReactElement {
  return <article className={`assignment-card assignment-card--customer${pending ? ' assignment-card--pending' : ''}`}>
    <DragHandle id={customer.customerId} kind="customer" label={`Arrastrar cliente ${customer.name}`} disabled={!canMove} />
    <span className="assignment-card__icon"><UserRound aria-hidden="true" /></span><span className="assignment-card__body"><strong>{customer.name}</strong><small className="assignment-card__meta"><span>{customer.identification}</span><span aria-hidden="true">·</span><span>{customer.phone}</span></small>{showLocation && customer.cantonName && customer.districtName && <small className="assignment-card__location">{customer.cantonName} · {customer.districtName}</small>}{pending && <em>Cambio pendiente</em>}</span>
    {canMove && <details className="assignment-menu"><summary aria-label={`Acciones de cliente ${customer.name}`} title={`Acciones de cliente ${customer.name}`}><MoreVertical aria-hidden="true" /></summary><label>{routeId ? 'Cambiar ruta' : 'Asignar a ruta'}<select aria-label={`Ruta para ${customer.name}`} value={routeId ?? ''} onChange={(event) => onMove(event.target.value || null)}><option value="">Sin ruta</option>{routes.map((route) => <option key={route.routeId} value={route.routeId}>{route.routeName}</option>)}</select></label></details>}
  </article>;
}

function Panel({ kind, step, title, subtitle, onBack, children }: { kind: MobileStep; step: MobileStep; title: string; subtitle: string; onBack?: () => void; children: ReactNode }): ReactElement {
  return <section className={`assignment-panel assignment-panel--${kind}${step === kind ? ' assignment-panel--mobile-current' : ''}`} aria-label={title}><header>{onBack && <button className="assignment-back" type="button" onClick={onBack} aria-label="Volver al nivel anterior"><ChevronLeft aria-hidden="true" /></button>}<div><p>{title}</p><span>{subtitle}</span></div></header><div className="assignment-panel__scroll">{children}</div></section>;
}

export function RouteAssignmentBoard(props: Props): ReactElement {
  const [collectorSearch, setCollectorSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [mobileStep, setMobileStep] = useState<MobileStep>('collectors');
  const collectors = props.workspace.collectors.filter((collector) => collector.name.toLocaleLowerCase().includes(collectorSearch.trim().toLocaleLowerCase()));
  const selectedCollector = props.workspace.collectors.find((collector) => collector.collectorUserId === props.selectedCollectorUserId);
  const allRoutes = [...props.workspace.collectors.flatMap((collector) => collector.routes), ...props.workspace.unassignedRoutes];
  const visibleRoutes = props.dragging === 'customer' ? allRoutes : selectedCollector?.routes ?? (props.selectedCollectorUserId === null ? props.workspace.unassignedRoutes : []);
  const selectedRoute = allRoutes.find((route) => route.routeId === props.selectedRouteId);
  const visibleCustomers = filterVisibleCustomers(props.showUnassignedCustomers ? props.workspace.unassignedCustomers.items : selectedRoute?.customers ?? [], customerSearch, props.showUnassignedCustomers);
  const owner = (routeId: string) => props.workspace.collectors.find((collector) => collector.routes.some((route) => route.routeId === routeId))?.collectorUserId ?? null;
  const collectorPending = (collector: AssignmentWorkspaceCollector) => collector.routes.some((route) => props.pendingRoutes.has(route.routeId));
  const routeTitle = props.dragging === 'customer' ? 'Rutas disponibles' : selectedCollector ? `Rutas de ${selectedCollector.name}` : 'Rutas sin cobrador';
  const customerTitle = props.showUnassignedCustomers ? 'Clientes sin ruta' : selectedRoute ? `Clientes · ${selectedRoute.routeName}` : 'Clientes';
  const filtersActive = Boolean(props.unassignedSearch.trim() || props.cantonCode !== undefined || props.districtCode !== undefined);
  const chooseCollector = (id: string | null) => { props.onSelectCollector(id); setMobileStep('routes'); };
  const chooseRoute = (id: string) => { props.onSelectRoute(id); setCustomerSearch(''); setMobileStep('customers'); };

  return <div className="assignment-board">
    <Panel kind="collectors" step={mobileStep} title="Cobradores" subtitle={`${props.workspace.collectors.length} activos`}>
      <label className="assignment-search"><Search aria-hidden="true" /><span className="sr-only">Buscar cobrador</span><input value={collectorSearch} onChange={(event) => setCollectorSearch(event.target.value)} placeholder="Buscar por nombre" /></label>
      <div className="assignment-card-list">{collectors.map((collector) => <CollectorCard key={collector.collectorUserId} collector={collector} selected={collector.collectorUserId === props.selectedCollectorUserId} pending={collectorPending(collector)} dragging={props.dragging} canMoveRoutes={props.canMoveRoutes} onSelect={() => chooseCollector(collector.collectorUserId)} />)}{!collectors.length && <Empty icon={<UserRound />} text="No encontramos coincidencias." />}</div>
      <div className="assignment-inboxes"><button type="button" className={props.selectedCollectorUserId === null && !props.showUnassignedCustomers ? 'active' : ''} onClick={() => chooseCollector(null)}><MapPinned aria-hidden="true" /><span>Rutas sin cobrador</span><strong>{props.workspace.unassignedRoutes.length}</strong></button><button type="button" className={props.showUnassignedCustomers ? 'active' : ''} onClick={() => { props.onShowUnassignedCustomers(); setMobileStep('customers'); }}><Users aria-hidden="true" /><span>Clientes sin ruta</span><strong>{props.workspace.unassignedCustomers.totalUnassigned}</strong></button></div>
    </Panel>
    <Panel kind="routes" step={mobileStep} title={routeTitle} subtitle={`${visibleRoutes.length} ${visibleRoutes.length === 1 ? 'ruta' : 'rutas'}`} onBack={() => setMobileStep('collectors')}>
      {props.canMoveRoutes && <DropTarget id="unassigned-routes" active={props.dragging === 'route'} className="assignment-unassign-target">{() => <><MapPinned aria-hidden="true" /><span>{props.dragging === 'route' ? 'Soltar aquí para quitar cobrador' : 'Quitar cobrador'}</span></>}</DropTarget>}
      <div className="assignment-card-list">{visibleRoutes.map((route) => <RouteCard key={route.routeId} route={route} owner={owner(route.routeId)} collectors={props.workspace.collectors} selected={route.routeId === props.selectedRouteId} pending={props.pendingRoutes.has(route.routeId)} dragging={props.dragging} canMoveRoutes={props.canMoveRoutes} canMoveCustomers={props.canMoveCustomers} onSelect={() => chooseRoute(route.routeId)} onMove={(target) => props.onMoveRoute(route.routeId, target)} />)}{!visibleRoutes.length && <Empty icon={<Route />} text={selectedCollector ? 'No tiene rutas asignadas.' : 'Todas las rutas tienen cobrador.'} />}</div>
    </Panel>
    <Panel kind="customers" step={mobileStep} title={customerTitle} subtitle={props.showUnassignedCustomers ? filtersActive ? `${props.workspace.unassignedCustomers.total} resultados` : `${props.workspace.unassignedCustomers.totalUnassigned} sin asignar` : `${selectedRoute?.customers.length ?? 0} en esta ruta`} onBack={() => setMobileStep(props.showUnassignedCustomers ? 'collectors' : 'routes')}>
      {props.showUnassignedCustomers ? <form className="assignment-server-filters" onSubmit={(event) => { event.preventDefault(); props.onSearchUnassigned(); }}><div className="assignment-server-search"><label className="assignment-search"><Search aria-hidden="true" /><span className="sr-only">Buscar clientes sin ruta</span><input value={props.unassignedSearch} onChange={(event) => props.onUnassignedSearchChange(event.target.value)} placeholder="Nombre, identificación o teléfono" /></label><button className="button button--secondary" type="submit">Buscar</button></div><div className="assignment-territorial-filters"><label>Cantón<select aria-label="Filtrar por cantón" value={props.cantonCode ?? ''} disabled={props.territorialLoading && !props.cantons.length} onChange={(event) => props.onCantonChange(event.target.value ? Number(event.target.value) : undefined)}><option value="">Todos los cantones</option>{props.cantons.map((canton) => <option key={canton.code} value={canton.code}>{canton.name}</option>)}</select></label><label>Distrito<select aria-label="Filtrar por distrito" value={props.districtCode ?? ''} disabled={props.cantonCode === undefined || props.territorialLoading} onChange={(event) => props.onDistrictChange(event.target.value ? Number(event.target.value) : undefined)}><option value="">{props.cantonCode === undefined ? 'Seleccione un cantón' : 'Todos los distritos'}</option>{props.districts.map((district) => <option key={district.code} value={district.code}>{district.name}</option>)}</select></label></div>{props.territorialError && <span className="assignment-filter-error" role="alert">{props.territorialError}</span>}{filtersActive && <button className="assignment-clear-filters" type="button" onClick={props.onClearFilters}>Limpiar filtros</button>}</form> : <label className="assignment-search"><Search aria-hidden="true" /><span className="sr-only">Buscar clientes de la ruta</span><input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Nombre, identificación o teléfono" /></label>}
      {props.canMoveCustomers && <DropTarget id="unassigned-customers" active={props.dragging === 'customer'} className="assignment-unassign-target">{() => <><Users aria-hidden="true" /><span>{props.dragging === 'customer' ? 'Soltar aquí para quitar de esta ruta' : 'Quitar de esta ruta'}</span></>}</DropTarget>}
      <div className="assignment-card-list">{visibleCustomers.map((customer) => <CustomerCard key={customer.customerId} customer={customer} routeId={props.showUnassignedCustomers ? null : selectedRoute?.routeId ?? null} routes={allRoutes} pending={props.pendingCustomers.has(customer.customerId)} canMove={props.canMoveCustomers} showLocation={props.showUnassignedCustomers} onMove={(target) => props.onMoveCustomer(customer.customerId, target)} />)}{!visibleCustomers.length && <Empty icon={<Users />} text={customerSearch.trim() || filtersActive ? 'No encontramos coincidencias.' : props.showUnassignedCustomers ? 'Todos los clientes están asignados.' : selectedRoute ? 'No tiene clientes asignados.' : 'Selecciona una ruta para ver sus clientes.'} />}</div>
      {props.showUnassignedCustomers && <div className="assignment-pagination"><button type="button" disabled={props.workspace.unassignedCustomers.page <= 1} onClick={() => props.onUnassignedPage(props.workspace.unassignedCustomers.page - 1)}>Anterior</button><span>Página {props.workspace.unassignedCustomers.page}</span><button type="button" disabled={props.workspace.unassignedCustomers.page * props.workspace.unassignedCustomers.pageSize >= props.workspace.unassignedCustomers.total} onClick={() => props.onUnassignedPage(props.workspace.unassignedCustomers.page + 1)}>Siguiente</button></div>}
    </Panel>
  </div>;
}

function Empty({ icon, text }: { icon: ReactNode; text: string }): ReactElement { return <div className="assignment-empty">{icon}<p>{text}</p></div>; }

export function AssignmentPermissionNotice(): ReactElement { return <div className="assignment-permission-notice"><CircleAlert aria-hidden="true" /><span>Podés consultar la organización, pero necesitás un permiso de asignación para mover elementos.</span></div>; }
