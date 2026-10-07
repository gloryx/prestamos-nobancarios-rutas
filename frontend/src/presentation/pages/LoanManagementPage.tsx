import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type RefObject } from 'react';
import { createLoanManagement } from '../../app/loan-management';
import { type LoanManagementState, type LoanOperation, LoanManagementController } from '../../application/use-cases/loan-management-controller';
import type { OverdueLoan, OverdueLoanSort, UncollectibleLoan, UncollectibleLoanSort } from '../../domain/entities/loan';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { TableActions } from '../components/TableActions';
import { Icon } from '../components/layout/Icon';
import { LoanManagementStatusDialog } from '../components/LoanManagementStatusDialog';
import { useAuth } from '../hooks/auth-context';
import { loanManagementMessage } from '../helpers/loan-management-message';

const overdueColumns: { key: OverdueLoanSort; label: string }[] = [
  { key: 'loanNumber', label: 'Préstamo' }, { key: 'customer', label: 'Cliente' }, { key: 'startDate', label: 'Inicio' },
  { key: 'firstOverdueDueDate', label: 'Vencimiento' }, { key: 'principal', label: 'Prestado' },
  { key: 'recoveredAmount', label: 'Recuperado' }, { key: 'financialBalance', label: 'Pendiente' },
];
const uncollectibleColumns: { key: UncollectibleLoanSort; label: string }[] = [
  { key: 'loanNumber', label: 'Préstamo' }, { key: 'customer', label: 'Cliente' }, { key: 'startDate', label: 'Inicio' },
  { key: 'uncollectibleDate', label: 'Incobrable desde' }, { key: 'principal', label: 'Prestado' },
  { key: 'recoveredAmount', label: 'Recuperado' }, { key: 'financialBalance', label: 'Pendiente' },
];
type Row = OverdueLoan | UncollectibleLoan;
const permission = (operation: LoanOperation) => operation === 'MARK' ? 'loans.status.uncollectible' : 'loans.status.reactivate';

export function LoanManagementPage({ controller: supplied }: { controller?: LoanManagementController } = {}): ReactElement {
  const { can } = useAuth();
  const canRef = useRef(can);
  useEffect(() => { canRef.current = can; }, [can]);
  const [controller] = useState(() => supplied ?? createLoanManagement((operation) => canRef.current(permission(operation))));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const selected = useRef<Row | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement | null>(null);
  const overdueTab = useRef<HTMLButtonElement | null>(null);
  const uncollectibleTab = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => { void controller.load(); }, [controller]);
  useEffect(() => {
    if (wasOpen.current && !state.actionAttempt) {
      const fallback = state.activeTab === 'OVERDUE' ? overdueTab.current : uncollectibleTab.current;
      const previous = trigger.current?.isConnected && !trigger.current.disabled ? trigger.current : null;
      const refresh = refreshButton.current?.isConnected && !refreshButton.current.disabled ? refreshButton.current : null;
      (previous ?? refresh ?? fallback)?.focus();
      selected.current = null;
    }
    wasOpen.current = Boolean(state.actionAttempt);
  }, [state.actionAttempt, state.activeTab]);

  const begin = (operation: LoanOperation, row: Row) => {
    const focused = document.activeElement;
    trigger.current = focused instanceof HTMLButtonElement ? focused : null;
    selected.current = row;
    if (!controller.beginAttempt(operation, row)) selected.current = null;
  };
  return <LoanManagementView state={state} controller={controller} can={can} onBegin={begin} selectedRow={selected.current}
    refreshRef={refreshButton} overdueTabRef={overdueTab} uncollectibleTabRef={uncollectibleTab} />;
}

function SortHeader({ label, active, direction, onSort }: { label: string; active: boolean; direction: 'asc' | 'desc'; onSort(): void }): ReactElement {
  const next = active && direction === 'asc' ? 'descendente' : 'ascendente';
  return <th scope="col" aria-sort={active ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
    <button className="loan-sort-button" type="button" aria-label={`${label}: ordenar ${next}`} onClick={onSort}>
      <span>{label}</span><Icon name={active ? direction === 'asc' ? 'sort-asc' : 'sort-desc' : 'sort'} />
    </button>
  </th>;
}

export function LoanManagementView({ state, controller, can, onBegin, selectedRow, refreshRef, overdueTabRef, uncollectibleTabRef }: {
  state: LoanManagementState; controller: LoanManagementController; can: (code: string) => boolean;
  onBegin: (operation: LoanOperation, row: Row) => void; selectedRow?: Row | null;
  refreshRef?: RefObject<HTMLButtonElement | null>; overdueTabRef?: RefObject<HTMLButtonElement | null>; uncollectibleTabRef?: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const overdue = state.activeTab === 'OVERDUE';
  const stale = state.dataPage !== null && (state.loading || state.refreshing || Boolean(state.error) || state.dataPage !== state.page);
  const ready = state.dataPage !== null;
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const summary = state.summary;
  const cards = [
    { label: 'TOTAL', value: summary?.total.toLocaleString('es-CR') },
    { label: 'PRESTADO', value: summary && formatCRCAggregate(summary.lentAmount) },
    { label: 'RECUPERADO', value: summary && formatCRCAggregate(summary.recoveredAmount) },
    { label: 'PENDIENTE', value: summary && formatCRCAggregate(summary.pendingAmount) },
  ];
  return <section className="page-section loan-list loan-management" aria-labelledby="loan-management-title">
    <div className="loan-list__heading"><div><span className="eyebrow">PRÉSTAMOS</span><h1 id="loan-management-title">Gestión de incobrables</h1>
      <p>Consulta los préstamos vencidos e incobrables y gestiona su estado.</p></div>
      <button ref={refreshRef} className="button button--secondary loan-management__refresh" type="button" title="Refrescar préstamos" aria-label="Refrescar préstamos"
        aria-busy={state.refreshing} disabled={state.loading || state.refreshing} onClick={() => { void controller.refresh(); }}>
        <span className={state.refreshing ? 'loan-management__spinning' : undefined}><Icon name="reverse" /></span>Refrescar
      </button></div>
    <div className="loan-management__summary" aria-label="Resumen de préstamos">{cards.map(({ label, value }) =>
      <div key={label}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</div>
    <div className="loan-list__surface">
      <div className="loan-management__tabs" role="tablist" aria-label="Estado de préstamos" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'UNCOLLECTIBLE' : event.key === 'End' ? 'OVERDUE' : overdue ? 'UNCOLLECTIBLE' : 'OVERDUE';
        controller.setActiveTab(next);
        (next === 'OVERDUE' ? overdueTabRef : uncollectibleTabRef)?.current?.focus();
      }}>
        <button ref={uncollectibleTabRef} role="tab" id="loan-management-uncollectible-tab" aria-controls="loan-management-panel" aria-selected={!overdue} tabIndex={overdue ? -1 : 0}
          type="button" onClick={() => controller.setActiveTab('UNCOLLECTIBLE')}>Incobrables</button>
        <button ref={overdueTabRef} role="tab" id="loan-management-overdue-tab" aria-controls="loan-management-panel" aria-selected={overdue} tabIndex={overdue ? 0 : -1}
          type="button" onClick={() => controller.setActiveTab('OVERDUE')}>Candidatos a vencerse</button>
      </div>
      <div className="loan-list__toolbar" aria-label="Filtros de préstamos">
        <label htmlFor="loan-management-search">Buscar<input id="loan-management-search" value={state.search} placeholder="Préstamo, cliente o identificación" onChange={(event) => controller.setSearch(event.target.value)} /></label>
        <label htmlFor="loan-management-start">Fecha inicio<input id="loan-management-start" type="date" value={state.startDate} onChange={(event) => controller.setStartDate(event.target.value)} /></label>
        <label htmlFor="loan-management-end">Fecha fin<input id="loan-management-end" type="date" value={state.endDate} onChange={(event) => controller.setEndDate(event.target.value)} /></label>
      </div>
      {state.successMessage && <div className="success-message" role="status">{state.successMessage === 'Loan marked uncollectible.' ? 'Préstamo marcado como incobrable.' : state.successMessage === 'Loan reactivated.' ? 'Préstamo reactivado.' : state.successMessage}</div>}
      {state.error && <div className="loan-list__message loan-list__message--error" role="alert">{loanManagementMessage(state.error)}{ready && ' Se muestran datos anteriores; pueden no coincidir con los filtros actuales.'}</div>}
      {state.loading && <div className="loan-list__message" role="status">Cargando préstamos…</div>}
      {state.refreshing && <span className="loan-list__sr-only" role="status">Actualizando préstamos…</span>}
      {stale && !state.error && <p className="loan-management__stale">Datos anteriores; la consulta actual aún no está confirmada.</p>}
      <div id="loan-management-panel" role="tabpanel" aria-labelledby={overdue ? 'loan-management-overdue-tab' : 'loan-management-uncollectible-tab'}
        aria-label={stale ? 'Resultados anteriores' : undefined}>
        {!ready && !state.loading && !state.error && <div className="loan-list__message" role="status">Cargando préstamos…</div>}
        {ready && !stale && !state.items.length && <div className="loan-list__message"><strong>{state.total
          ? 'No hay préstamos en esta página.' : state.search || state.startDate || state.endDate
            ? 'No se encontraron préstamos con los filtros seleccionados.' : overdue ? 'No hay préstamos vencidos.' : 'No hay préstamos incobrables.'}</strong></div>}
        {ready && state.items.length > 0 && <div className="loan-list__table-wrap" tabIndex={0} role="region" aria-label={`Tabla de préstamos ${overdue ? 'vencidos' : 'incobrables'}`}>
          <table className="loan-list__table"><caption className="loan-list__sr-only">Préstamos {overdue ? 'vencidos' : 'incobrables'}</caption>
            <thead><tr>{overdue ? overdueColumns.map(({ key, label }) => <SortHeader key={key} label={label} active={state.sorts.OVERDUE.sortBy === key} direction={state.sorts.OVERDUE.sortDir} onSort={() => controller.sortOverdue(key)} />)
              : uncollectibleColumns.map(({ key, label }) => <SortHeader key={key} label={label} active={state.sorts.UNCOLLECTIBLE.sortBy === key} direction={state.sorts.UNCOLLECTIBLE.sortDir} onSort={() => controller.sortUncollectible(key)} />)}
              {overdue ? <th scope="col">Cuota vencida</th> : <th scope="col">Motivo</th>}<th scope="col" className="loan-list__actions">Acción</th></tr></thead>
            <tbody>{overdue ? (state.items as OverdueLoan[]).map((row) => <tr key={row.loanId}>
              <td>#{row.loanNumber}</td><td><strong title={row.customer.fullName}>{row.customer.fullName}</strong>{row.customer.identification && <small>{row.customer.identification}</small>}</td>
              <td>{formatDateOnlyForDisplay(row.startDate)}</td><td>{formatDateOnlyForDisplay(row.firstOverdueDueDate)}</td>
              <td className="loan-list__numeric">{formatCRCAggregate(row.principal)}</td><td className="loan-list__numeric">{formatCRCAggregate(row.recoveredAmount)}</td>
              <td className="loan-list__numeric">{formatCRCAggregate(row.financialBalance)}</td><td className="loan-list__numeric">{formatCRCAggregate(row.firstOverdueAmount)}</td>
              <td className="loan-list__actions">{can(permission('MARK')) && row.canMarkUncollectible && <TableActions ariaLabel={`Acciones del préstamo ${row.loanNumber}`} actions={[
                { key: 'mark', icon: 'lock', label: 'Marcar como incobrable', title: 'Marcar como incobrable', ariaLabel: `Marcar préstamo ${row.loanNumber} como incobrable`, onClick: () => onBegin('MARK', row) },
              ]} />}</td></tr>) : (state.items as UncollectibleLoan[]).map((row) => <tr key={row.loanId}>
              <td>#{row.loanNumber}</td><td><strong title={row.customer.fullName}>{row.customer.fullName}</strong>{row.customer.identification && <small>{row.customer.identification}</small>}</td>
              <td>{formatDateOnlyForDisplay(row.startDate)}</td><td>{formatDateOnlyForDisplay(row.uncollectibleBusinessDate)}</td>
              <td className="loan-list__numeric">{formatCRCAggregate(row.principal)}</td><td className="loan-list__numeric">{formatCRCAggregate(row.recoveredAmount)}</td>
              <td className="loan-list__numeric">{formatCRCAggregate(row.financialBalance)}</td><td className="loan-management__reason" title={row.uncollectibleReason ?? undefined}>{row.uncollectibleReason ?? '—'}</td>
              <td className="loan-list__actions">{can(permission('REACTIVATE')) && <TableActions ariaLabel={`Acciones del préstamo ${row.loanNumber}`} actions={[
                { key: 'reactivate', icon: 'unlock', label: 'Reactivar', title: 'Reactivar préstamo', ariaLabel: `Reactivar préstamo ${row.loanNumber}`, onClick: () => onBegin('REACTIVATE', row) },
              ]} />}</td></tr>)}</tbody>
          </table></div>}
      </div>
      {ready && <nav className="loan-list__pagination" aria-label="Páginas de préstamos">
        <label htmlFor="loan-management-size">Por página <select id="loan-management-size" value={state.pageSize} onChange={(event) => controller.setPageSize(Number(event.target.value) as 10 | 20 | 50)}>
          {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        <button className="button button--secondary" type="button" disabled={state.page <= 1 || state.loading} onClick={() => controller.setPage(state.page - 1)}>Anterior</button>
        <span>Página {state.page} de {pages} · {state.total} préstamos</span>
        <button className="button button--secondary" type="button" disabled={state.page >= pages || state.loading} onClick={() => controller.setPage(state.page + 1)}>Siguiente</button>
      </nav>}
    </div>
    {state.actionAttempt && can(permission(state.actionAttempt.operation)) && <LoanManagementStatusDialog attempt={state.actionAttempt} row={selectedRow ?? null}
      onReason={(reason) => controller.setReason(reason)} onSubmit={() => { void controller.submit(); }} onClose={() => controller.abandon()} />}
  </section>;
}
