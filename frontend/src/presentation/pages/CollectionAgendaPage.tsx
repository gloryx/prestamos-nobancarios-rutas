import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { AlertTriangle, CalendarDays, Camera, ChevronDown, Clock3, MapPin, Phone, RefreshCw, Route, Search, UserRound } from 'lucide-react';
import { createCollectionAgenda } from '../../app/collection-agenda';
import { CollectionAgendaController, type CollectionAgendaState } from '../../application/use-cases/collection-agenda-controller';
import type { CollectionAgendaCustomer, CollectionAgendaFilterStatus, CollectionAgendaObligation, CollectionAgendaPeriod, CollectionAgendaProblemRoute, CollectionAgendaRoute as AgendaRoute, CollectionAgendaStatus } from '../../domain/entities/collection-agenda';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { useAuth } from '../hooks/auth-context';

const statusMeta: Record<CollectionAgendaStatus, { label: string; section: string; icon: typeof AlertTriangle }> = {
  OVERDUE: { label: 'Vencido', section: 'Vencidos', icon: AlertTriangle },
  DUE_TODAY: { label: 'Hoy', section: 'Para hoy', icon: Clock3 },
  UPCOMING: { label: 'Próximo', section: 'Próximos', icon: CalendarDays },
};
const warningLabels = {
  UNASSIGNED_ROUTE: 'obligaciones de clientes sin ruta',
  UNASSIGNED_COLLECTOR: 'obligaciones en rutas sin cobrador',
  INVALID_COLLECTOR: 'obligaciones con cobrador no disponible',
  INVALID_ROUTE: 'obligaciones con ruta no disponible',
} as const;

export function CollectionAgendaPage({ controller: supplied }: { controller?: CollectionAgendaController } = {}): ReactElement {
  const { user } = useAuth();
  const [controller] = useState(() => supplied ?? createCollectionAgenda());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { void controller.load(); return () => controller.dispose(); }, [controller]);
  return <CollectionAgendaView state={state} controller={controller} collectorView={user?.role.code === 'COLLECTOR' && !user.role.isSuperAdmin} />;
}

function Summary({ state }: { state: CollectionAgendaState }): ReactElement {
  const cards = state.data ? [
    { key: 'overdue', label: 'VENCIDOS', value: state.data.summary.overdue, icon: AlertTriangle },
    { key: 'today', label: 'PARA HOY', value: state.data.summary.dueToday, icon: Clock3 },
    { key: 'upcoming', label: 'PRÓXIMOS', value: state.data.summary.upcoming, icon: CalendarDays },
  ] : [];
  return <section className="collection-agenda__summary" aria-label="Resumen de agenda">
    {state.loading ? [1, 2, 3].map((item) => <div className="collection-agenda__summary-card collection-agenda__skeleton" key={item} />) : cards.map(({ key, label, value, icon: Icon }) =>
      <article className={`collection-agenda__summary-card collection-agenda__summary-card--${key}`} key={key}><Icon aria-hidden="true" /><div><span>{label}</span><strong>{value.obligations} {value.obligations === 1 ? 'obligación' : 'obligaciones'}</strong><small>{value.customers} {value.customers === 1 ? 'cliente' : 'clientes'} · {formatCRCAggregate(value.amount)} pendiente</small></div></article>)}</section>;
}

function ObligationCard({ obligation }: { obligation: CollectionAgendaObligation }): ReactElement {
  const meta = statusMeta[obligation.collectionStatus];
  const Icon = meta.icon;
  return <article className={`collection-agenda__obligation collection-agenda__obligation--${obligation.collectionStatus.toLowerCase()}`}>
    <header><span className={`collection-agenda__status collection-agenda__status--${obligation.collectionStatus.toLowerCase()}`}><Icon aria-hidden="true" />{meta.label}</span><strong>Préstamo #{obligation.loanNumber}</strong></header>
    <dl><div><dt>Fecha</dt><dd>{formatDateOnlyForDisplay(obligation.dueDate)}</dd></div><div><dt>Pendiente</dt><dd>{formatCRCAggregate(obligation.pendingAmount)}</dd></div></dl>
  </article>;
}

function CustomerCard({ customer }: { customer: CollectionAgendaCustomer }): ReactElement {
  const location = [customer.address.canton, customer.address.district].filter(Boolean).join(' · ');
  return <article className="collection-agenda__customer"><header><span className="collection-agenda__customer-icon"><UserRound aria-hidden="true" /></span><div><h4>{customer.customerName}</h4><p>{customer.identification}</p></div></header>
    <div className="collection-agenda__contact"><a href={`tel:${customer.primaryPhone}`}><Phone aria-hidden="true" />{customer.primaryPhone}</a>{location && <span><MapPin aria-hidden="true" />{location}</span>}{customer.coordinates && <span><MapPin aria-hidden="true" />Ubicación disponible</span>}{customer.propertyPhoto.available && <span><Camera aria-hidden="true" />Fotografía disponible</span>}</div>
    {customer.address.exact && <p className="collection-agenda__address">{customer.address.exact}</p>}
    <div className="collection-agenda__obligation-groups">{(['OVERDUE', 'DUE_TODAY', 'UPCOMING'] as const).map((status) => {
      const obligations = customer.obligations.filter((item) => item.collectionStatus === status);
      return obligations.length ? <section key={status} aria-label={`${statusMeta[status].section} de ${customer.customerName}`}><h5>{statusMeta[status].section}</h5>{obligations.map((obligation) => <ObligationCard obligation={obligation} key={obligation.paymentPlanEntryId} />)}</section> : null;
    })}</div>
  </article>;
}

function RouteGroup({ route }: { route: AgendaRoute }): ReactElement {
  return <section className="collection-agenda__route"><header><Route aria-hidden="true" /><div><h3>{route.routeName}</h3><span>{route.customers.length} {route.customers.length === 1 ? 'cliente en esta página' : 'clientes en esta página'}</span></div></header><div className="collection-agenda__customers">{route.customers.map((customer) => <CustomerCard customer={customer} key={customer.customerId} />)}</div></section>;
}

function ProblemRoutes({ title, routes }: { title: string; routes: CollectionAgendaProblemRoute[] }): ReactElement | null {
  if (!routes.length) return null;
  return <section className="collection-agenda__problem-group"><h3>{title}</h3>{routes.map((route) => <RouteGroup route={route} key={route.routeId} />)}</section>;
}

function Integrity({ state }: { state: CollectionAgendaState }): ReactElement | null {
  if (!state.data?.warnings.length) return null;
  return <aside className="collection-agenda__integrity" aria-labelledby="collection-agenda-integrity-title"><header><AlertTriangle aria-hidden="true" /><div><h2 id="collection-agenda-integrity-title">Requieren atención</h2><p>Situaciones de organización o asignación.</p></div></header><ul>{state.data.warnings.map((warning) => <li key={warning.code}><strong>{warning.obligations}</strong> {warningLabels[warning.code]}</li>)}</ul></aside>;
}

function AgendaResults({ state }: { state: CollectionAgendaState }): ReactElement | null {
  const data = state.data;
  if (!data) return null;
  const filtered = Boolean(state.filters.search.trim() || state.filters.collectorId || state.filters.routeId || state.filters.collectionStatus !== 'ALL');
  if (data.pagination.totalObligations === 0) return <div className="collection-agenda__empty"><CalendarDays aria-hidden="true" /><h2>{filtered ? 'No hay resultados con los filtros seleccionados' : 'No hay cobros programados para este período'}</h2><p>Prueba otro período o ajusta los filtros de consulta.</p></div>;
  return <div className="collection-agenda__results">
    {data.collectors.map((collector) => <section className="collection-agenda__collector" key={collector.collectorId}><header><UserRound aria-hidden="true" /><div><h2>{collector.collectorName}</h2><span>{collector.routes.length} {collector.routes.length === 1 ? 'ruta en esta página' : 'rutas en esta página'}</span></div></header>{collector.routes.map((route) => <RouteGroup route={route} key={route.routeId} />)}</section>)}
    {data.unassigned.withoutRoute.length > 0 && <section className="collection-agenda__problem-group"><h3>Clientes sin ruta</h3><div className="collection-agenda__customers">{data.unassigned.withoutRoute.map((customer) => <CustomerCard customer={customer} key={customer.customerId} />)}</div></section>}
    <ProblemRoutes title="Rutas sin cobrador" routes={data.unassigned.withoutCollector} />
    <ProblemRoutes title="Cobrador no disponible" routes={data.unassigned.invalidCollector} />
    <ProblemRoutes title="Ruta no disponible" routes={data.unassigned.invalidRoute} />
  </div>;
}

function Filters({ state, controller }: { state: CollectionAgendaState; controller: CollectionAgendaController }): ReactElement {
  const routeOptions = state.filters.collectorId ? state.routes.filter((route) => !route.collectorId || route.collectorId === state.filters.collectorId) : state.routes;
  const preset = (period: CollectionAgendaPeriod, label: string) => <button type="button" className={state.filters.period === period ? 'active' : ''} aria-pressed={state.filters.period === period} onClick={() => controller.setPeriod(period)}>{label}</button>;
  return <><nav className="collection-agenda__presets" aria-label="Período de agenda">{preset('TODAY', 'Hoy')}{preset('TOMORROW', 'Mañana')}{preset('WEEK', 'Esta semana')}{preset('CUSTOM', 'Rango personalizado')}</nav>
    <details className="collection-agenda__filters" open><summary><span>Filtros de agenda</span><ChevronDown aria-hidden="true" /></summary><div>
      <label className="collection-agenda__search">Buscar cliente<span><Search aria-hidden="true" /><input value={state.filters.search} placeholder="Nombre, identificación o teléfono" onChange={(event) => controller.setFilter('search', event.target.value)} /></span></label>
      <label>Cobrador<select value={state.filters.collectorId} onChange={(event) => controller.setFilter('collectorId', event.target.value)}><option value="">Todos los cobradores</option>{state.collectors.map((collector) => <option value={collector.id} key={collector.id}>{collector.name}</option>)}</select></label>
      <label>Ruta<select value={state.filters.routeId} onChange={(event) => controller.setFilter('routeId', event.target.value)}><option value="">Todas las rutas</option>{routeOptions.map((route) => <option value={route.id} key={route.id}>{route.name}</option>)}</select></label>
      <label>Estado<select value={state.filters.collectionStatus} onChange={(event) => controller.setFilter('collectionStatus', event.target.value as CollectionAgendaFilterStatus)}><option value="ALL">Todos</option><option value="OVERDUE">Vencidos</option><option value="DUE_TODAY">Para hoy</option><option value="UPCOMING">Próximos</option></select></label>
      {state.filters.period === 'CUSTOM' && <fieldset><legend>Rango de fechas</legend><label>Desde<input type="date" value={state.filters.fromDate} onChange={(event) => controller.setCustomDate('fromDate', event.target.value)} /></label><label>Hasta<input type="date" value={state.filters.toDate} onChange={(event) => controller.setCustomDate('toDate', event.target.value)} /></label></fieldset>}
    </div></details></>;
}

function Pager({ state, controller }: { state: CollectionAgendaState; controller: CollectionAgendaController }): ReactElement | null {
  const pagination = state.data?.pagination;
  if (!pagination || pagination.totalObligations === 0) return null;
  return <nav className="collection-agenda__pagination" aria-label="Páginas de agenda"><button type="button" disabled={pagination.page <= 1 || state.loading} onClick={() => controller.setPage(pagination.page - 1)}>Anterior</button><span>Página {pagination.page} de {Math.max(1, pagination.totalPages)} · {pagination.totalObligations} obligaciones</span><button type="button" disabled={pagination.page >= pagination.totalPages || state.loading} onClick={() => controller.setPage(pagination.page + 1)}>Siguiente</button></nav>;
}

export function CollectionAgendaView({ state, controller, collectorView = false }: { state: CollectionAgendaState; controller: CollectionAgendaController; collectorView?: boolean }): ReactElement {
  return <section className="page-section collection-agenda" aria-labelledby="collection-agenda-title"><header className="collection-agenda__heading"><div><span className="eyebrow">COBRADORES</span><h1 id="collection-agenda-title">{collectorView ? 'Mi agenda de cobros' : 'Agenda de cobros'}</h1><p>Consulta los clientes y obligaciones pendientes según las rutas asignadas.</p></div><button className="button button--secondary" type="button" disabled={state.loading} onClick={() => controller.retry()}><RefreshCw aria-hidden="true" />Actualizar</button></header>
    <Filters state={state} controller={controller} />
    <Summary state={state} />
    {state.loading && <div className="collection-agenda__loading" role="status" aria-label="Cargando agenda de cobros">{[1, 2, 3].map((item) => <div className="collection-agenda__skeleton" key={item} />)}</div>}
    {state.error && <div className="collection-agenda__error" role="alert"><AlertTriangle aria-hidden="true" /><div><strong>No pudimos cargar la agenda</strong><p>{state.error}</p><button className="button button--secondary" type="button" onClick={() => controller.retry()}>Reintentar</button></div></div>}
    {!state.loading && !state.error && <><Integrity state={state} /><AgendaResults state={state} /><Pager state={state} controller={controller} /></>}
  </section>;
}
