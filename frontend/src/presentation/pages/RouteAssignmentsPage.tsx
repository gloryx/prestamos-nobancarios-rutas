import { useEffect, useState, type ReactElement } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { CheckCircle2, CircleAlert, RotateCcw, Save, Undo2 } from 'lucide-react';
import { routeUseCases } from '../../app/routes';
import { territorialUseCases } from '../../app/territorial';
import { cloneAssignmentWorkspace, deriveAssignmentOperations, moveCustomer, moveRoute, pendingAssignmentIds, saveAssignmentDraft, updateAssignmentWorkspaceFilters } from '../../application/use-cases/route-assignment-workspace';
import { RouteAssignmentRepositoryError } from '../../application/ports/route-assignment.repository';
import type { AssignmentWorkspace, AssignmentWorkspaceQuery } from '../../domain/entities/route-assignment';
import type { Canton, District } from '../../domain/entities/territorial';
import { AssignmentPermissionNotice, RouteAssignmentBoard } from '../components/route-assignments/RouteAssignmentBoard';
import { useAuth } from '../hooks/auth-context';

type DragKind = 'route' | 'customer' | null;
const discardMessage = 'Hay cambios de asignación sin guardar. ¿Descartarlos?';

export function RouteAssignmentsPage(): ReactElement {
  const { can } = useAuth();
  const canMoveRoutes = can('routes.assign.collectors');
  const canMoveCustomers = can('routes.assign.customers');
  const [confirmed, setConfirmed] = useState<AssignmentWorkspace>();
  const [working, setWorking] = useState<AssignmentWorkspace>();
  const [history, setHistory] = useState<AssignmentWorkspace[]>([]);
  const [query, setQuery] = useState<AssignmentWorkspaceQuery>({ search: '', activeLoanFilter: 'ALL', page: 1, pageSize: 20 });
  const [searchDraft, setSearchDraft] = useState('');
  const [cantons, setCantons] = useState<Canton[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [territorialLoading, setTerritorialLoading] = useState(true);
  const [territorialError, setTerritorialError] = useState('');
  const [selectedCollector, setSelectedCollector] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [showUnassignedCustomers, setShowUnassignedCustomers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [success, setSuccess] = useState('');
  const [conflict, setConflict] = useState(false);
  const [dragging, setDragging] = useState<DragKind>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }), useSensor(KeyboardSensor));
  const operations = confirmed && working ? deriveAssignmentOperations(confirmed, working) : [];
  const pending = pendingAssignmentIds(operations);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void routeUseCases.assignmentWorkspace.execute(query).then((workspace) => {
      if (!active) return;
      setConfirmed(workspace); setWorking(cloneAssignmentWorkspace(workspace)); setHistory([]); setConflict(false);
      setSelectedCollector((current) => current !== null && workspace.collectors.some((collector) => collector.collectorUserId === current) ? current : workspace.collectors[0]?.collectorUserId ?? null);
    }).catch((cause) => { if (active) setError(loadError(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query]);

  useEffect(() => {
    let active = true;
    setTerritorialLoading(true); setTerritorialError('');
    void territorialUseCases.listCantons.execute().then((items) => { if (active) setCantons(items); }).catch(() => { if (active) setTerritorialError('No se pudieron cargar los cantones.'); }).finally(() => { if (active) setTerritorialLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (query.cantonCode === undefined) { setDistricts([]); return () => { active = false; }; }
    setTerritorialLoading(true); setTerritorialError('');
    void territorialUseCases.listDistricts.execute({ cantonCode: query.cantonCode }).then((items) => { if (active) setDistricts(items); }).catch(() => { if (active) setTerritorialError('No se pudieron cargar los distritos.'); }).finally(() => { if (active) setTerritorialLoading(false); });
    return () => { active = false; };
  }, [query.cantonCode]);

  useEffect(() => {
    if (!operations.length) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const links = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest('a[href]');
      if (anchor && !window.confirm('Hay cambios de asignación sin guardar.')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload); document.addEventListener('click', links, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', links, true); };
  }, [operations.length]);

  useEffect(() => {
    if (!success) return;
    const timeout = window.setTimeout(() => setSuccess(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [success]);

  const changeWorking = (next: AssignmentWorkspace) => {
    if (!working || next === working) return;
    const nextOperations = confirmed ? deriveAssignmentOperations(confirmed, next) : [];
    setHistory(nextOperations.length ? [...history, working] : []);
    setWorking(next); setSaveError(''); setSuccess(''); setConflict(false);
  };
  const changeRoute = (routeId: string, collectorUserId: string | null) => { if (working && canMoveRoutes) changeWorking(moveRoute(working, routeId, collectorUserId)); };
  const changeCustomer = (customerId: string, routeId: string | null) => { if (working && canMoveCustomers) changeWorking(moveCustomer(working, customerId, routeId)); };
  const undo = () => { const previous = history.at(-1); if (previous) { setWorking(previous); setHistory(history.slice(0, -1)); setSaveError(''); setConflict(false); } };
  const discard = () => { if (!confirmed || !operations.length || window.confirm(discardMessage)) { if (confirmed) setWorking(cloneAssignmentWorkspace(confirmed)); setHistory([]); setSaveError(''); setConflict(false); } };
  const replaceQuery = (next: AssignmentWorkspaceQuery) => { if (operations.length && !window.confirm(discardMessage)) return; setSearchDraft(next.search ?? ''); setQuery(next); };
  const save = async () => {
    if (!confirmed || !working || !operations.length || operations.length > 100) return;
    setSaving(true); setSaveError(''); setSuccess(''); setConflict(false);
    try {
      const result = await saveAssignmentDraft(confirmed, working, (request) => routeUseCases.saveAssignmentWorkspace.execute(request));
      if (result.status === 'SAVED') {
        setConfirmed(result.confirmed); setWorking(result.working); setHistory([]);
        setSuccess('Asignaciones guardadas correctamente.');
      } else if (result.status === 'CONFLICT') { setConflict(true); setSaveError('Las asignaciones cambiaron desde que abriste esta pantalla.'); }
      else if (result.status === 'FAILED') setSaveError(saveErrorMessage(result.error));
    } finally { setSaving(false); }
  };
  const refreshAfterConflict = () => { if (!operations.length || window.confirm('Se descartarán tus cambios locales para cargar las asignaciones actuales.')) setQuery((current) => ({ ...current })); };
  const onDragStart = (event: DragStartEvent) => setDragging(String(event.active.id).startsWith('route:') ? 'route' : 'customer');
  const onDragEnd = (event: DragEndEvent) => {
    const source = String(event.active.id); const target = event.over ? String(event.over.id) : '';
    setDragging(null);
    if (source.startsWith('route:')) {
      const routeId = source.slice(6);
      if (target.startsWith('collector:')) changeRoute(routeId, target.slice(10));
      else if (target === 'unassigned-routes') changeRoute(routeId, null);
    } else if (source.startsWith('customer:')) {
      const customerId = source.slice(9);
      if (target.startsWith('route:')) changeCustomer(customerId, target.slice(6));
      else if (target === 'unassigned-customers') changeCustomer(customerId, null);
    }
  };

  return <section className="route-assignments-page"><header className="assignment-heading"><div><p className="eyebrow">ORGANIZACIÓN OPERATIVA</p><h2>Rutas y asignaciones</h2><p>Organizá cobradores, rutas y clientes antes de guardar todo en un solo lote.</p></div>{operations.length > 0 && <span className="assignment-heading__pending">{operations.length} {operations.length === 1 ? 'cambio pendiente' : 'cambios pendientes'}</span>}</header>
    {error && !confirmed && <div className="assignment-load-error" role="alert"><CircleAlert aria-hidden="true" /><div><strong>No pudimos cargar las asignaciones</strong><p>{error}</p><button className="button button--secondary" type="button" onClick={() => setQuery((current) => ({ ...current }))}>Reintentar</button></div></div>}
    {error && confirmed && <div className="assignment-inline-error" role="alert"><CircleAlert aria-hidden="true" /><span>No pudimos actualizar los clientes sin ruta. {error}</span></div>}
    {loading && !working && <AssignmentSkeleton />}
    {loading && working && <div className="assignment-refreshing" role="status">Actualizando clientes sin ruta…</div>}
    {working && <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd} accessibility={{ announcements: { onDragStart: ({ active }) => `Moviendo ${active.id}.`, onDragOver: ({ over }) => over ? `Destino ${over.id}.` : 'Fuera de un destino.', onDragEnd: ({ over }) => over ? `Elemento movido a ${over.id}.` : 'Movimiento cancelado.', onDragCancel: () => 'Movimiento cancelado.' } }}>
      {!canMoveRoutes && !canMoveCustomers && <AssignmentPermissionNotice />}
      <RouteAssignmentBoard workspace={working} selectedCollectorUserId={selectedCollector} selectedRouteId={selectedRoute} showUnassignedCustomers={showUnassignedCustomers} pendingRoutes={pending.routes} pendingCustomers={pending.customers} dragging={dragging} canMoveRoutes={canMoveRoutes} canMoveCustomers={canMoveCustomers} unassignedSearch={searchDraft} cantonCode={query.cantonCode} districtCode={query.districtCode} activeLoanFilter={query.activeLoanFilter ?? 'ALL'} cantons={cantons} districts={districts} territorialLoading={territorialLoading} territorialError={territorialError} onUnassignedSearchChange={setSearchDraft} onSearchUnassigned={() => replaceQuery(updateAssignmentWorkspaceFilters(query, { search: searchDraft }))} onCantonChange={(cantonCode) => replaceQuery(updateAssignmentWorkspaceFilters(query, { cantonCode }))} onDistrictChange={(districtCode) => replaceQuery(updateAssignmentWorkspaceFilters(query, { districtCode }))} onActiveLoanFilterChange={(activeLoanFilter) => replaceQuery(updateAssignmentWorkspaceFilters(query, { activeLoanFilter }))} onClearFilters={() => replaceQuery(updateAssignmentWorkspaceFilters(query, { search: '', cantonCode: undefined, districtCode: undefined, activeLoanFilter: 'ALL' }))} onUnassignedPage={(page) => replaceQuery({ ...query, page })} onSelectCollector={(id) => { setSelectedCollector(id); setSelectedRoute(null); setShowUnassignedCustomers(false); }} onSelectRoute={(id) => { setSelectedRoute(id); setShowUnassignedCustomers(false); }} onShowUnassignedCustomers={() => setShowUnassignedCustomers(true)} onMoveRoute={changeRoute} onMoveCustomer={changeCustomer} />
    </DndContext>}
    {working && operations.length > 0 && <aside className="assignment-save-bar" aria-label="Cambios pendientes"><div><strong>{operations.length} {operations.length === 1 ? 'cambio pendiente' : 'cambios pendientes'}</strong><span>Los cambios todavía no se guardaron.</span></div><div>{history.length > 0 && <button className="button button--secondary" type="button" onClick={undo}><Undo2 aria-hidden="true" />Deshacer último</button>}<button className="button button--secondary" type="button" onClick={discard}><RotateCcw aria-hidden="true" />Descartar cambios</button><button className="button button--primary" type="button" disabled={saving || operations.length > 100} onClick={() => void save()}><Save aria-hidden="true" />{saving ? 'Guardando…' : 'Guardar cambios'}</button></div></aside>}
    {operations.length > 100 && <div className="catalog-message catalog-message--error" role="alert">El lote admite hasta 100 cambios. Guardá un grupo más pequeño.</div>}
    {success && <div className="assignment-toast assignment-toast--success" role="status"><CheckCircle2 aria-hidden="true" />{success}</div>}
    {saveError && <div className={`assignment-toast assignment-toast--error${conflict ? ' assignment-toast--conflict' : ''}`} role="alert"><CircleAlert aria-hidden="true" /><span>{saveError}</span>{conflict && <button type="button" onClick={refreshAfterConflict}>Actualizar asignaciones</button>}</div>}
  </section>;
}

const loadError = (cause: unknown) => cause instanceof RouteAssignmentRepositoryError ? cause.reason === 'FORBIDDEN' ? 'No tenés permiso para consultar este workspace.' : cause.reason === 'NETWORK' ? 'No hay conexión con el servidor. Revisá tu red e intentá nuevamente.' : cause.message : 'Ocurrió un error inesperado al cargar el workspace.';
const saveErrorMessage = (cause: unknown) => cause instanceof RouteAssignmentRepositoryError ? cause.reason === 'FORBIDDEN' ? 'No tenés permiso para guardar estas asignaciones.' : cause.reason === 'NETWORK' ? 'Se perdió la conexión. Tus cambios siguen pendientes.' : cause.message : 'No fue posible guardar. Tus cambios siguen pendientes.';

function AssignmentSkeleton(): ReactElement { return <div className="assignment-board assignment-skeleton" aria-label="Cargando asignaciones">{['Cobradores', 'Rutas', 'Clientes'].map((label) => <section className="assignment-panel" key={label}><header><div><p>{label}</p><span>Cargando…</span></div></header><div className="assignment-panel__scroll">{[1, 2, 3].map((item) => <div className="assignment-skeleton__card" key={item} />)}</div></section>)}</div>; }
