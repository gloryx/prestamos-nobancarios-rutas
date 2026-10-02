import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type RefObject } from 'react';
import { createLoanAnnulment } from '../../app/loan-annulment';
import { LoanAnnulmentController, type LoanAnnulmentState } from '../../application/use-cases/loan-annulment-controller';
import type { AnnullableLoanItem, AnnulledLoanItem, AnnulmentSort } from '../../domain/entities/loan';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { LoanAnnulmentDialog } from '../components/LoanAnnulmentDialog';
import { TableActions } from '../components/TableActions';
import { Icon } from '../components/layout/Icon';
import { useAuth } from '../hooks/auth-context';

const candidateColumns: { key: AnnulmentSort; label: string }[] = [
  { key: 'loanNumber', label: 'Préstamo' }, { key: 'customer', label: 'Cliente' },
  { key: 'startDate', label: 'Inicio' }, { key: 'principal', label: 'Capital' },
  { key: 'interest', label: 'Interés' }, { key: 'contractualTotal', label: 'Total contractual' },
];
const annulledColumns: { key: AnnulmentSort; label: string }[] = [
  ...candidateColumns.slice(0, 3), { key: 'annulledDate', label: 'Anulado' }, ...candidateColumns.slice(3),
];
const resolutionLabel = { NOT_DELIVERED: 'No entregado', RETURNED_IN_FULL: 'Devuelto íntegramente' } as const;

export function LoanAnnulmentManagementPage({ controller: supplied }: { controller?: LoanAnnulmentController } = {}): ReactElement {
  const { can } = useAuth();
  const canRef = useRef(can);
  useEffect(() => { canRef.current = can; }, [can]);
  const [controller] = useState(() => supplied ?? createLoanAnnulment(() => canRef.current('loans.status.annul')));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const candidateTab = useRef<HTMLButtonElement | null>(null);
  const annulledTab = useRef<HTMLButtonElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => { void controller.load(); }, [controller]);
  useEffect(() => {
    if (wasOpen.current && !state.attempt) {
      (trigger.current?.isConnected ? trigger.current : state.activeTab === 'CANDIDATES' ? candidateTab.current : annulledTab.current)?.focus();
      trigger.current = null;
    }
    wasOpen.current = Boolean(state.attempt);
  }, [state.attempt, state.activeTab]);
  const begin = (loan: AnnullableLoanItem) => {
    const focused = document.activeElement;
    if (controller.begin(loan)) trigger.current = focused instanceof HTMLButtonElement ? focused : null;
  };
  return <LoanAnnulmentManagementView state={state} controller={controller} canAnnul={can('loans.status.annul')} onBegin={begin}
    candidateTabRef={candidateTab} annulledTabRef={annulledTab} />;
}

function SortHeader({ label, active, direction, onSort }: {
  label: string; active: boolean; direction: 'asc' | 'desc'; onSort(): void;
}): ReactElement {
  return <th scope="col" aria-sort={active ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
    <button className="loan-sort-button" type="button" aria-label={`${label}: ordenar ${active && direction === 'asc' ? 'descendente' : 'ascendente'}`} onClick={onSort}>
      <span>{label}</span><Icon name={active ? direction === 'asc' ? 'sort-asc' : 'sort-desc' : 'sort'} />
    </button>
  </th>;
}

export function LoanAnnulmentManagementView({ state, controller, canAnnul = false, onBegin, candidateTabRef, annulledTabRef }: {
  state: LoanAnnulmentState; controller: LoanAnnulmentController;
  canAnnul?: boolean; onBegin?: (loan: AnnullableLoanItem) => void;
  candidateTabRef?: RefObject<HTMLButtonElement | null>; annulledTabRef?: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const candidates = state.activeTab === 'CANDIDATES';
  const ready = state.dataTab === state.activeTab && state.dataPage !== null;
  const stale = ready && (state.dataPage !== state.page || state.loading || state.refreshing || Boolean(state.error));
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const sort = candidates ? state.sorts.CANDIDATES : state.sorts.ANNULLED;
  const cards = [
    { label: 'TOTAL', value: state.summary?.total.toLocaleString('es-CR') },
    { label: 'CAPITAL', value: state.summary && formatCRCAggregate(state.summary.capital) },
    { label: 'INTERÉS', value: state.summary && formatCRCAggregate(state.summary.interest) },
    { label: 'TOTAL CONTRACTUAL', value: state.summary && formatCRCAggregate(state.summary.contractualTotal) },
  ];
  return <section className="page-section loan-list loan-management" aria-labelledby="loan-annulment-title">
    <div className="loan-list__heading"><div><span className="eyebrow">PRÉSTAMOS</span><h1 id="loan-annulment-title">Gestión de anulaciones</h1>
      <p>Consulta los préstamos candidatos y anulados.</p></div>
      <button className="button button--secondary loan-management__refresh" type="button" title="Refrescar préstamos" aria-label="Refrescar préstamos"
        aria-busy={state.refreshing} disabled={state.loading || state.refreshing} onClick={() => { void controller.refresh(); }}>
        <span className={state.refreshing ? 'loan-management__spinning' : undefined}><Icon name="reverse" /></span>Refrescar
      </button></div>
    <div className="loan-management__summary" aria-label="Resumen de anulaciones">{cards.map(({ label, value }) =>
      <div key={label}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</div>
    <div className="loan-list__surface">
      <div className="loan-management__tabs" role="tablist" aria-label="Estado de anulación" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'CANDIDATES' : event.key === 'End' ? 'ANNULLED' : candidates ? 'ANNULLED' : 'CANDIDATES';
        controller.setActiveTab(next);
        (next === 'CANDIDATES' ? candidateTabRef : annulledTabRef)?.current?.focus();
      }}>
        <button ref={candidateTabRef} role="tab" id="loan-annulment-candidates-tab" aria-controls="loan-annulment-panel" aria-selected={candidates}
          tabIndex={candidates ? 0 : -1} type="button" onClick={() => controller.setActiveTab('CANDIDATES')}>Candidatos</button>
        <button ref={annulledTabRef} role="tab" id="loan-annulment-annulled-tab" aria-controls="loan-annulment-panel" aria-selected={!candidates}
          tabIndex={candidates ? -1 : 0} type="button" onClick={() => controller.setActiveTab('ANNULLED')}>Anulados</button>
      </div>
      <div className="loan-list__toolbar" aria-label="Filtros de anulaciones">
        <label htmlFor="loan-annulment-search">Buscar<input id="loan-annulment-search" value={state.search} placeholder="Préstamo, cliente o identificación"
          onChange={(event) => controller.setSearch(event.target.value)} /></label>
        <label htmlFor="loan-annulment-start">Fecha desde<input id="loan-annulment-start" type="date" value={state.startDate}
          onChange={(event) => controller.setStartDate(event.target.value)} /></label>
        <label htmlFor="loan-annulment-end">Fecha hasta<input id="loan-annulment-end" type="date" value={state.endDate}
          onChange={(event) => controller.setEndDate(event.target.value)} /></label>
      </div>
      {state.feedback && <div className={state.feedback.kind === 'error' ? 'loan-list__message loan-list__message--error' : 'success-message'}
        role={state.feedback.kind === 'error' ? 'alert' : 'status'}>{state.feedback.message}</div>}
      {state.error && <div className="loan-list__message loan-list__message--error" role="alert">{state.error}
        {ready && ' Se muestran datos anteriores; pueden no coincidir con los filtros actuales.'}</div>}
      {state.loading && <div className="loan-list__message" role="status">Cargando préstamos…</div>}
      {state.refreshing && <span className="loan-list__sr-only" role="status">Actualizando préstamos…</span>}
      {stale && !state.error && <p className="loan-management__stale">Datos anteriores; la consulta actual aún no está confirmada.</p>}
      <div id="loan-annulment-panel" role="tabpanel" aria-labelledby={candidates ? 'loan-annulment-candidates-tab' : 'loan-annulment-annulled-tab'}
        aria-label={stale ? 'Resultados anteriores' : undefined}>
        {!ready && !state.loading && !state.error && <div className="loan-list__message" role="status">Cargando préstamos…</div>}
        {ready && !stale && !state.items.length && <div className="loan-list__message"><strong>{state.total
          ? 'No hay préstamos en esta página.' : state.search || state.startDate || state.endDate
            ? 'No se encontraron préstamos con los filtros seleccionados.' : candidates ? 'No hay préstamos candidatos.' : 'No hay préstamos anulados.'}</strong></div>}
        {ready && state.items.length > 0 && <div className="loan-list__table-wrap" tabIndex={0} role="region"
          aria-label={`Tabla de préstamos ${candidates ? 'candidatos' : 'anulados'}`}>
          <table className="loan-list__table"><caption className="loan-list__sr-only">Préstamos {candidates ? 'candidatos' : 'anulados'}</caption>
            <thead><tr>{(candidates ? candidateColumns : annulledColumns).map(({ key, label }) =>
              <SortHeader key={key} label={label} active={sort.sortBy === key} direction={sort.sortDir} onSort={() => controller.sort(key)} />)}
              {candidates && canAnnul && <th scope="col" className="loan-list__actions">Acción</th>}
              {!candidates && <><th scope="col">Resolución</th><th scope="col">Motivo</th></>}</tr></thead>
            <tbody>{candidates ? (state.items as AnnullableLoanItem[]).map((row) => <tr key={row.loanId}>
              <td>#{row.loanNumber}</td><td><strong title={row.customer.fullName}>{row.customer.fullName}</strong><small>{row.customer.identification}</small></td>
              <td>{formatDateOnlyForDisplay(row.startDate)}</td><td className="loan-list__numeric">{formatCRCAggregate(row.principal)}</td>
              <td className="loan-list__numeric">{formatCRCAggregate(row.interestAmount)}</td><td className="loan-list__numeric">{formatCRCAggregate(row.totalAmount)}</td>
              {canAnnul && <td className="loan-list__actions"><TableActions ariaLabel={`Acciones del préstamo ${row.loanNumber}`} actions={[
                { key: 'annul', icon: 'lock', label: 'Anular', title: 'Anular préstamo', ariaLabel: `Anular préstamo ${row.loanNumber}`,
                  onClick: () => (onBegin ?? controller.begin.bind(controller))(row) },
              ]} /></td>}
            </tr>) : (state.items as AnnulledLoanItem[]).map((row) => <tr key={row.loanId}>
              <td>#{row.loanNumber}</td><td><strong title={row.customer.fullName}>{row.customer.fullName}</strong><small>{row.customer.identification}</small></td>
              <td>{formatDateOnlyForDisplay(row.startDate)}</td><td>{formatDateOnlyForDisplay(row.annulledBusinessDate)}</td>
              <td className="loan-list__numeric">{formatCRCAggregate(row.principal)}</td><td className="loan-list__numeric">{formatCRCAggregate(row.interestAmount)}</td>
              <td className="loan-list__numeric">{formatCRCAggregate(row.totalAmount)}</td><td>{resolutionLabel[row.disbursementResolution]}</td>
              <td className="loan-management__reason" title={row.reason || undefined}>{row.reason || '—'}</td>
            </tr>)}</tbody>
          </table></div>}
      </div>
      {ready && <nav className="loan-list__pagination" aria-label="Páginas de anulaciones">
        <label htmlFor="loan-annulment-size">Por página <select id="loan-annulment-size" value={state.pageSize}
          onChange={(event) => controller.setPageSize(Number(event.target.value) as 10 | 20 | 50)}>
          {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        <button className="button button--secondary" type="button" disabled={state.page <= 1 || state.loading}
          onClick={() => controller.setPage(state.page - 1)}>Anterior</button>
        <span>Página {state.page} de {pages} · {state.total} préstamos</span>
        <button className="button button--secondary" type="button" disabled={state.page >= pages || state.loading}
          onClick={() => controller.setPage(state.page + 1)}>Siguiente</button>
      </nav>}
    </div>
    {state.attempt && canAnnul && <LoanAnnulmentDialog attempt={state.attempt} onReason={(value) => controller.setReason(value)}
      onResolution={(value) => controller.setResolution(value)} onSubmit={() => { void controller.submit(); }} onClose={() => controller.abandon()} />}
  </section>;
}
