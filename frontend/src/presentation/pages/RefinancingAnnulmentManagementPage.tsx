import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createRefinancingAnnulments } from '../../app/loan-refinancing';
import { RefinancingAnnulmentController } from '../../application/use-cases/refinancing-annulment-controller';
import type { RefinancingAnnulledSort, RefinancingAnnulmentCandidate, RefinancingAnnulmentCandidateSort,
  RefinancingAnnulmentDetail } from '../../domain/entities/loan-refinancing';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { RefinancingAnnulmentDialog } from '../components/RefinancingAnnulmentDialog';
import { TableActions } from '../components/TableActions';
import { Icon } from '../components/layout/Icon';
import { useAuth } from '../hooks/auth-context';

const typeLabel = { DATA_CORRECTION: 'Corrección de datos', CASH_REFUND: 'Devolución de dinero' } as const;
const blockerLabel: Record<string, string> = {
  CLOSED_FINANCIAL_PERIOD: 'Período financiero cerrado.', ACTIVE_CHILD_REFINANCING: 'Tiene un refinanciamiento posterior activo.',
  INCONSISTENT_ANNULLED_PAYMENT: 'Pago anulado sin conciliación completa.',
  INCONSISTENT_PAYMENT_PLANS: 'Los planes de pago no concilian.', INCONSISTENT_NEW_MONEY: 'El dinero nuevo no concilia con Caja.',
};
function SortHeader({ label, active, direction, onClick }: { label: string; active: boolean;
  direction: 'asc' | 'desc'; onClick(): void }): ReactElement {
  return <th scope="col" aria-sort={active ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button
    className="loan-sort-button" type="button" onClick={onClick}><span>{label}</span>
    <Icon name={active ? direction === 'asc' ? 'sort-asc' : 'sort-desc' : 'sort'} /></button></th>;
}

export function RefinancingAnnulmentManagementPage({ controller: supplied }: { controller?: RefinancingAnnulmentController } = {}): ReactElement {
  const { can } = useAuth(), canRef = useRef(can); useEffect(() => { canRef.current = can; }, [can]);
  const [controller] = useState(() => supplied ?? createRefinancingAnnulments(() => canRef.current('loans.refinance.annul')));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const annulledTab = useRef<HTMLButtonElement>(null), candidateTab = useRef<HTMLButtonElement>(null);
  const actionTrigger = useRef<HTMLButtonElement | null>(null), wasAttemptOpen = useRef(false);
  useEffect(() => { void controller.load(); }, [controller]);
  useEffect(() => {
    if (wasAttemptOpen.current && !state.attempt) actionTrigger.current?.focus();
    wasAttemptOpen.current = Boolean(state.attempt);
  }, [state.attempt]);
  const begin = (candidate: RefinancingAnnulmentCandidate) => {
    const focused = document.activeElement;
    if (controller.begin(candidate)) actionTrigger.current = focused instanceof HTMLButtonElement ? focused : null;
  };
  return <section className="page-section loan-list loan-management refinancing-annulment" aria-labelledby="refinancing-annulments-title">
    <header className="loan-list__heading"><div><span className="eyebrow">REFINANCIAMIENTOS</span>
      <h1 id="refinancing-annulments-title">Refinanciamientos anulados</h1><p>Consulta el historial y gestiona candidatos elegibles.</p></div>
      <button className="button button--secondary loan-management__refresh" type="button" disabled={state.loading || state.refreshing}
        onClick={() => { void controller.refresh(); }}><Icon name="reverse" />{state.refreshing ? 'Actualizando…' : 'Refrescar'}</button></header>
    <div className="loan-list__surface"><div className="loan-management__tabs" role="tablist" aria-label="Estado de anulación"
      onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault();
        const tab = event.key === 'Home' ? 'ANNULLED' : event.key === 'End' ? 'CANDIDATES'
          : state.activeTab === 'ANNULLED' ? 'CANDIDATES' : 'ANNULLED';
        controller.setActiveTab(tab); (tab === 'ANNULLED' ? annulledTab : candidateTab).current?.focus(); }}>
      {(['ANNULLED', 'CANDIDATES'] as const).map((tab) => <button ref={tab === 'ANNULLED' ? annulledTab : candidateTab}
        key={tab} role="tab" aria-selected={state.activeTab === tab}
        tabIndex={state.activeTab === tab ? 0 : -1} type="button" onClick={() => controller.setActiveTab(tab)}>
        {tab === 'ANNULLED' ? 'Anulados' : 'Candidatos'}</button>)}</div>
      <div className="loan-list__toolbar" aria-label="Filtros de anulaciones"><label>Buscar<input value={state.search}
        placeholder="Cliente, identificación o préstamo" onChange={(event) => controller.setSearch(event.target.value)} /></label>
        <label>Fecha desde<input type="date" value={state.dateFrom} onChange={(event) => controller.setDateFrom(event.target.value)} /></label>
        <label>Fecha hasta<input type="date" value={state.dateTo} onChange={(event) => controller.setDateTo(event.target.value)} /></label></div>
      {state.feedback && <p className={state.feedback.kind === 'error' ? 'loan-list__message loan-list__message--error' : 'success-message'}
        role={state.feedback.kind === 'error' ? 'alert' : 'status'}>{state.feedback.message}</p>}
      {state.error && <p className="loan-list__message loan-list__message--error" role="alert">{state.error}</p>}
      {state.loading && <p className="loan-list__message" role="status">Cargando refinanciamientos…</p>}
      {!state.loading && state.dataTab === state.activeTab && !state.items.length && <p className="loan-list__message">
        <strong>{state.total ? 'No hay resultados en esta página.' : state.activeTab === 'ANNULLED'
          ? 'No hay refinanciamientos anulados.' : 'No hay refinanciamientos candidatos.'}</strong></p>}
      {!state.loading && state.dataTab === state.activeTab && state.items.length > 0 && (state.activeTab === 'ANNULLED'
        ? <AnnulledTable items={state.items as RefinancingAnnulmentDetail[]} state={state} controller={controller} />
        : <CandidateTable items={state.items as RefinancingAnnulmentCandidate[]} state={state} controller={controller}
          canAnnul={can('loans.refinance.annul')} onBegin={begin} />)}
      {state.dataTab === state.activeTab && <nav className="loan-list__pagination" aria-label="Páginas de anulaciones">
        <label>Por página <select value={state.pageSize} onChange={(event) => controller.setPageSize(Number(event.target.value) as 10 | 20 | 50)}>
          {[10, 20, 50].map((size) => <option key={size}>{size}</option>)}</select></label>
        <button className="button button--secondary" type="button" disabled={state.page <= 1 || state.loading}
          onClick={() => controller.setPage(state.page - 1)}>Anterior</button><span>Página {state.page} de {Math.max(1, Math.ceil(state.total / state.pageSize))} · {state.total}</span>
        <button className="button button--secondary" type="button" disabled={state.page * state.pageSize >= state.total || state.loading}
          onClick={() => controller.setPage(state.page + 1)}>Siguiente</button></nav>}
    </div>
    {state.attempt && can('loans.refinance.annul') && <RefinancingAnnulmentDialog attempt={state.attempt} methods={state.paymentMethods}
      onType={(value) => controller.setType(value)} onReason={(value) => controller.setReason(value)}
      onEffectiveDate={(value) => controller.setEffectiveDate(value)} onValidateDate={() => { void controller.validateEffectiveDate(); }}
      onRefundMethod={(value) => controller.setRefundPaymentMethod(value)}
      onResolutionConfirmed={(value) => controller.setResolutionConfirmed(value)}
      onSubmit={() => { void controller.submit(); }} onClose={() => controller.abandon()} />}
    {(state.detailLoading || state.detail || state.detailError) && <DetailDialog detail={state.detail} loading={state.detailLoading}
      error={state.detailError} onClose={() => controller.closeDetail()} />}
  </section>;
}

type ViewProps = { state: ReturnType<RefinancingAnnulmentController['getSnapshot']>; controller: RefinancingAnnulmentController };
function CandidateTable({ items, state, controller, canAnnul, onBegin }: ViewProps & { items: RefinancingAnnulmentCandidate[];
  canAnnul: boolean; onBegin(candidate: RefinancingAnnulmentCandidate): void }) {
  const columns: Array<[RefinancingAnnulmentCandidateSort, string]> = [['refinancingDate', 'Fecha'], ['customer', 'Cliente'],
    ['originLoan', 'Préstamo origen'], ['successorLoan', 'Préstamo sucesor'], ['newMoneyDisbursed', 'Dinero nuevo']];
  const sort = state.sorts.CANDIDATES;
  return <div className="loan-list__table-wrap" role="region" aria-label="Refinanciamientos candidatos" tabIndex={0}><table className="loan-list__table">
    <thead><tr>{columns.map(([key, label]) => <SortHeader key={key} label={label} active={sort.sortBy === key} direction={sort.sortDir}
      onClick={() => controller.sort(key)} />)}<th scope="col">Elegibilidad</th>{canAnnul && <th scope="col">Acciones</th>}</tr></thead>
    <tbody>{items.map((item) => <tr key={item.refinancingId}><td>{formatDateOnlyForDisplay(item.refinancingDate)}</td>
      <td><strong>{item.customer.fullName}</strong><small>{item.customer.identification}</small></td><td>#{item.originLoanNumber}</td>
      <td>#{item.successorLoanNumber}</td><td className="loan-list__numeric">{formatCRCAggregate(item.newMoneyDisbursed)}</td>
      <td>{item.eligibility.eligible ? 'Elegible' : item.eligibility.reasons.map((reason) => blockerLabel[reason.code] ?? 'No elegible.').join(' ')}</td>
      {canAnnul && <td className="loan-list__actions"><TableActions actions={[{ key: 'annul', icon: 'lock', label: 'Anular',
        title: item.eligibility.eligible ? 'Anular refinanciamiento' : 'Refinanciamiento no elegible',
        ariaLabel: `Anular refinanciamiento entre los préstamos ${item.originLoanNumber} y ${item.successorLoanNumber}`,
        disabled: !item.eligibility.eligible, onClick: () => onBegin(item) }]} /></td>}</tr>)}</tbody></table></div>;
}

function AnnulledTable({ items, state, controller }: ViewProps & { items: RefinancingAnnulmentDetail[] }) {
  const columns: Array<[RefinancingAnnulledSort, string]> = [['refinancingDate', 'Fecha original'], ['effectiveDate', 'Fecha efectiva'],
    ['customer', 'Cliente'], ['originLoan', 'Préstamo origen'], ['successorLoan', 'Préstamo sucesor'],
    ['annulmentType', 'Modalidad'], ['createdBy', 'Responsable']];
  const sort = state.sorts.ANNULLED;
  return <div className="loan-list__table-wrap" role="region" aria-label="Refinanciamientos anulados" tabIndex={0}><table className="loan-list__table">
    <thead><tr>{columns.map(([key, label]) => <SortHeader key={key} label={label} active={sort.sortBy === key} direction={sort.sortDir}
      onClick={() => controller.sort(key)} />)}<th scope="col">Acciones</th></tr></thead><tbody>{items.map((item) => <tr key={item.annulmentId}>
      <td>{formatDateOnlyForDisplay(item.refinancingDate)}</td><td>{formatDateOnlyForDisplay(item.effectiveDate)}</td>
      <td><strong>{item.customer.fullName}</strong><small>{item.customer.identification}</small></td><td>#{item.originLoan.loanNumber}</td>
      <td>#{item.successorLoan.loanNumber}</td><td>{typeLabel[item.annulmentType]}</td><td>{item.createdBy.fullName}</td>
      <td className="loan-list__actions"><TableActions actions={[{ key: 'detail', icon: 'view', label: 'Ver detalle', title: 'Ver detalle',
        ariaLabel: `Ver detalle de la anulación del refinanciamiento ${item.refinancingId}`,
        onClick: () => { void controller.openDetail(item.annulmentId); } }]} /></td></tr>)}</tbody></table></div>;
}

function DetailDialog({ detail, loading, error, onClose }: { detail: RefinancingAnnulmentDetail | null; loading: boolean;
  error: string | null; onClose(): void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { dialog.current?.focus(); const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  }; document.addEventListener('keydown', keydown); return () => document.removeEventListener('keydown', keydown); }, [onClose]);
  return <div className="dialog-backdrop"><div ref={dialog} tabIndex={-1} className="dialog payment-capture-dialog" role="dialog" aria-modal="true"
    aria-labelledby="refinancing-annulment-detail-title"><header className="payment-capture-dialog__header">
      <h2 id="refinancing-annulment-detail-title">Detalle de anulación</h2></header>
    {loading && <p role="status">Cargando detalle…</p>}{error && <p className="form-error" role="alert">{error}</p>}
    {detail && <dl className="refinancing-annulment__detail"><dt>Cliente</dt><dd>{detail.customer.fullName} · {detail.customer.identification}</dd>
      <dt>Préstamos</dt><dd>#{detail.originLoan.loanNumber} → #{detail.successorLoan.loanNumber}</dd>
      <dt>Modalidad</dt><dd>{typeLabel[detail.annulmentType]}</dd><dt>Fecha original</dt><dd>{formatDateOnlyForDisplay(detail.refinancingDate)}</dd>
      <dt>Fecha efectiva</dt><dd>{formatDateOnlyForDisplay(detail.effectiveDate)}</dd><dt>Responsable</dt><dd>{detail.createdBy.fullName}</dd>
      <dt>Método de recepción</dt><dd>{detail.refundPaymentMethod?.name ?? 'No aplica'}</dd><dt>Motivo</dt><dd>{detail.reason}</dd></dl>}
    <footer className="payment-capture-dialog__footer"><button className="button button--secondary" type="button" onClick={onClose}>Cerrar</button></footer>
  </div></div>;
}
