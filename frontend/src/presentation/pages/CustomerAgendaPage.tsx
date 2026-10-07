import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactElement } from 'react';
import { AlertTriangle, RefreshCw, Search, UserRoundCheck, UserRoundX, UsersRound } from 'lucide-react';
import { createCustomerAgenda } from '../../app/customer-agenda';
import { territorialUseCases } from '../../app/territorial';
import { CustomerAgendaController, type CustomerAgendaState } from '../../application/use-cases/customer-agenda-controller';
import type { CustomerAgendaItem, CustomerAgendaPageSize } from '../../domain/entities/customer-agenda';
import type { Canton, District, Province } from '../../domain/entities/territorial';
import { TableActions } from '../components/TableActions';
import { useAuth } from '../hooks/auth-context';

const UNASSIGNED = 'UNASSIGNED';

export function CustomerAgendaPage({ controller: supplied }: { controller?: CustomerAgendaController } = {}): ReactElement {
  const { can, user } = useAuth();
  const [controller] = useState(() => supplied ?? createCustomerAgenda());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { void controller.load(); return () => controller.dispose(); }, [controller]);
  const collectorScoped = user?.role.code === 'COLLECTOR' && !user.role.isSuperAdmin;
  return <CustomerAgendaView state={state} controller={controller} canViewCustomers={can('customers.view')} canViewLoans={can('loans.view')} collectorScoped={collectorScoped} />;
}

function Summary({ state }: { state: CustomerAgendaState }): ReactElement {
  const cards = state.data ? [
    { label: 'Clientes con préstamo activo', value: state.data.summary.total, icon: UsersRound },
    { label: 'Con cobrador', value: state.data.summary.assigned, icon: UserRoundCheck },
    { label: 'Sin cobrador', value: state.data.summary.unassigned, icon: UserRoundX },
  ] : [];
  return <section className="customer-agenda__summary" aria-label="Resumen de agenda de clientes">
    {state.loading ? [1, 2, 3].map((key) => <div className="customer-agenda__summary-card customer-agenda__skeleton" key={key} />) :
      cards.map(({ label, value, icon: Icon }) => <article className="customer-agenda__summary-card" key={label}><Icon aria-hidden="true" /><div><span>{label}</span><strong>{value}</strong></div></article>)}
  </section>;
}

function IncidentBadge({ item }: { item: CustomerAgendaItem }): ReactElement | null {
  if (item.assignmentStatus === 'WITHOUT_ROUTE') return <span className="customer-agenda__incident customer-agenda__incident--route">Sin ruta</span>;
  if (item.assignmentStatus === 'WITHOUT_COLLECTOR') return <span className="customer-agenda__incident customer-agenda__incident--collector">Ruta sin cobrador</span>;
  if (item.assignmentStatus === 'INVALID_ROUTE') return <span className="customer-agenda__incident customer-agenda__incident--route">Ruta no disponible</span>;
  if (item.assignmentStatus === 'INVALID_COLLECTOR') return <span className="customer-agenda__incident customer-agenda__incident--collector">Cobrador no disponible</span>;
  return null;
}

function Results({ state, canViewCustomers, canViewLoans }: { state: CustomerAgendaState; canViewCustomers: boolean; canViewLoans: boolean }): ReactElement | null {
  const data = state.data;
  if (!data) return null;
  if (!data.items.length) return <div className="customer-agenda__empty">
    <UsersRound aria-hidden="true" />
    <strong>{state.filters.assignmentStatus === 'UNASSIGNED'
      ? 'No hay clientes con préstamos activos pendientes de asignación.'
      : 'No hay clientes con préstamos activos para los filtros seleccionados.'}</strong>
  </div>;
  return <div className="customer-agenda__table-wrap"><table className="customer-agenda__table">
    <caption className="sr-only">Agenda de clientes con préstamos activos</caption>
    <thead><tr><th>Cliente</th><th>Identificación</th><th>Teléfono</th><th>Cobrador</th><th>Ruta</th><th className="customer-agenda__numeric">Préstamos activos</th><th>Acción</th></tr></thead>
    <tbody>{data.items.map((item) => <tr key={item.customerId}>
      <td><strong>{item.customerName}</strong><IncidentBadge item={item} /></td>
      <td>{item.identification}</td><td>{item.primaryPhone || '—'}</td>
      <td>{item.collector?.name ?? 'Sin cobrador'}</td>
      <td>{item.route?.name ?? 'Sin ruta'}</td>
      <td className="customer-agenda__numeric">{item.activeLoanCount}</td>
      <td><TableActions ariaLabel={`Acciones de ${item.customerName}`} actions={[
        ...(canViewCustomers ? [{ key: 'customer', icon: 'view' as const, label: 'Ver cliente', title: 'Ver cliente', ariaLabel: `Ver cliente ${item.customerName}`, to: `/customers/${item.customerId}` }] : []),
        ...(canViewLoans ? [{ key: 'loans', icon: 'payment' as const, label: 'Ver préstamos', title: 'Ver préstamos', ariaLabel: `Ver préstamos de ${item.customerName}`, to: `/loans?search=${encodeURIComponent(item.identification)}` }] : []),
      ]} /></td>
    </tr>)}</tbody>
  </table></div>;
}

function Filters({ state, controller, collectorScoped }: { state: CustomerAgendaState; controller: CustomerAgendaController; collectorScoped: boolean }): ReactElement {
  const [search, setSearch] = useState(state.filters.search);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [cantons, setCantons] = useState<Canton[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [territorialError, setTerritorialError] = useState('');
  useEffect(() => {
    let active = true;
    if (collectorScoped) return () => { active = false; };
    setTerritorialError('');
    void territorialUseCases.listProvinces.execute().then((items) => { if (active) setProvinces(items); })
      .catch(() => { if (active) setTerritorialError('No se pudieron cargar las opciones territoriales.'); });
    return () => { active = false; };
  }, [collectorScoped]);
  useEffect(() => {
    let active = true;
    setCantons([]); setDistricts([]);
    if (collectorScoped) return () => { active = false; };
    if (!state.filters.provinceCode) return () => { active = false; };
    setTerritorialError('');
    void territorialUseCases.listCantons.execute(Number(state.filters.provinceCode)).then((items) => { if (active) setCantons(items); })
      .catch(() => { if (active) setTerritorialError('No se pudieron cargar las opciones territoriales.'); });
    return () => { active = false; };
  }, [collectorScoped, state.filters.provinceCode]);
  useEffect(() => {
    let active = true;
    setDistricts([]);
    if (collectorScoped) return () => { active = false; };
    if (!state.filters.provinceCode || !state.filters.cantonCode) return () => { active = false; };
    setTerritorialError('');
    void territorialUseCases.listDistricts.execute({ provinceCode: Number(state.filters.provinceCode), cantonCode: Number(state.filters.cantonCode) })
      .then((items) => { if (active) setDistricts(items); })
      .catch(() => { if (active) setTerritorialError('No se pudieron cargar las opciones territoriales.'); });
    return () => { active = false; };
  }, [collectorScoped, state.filters.provinceCode, state.filters.cantonCode]);

  const collectorValue = state.filters.assignmentStatus === 'UNASSIGNED' ? UNASSIGNED : state.filters.collectorId;
  const routes = state.data?.options.routes.filter((route) => collectorValue === UNASSIGNED
    ? route.collectorId === null
    : !collectorValue || route.collectorId === collectorValue) ?? [];
  const provinceOptions = collectorScoped ? state.data?.options.provinces ?? [] : provinces;
  const cantonOptions = collectorScoped
    ? state.data?.options.cantons.filter((item) => item.provinceCode === Number(state.filters.provinceCode)) ?? []
    : cantons;
  const districtOptions = collectorScoped
    ? state.data?.options.districts.filter((item) => item.cantonCode === Number(state.filters.cantonCode)) ?? []
    : districts;
  const submit = (event: FormEvent) => { event.preventDefault(); controller.submitSearch(search); };
  return <form className="customer-agenda__filters" aria-label="Filtros de agenda de clientes" onSubmit={submit}>
    <label className="customer-agenda__search">Buscar<span><Search aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, identificación o teléfono" /></span></label>
    <button className="button button--secondary" type="submit">Buscar</button>
    {!collectorScoped && <label>Cobrador<select value={collectorValue} onChange={(event) => controller.setCollector(event.target.value)}><option value="">Todos</option>{state.data?.options.collectors.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}<option value={UNASSIGNED}>Sin cobrador</option></select></label>}
    <label>Ruta<select value={state.filters.routeId} onChange={(event) => controller.setFilter('routeId', event.target.value)}><option value="">Todas</option>{routes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label>Provincia<select value={state.filters.provinceCode} onChange={(event) => controller.setFilter('provinceCode', event.target.value)}><option value="">Todas</option>{provinceOptions.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}</select></label>
    <label>Cantón<select value={state.filters.cantonCode} disabled={!state.filters.provinceCode} onChange={(event) => controller.setFilter('cantonCode', event.target.value)}><option value="">Todos</option>{cantonOptions.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}</select></label>
    <label>Distrito<select value={state.filters.districtCode} disabled={!state.filters.cantonCode} onChange={(event) => controller.setFilter('districtCode', event.target.value)}><option value="">Todos</option>{districtOptions.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}</select></label>
    <label>Filas<select value={state.filters.pageSize} onChange={(event) => controller.setPageSize(Number(event.target.value) as CustomerAgendaPageSize)}>{[10, 20, 50].map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
    {territorialError && <span className="customer-agenda__filter-error" role="alert">{territorialError}</span>}
  </form>;
}

function Pager({ state, controller }: { state: CustomerAgendaState; controller: CustomerAgendaController }): ReactElement | null {
  const pagination = state.data?.pagination;
  if (!pagination || pagination.total === 0) return null;
  return <nav className="customer-agenda__pagination" aria-label="Páginas de agenda de clientes">
    <button className="button button--secondary" type="button" disabled={pagination.page <= 1 || state.loading} onClick={() => controller.setPage(pagination.page - 1)}>Anterior</button>
    <span>Página {pagination.page} de {Math.max(1, pagination.totalPages)} · {pagination.total} clientes</span>
    <button className="button button--secondary" type="button" disabled={pagination.page >= pagination.totalPages || state.loading} onClick={() => controller.setPage(pagination.page + 1)}>Siguiente</button>
  </nav>;
}

export function CustomerAgendaView({ state, controller, canViewCustomers, canViewLoans, collectorScoped = false }: {
  state: CustomerAgendaState; controller: CustomerAgendaController; canViewCustomers: boolean; canViewLoans: boolean; collectorScoped?: boolean;
}): ReactElement {
  return <section className="page-section customer-agenda" aria-labelledby="customer-agenda-title">
    <header className="customer-agenda__heading"><div><span className="eyebrow">COBRADORES</span><h1 id="customer-agenda-title">Agenda de clientes</h1><p>Consulta la asignación de clientes con préstamos activos.</p></div><button className="button button--secondary" type="button" disabled={state.loading} onClick={() => controller.retry()}><RefreshCw aria-hidden="true" />Actualizar</button></header>
    <Filters state={state} controller={controller} collectorScoped={collectorScoped} />
    <Summary state={state} />
    {state.loading && <div className="customer-agenda__loading" role="status">Cargando agenda de clientes…</div>}
    {state.error && <div className="customer-agenda__error" role="alert"><AlertTriangle aria-hidden="true" /><div><strong>No pudimos cargar la agenda de clientes</strong><p>{state.error}</p><button className="button button--secondary" type="button" onClick={() => controller.retry()}>Reintentar</button></div></div>}
    {!state.loading && !state.error && <><Results state={state} canViewCustomers={canViewCustomers} canViewLoans={canViewLoans} /><Pager state={state} controller={controller} /></>}
  </section>;
}
