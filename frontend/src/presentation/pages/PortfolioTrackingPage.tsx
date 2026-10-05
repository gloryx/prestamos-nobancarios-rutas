import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createPortfolioTracking } from '../../app/portfolio-tracking';
import { PortfolioTrackingController, type PortfolioTrackingState } from '../../application/use-cases/portfolio-tracking-controller';
import type { CollectionStatus, PortfolioLoanStatus } from '../../domain/entities/portfolio-tracking';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRC } from '../../shared/utils/money';
import { localDateOnly, paymentTimeline } from '../helpers/payment-plan';

const loanStatusLabels: Record<PortfolioLoanStatus, string> = {
  ACTIVE: 'Activo', UNCOLLECTIBLE: 'Incobrable',
};
const collectionStatusLabels: Record<CollectionStatus, string> = {
  ON_TRACK: 'Al día', PENDING: 'Vence hoy', OVERDUE: 'Con cuota vencida', TERM_EXPIRED: 'Plazo cumplido',
};
const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo consultar el seguimiento de cartera.';

export function PortfolioTrackingPage({ controller: supplied }: { controller?: PortfolioTrackingController } = {}): ReactElement {
  const [controller] = useState(() => supplied ?? createPortfolioTracking());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { search, status, collectionStatus } = state.filters;
  useEffect(() => {
    const timer = window.setTimeout(() => { void controller.load(); }, search.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [controller, search, status, collectionStatus, state.position]);
  useEffect(() => () => controller.dispose(), [controller]);
  return <PortfolioTrackingView state={state} controller={controller} />;
}

export function PortfolioTrackingView({ state, controller }: { state: PortfolioTrackingState; controller: PortfolioTrackingController }): ReactElement {
  const result = state.data;
  const loan = result?.loan ?? null;
  const context = loan?.context ?? null;
  const timeline = context ? paymentTimeline(context) : [];
  const today = localDateOnly();
  const empty = Boolean(result && result.total === 0);
  const position = result?.position ?? state.position;
  const total = result?.total ?? 0;

  return <section className="page-section loan-list portfolio-tracking" aria-labelledby="portfolio-tracking-title">
    <div className="loan-list__heading"><div><span className="eyebrow">PAGOS</span><h1 id="portfolio-tracking-title">Seguimiento de cartera</h1>
      <p>Consulta y recorre préstamos según su estado y situación de cobro.</p></div></div>
    <div className="loan-list__surface"><div className="loan-list__toolbar portfolio-tracking__filters">
      <label>Buscar cliente<input value={state.filters.search} placeholder="Préstamo, identificación, nombre o teléfono"
        onChange={(event) => controller.setFilter('search', event.target.value)} /></label>
       <label>Estado<select value={state.filters.status} onChange={(event) => controller.setFilter('status', event.target.value as PortfolioLoanStatus | 'ALL')}>
         <option value="ALL">Todos</option><option value="ACTIVE">Activos</option><option value="UNCOLLECTIBLE">Incobrables</option>
      </select></label>
      <label>Cobranza<select value={state.filters.collectionStatus} onChange={(event) => controller.setFilter('collectionStatus', event.target.value as CollectionStatus | 'ALL')}>
        <option value="ALL">Todos</option><option value="ON_TRACK">Al día</option><option value="PENDING">Vence hoy</option>
        <option value="OVERDUE">Con cuota vencida</option><option value="TERM_EXPIRED">Plazo cumplido</option>
      </select></label>
    </div></div>

    <nav className="portfolio-tracking__navigation" aria-label="Navegación entre préstamos">
      <button className="button button--secondary" type="button" disabled={!result?.hasPrevious || state.loading} onClick={() => controller.setPosition(1)}>« Primero</button>
      <button className="button button--secondary" type="button" disabled={!result?.hasPrevious || state.loading} onClick={() => controller.setPosition(position - 1)}>‹ Anterior</button>
      <strong>Préstamo {total ? position : 0} de {total}</strong>
      <button className="button button--secondary" type="button" disabled={!result?.hasNext || state.loading} onClick={() => controller.setPosition(position + 1)}>Siguiente ›</button>
      <button className="button button--secondary" type="button" disabled={!result?.hasNext || state.loading} onClick={() => controller.setPosition(total)}>Último »</button>
    </nav>

    {state.loading && <p role="status" className="loan-list__message">Consultando cartera…</p>}
    {Boolean(state.error) && <div role="alert" className="loan-list__message loan-list__message--error">{message(state.error)}
      <button className="button button--secondary" type="button" onClick={() => { void controller.load(); }}>Reintentar</button></div>}
    {empty && <p className="loan-list__message">No se encontraron préstamos para los criterios seleccionados.</p>}

    {!state.loading && !state.error && loan && context && <div className="portfolio-tracking__result">
      <section className="payment-selected__summary" aria-labelledby="portfolio-loan-title">
        <header className="payment-selected__header"><div><h2 id="portfolio-loan-title">{context.summary.customerName}</h2>
          <p>Préstamo #{context.summary.loanNumber}</p><small>Identificación: {context.summary.identification}</small></div>
          <div className="portfolio-tracking__badges"><span className={`status-badge ${loan.status === 'ACTIVE' ? 'status-badge--active' : 'status-badge--inactive'}`}>{loanStatusLabels[loan.status]}</span>
            <span className={`status-badge ${loan.collectionStatus === 'OVERDUE' || loan.collectionStatus === 'TERM_EXPIRED' ? 'payment-selected__overdue' : 'status-badge--active'}`}>
              {loan.collectionStatus ? collectionStatusLabels[loan.collectionStatus] : 'Sin saldo pendiente'}</span></div></header>
        <dl className="payment-selected__metrics portfolio-tracking__metrics">
          <div><dt>Fecha de alta</dt><dd>{formatDateOnlyForDisplay(loan.startDate)}</dd></div>
          <div><dt>Fecha límite contractual</dt><dd>{loan.contractualDueDate ? formatDateOnlyForDisplay(loan.contractualDueDate) : '—'}</dd></div>
          <div><dt>Capital original</dt><dd>{formatCRC(context.summary.principal)}</dd></div>
          <div><dt>Interés original</dt><dd>{formatCRC(context.summary.interestAmount)}</dd></div>
          <div><dt>Capital pendiente</dt><dd>{formatCRC(context.balances.outstandingPrincipal)}</dd></div>
          <div><dt>Interés pendiente</dt><dd>{formatCRC(context.balances.outstandingInterest)}</dd></div>
          <div><dt>Saldo pendiente</dt><dd>{formatCRC(context.balances.financialBalance)}</dd></div>
          <div><dt>Estado</dt><dd>{loanStatusLabels[loan.status]}</dd></div>
          <div><dt>Plazo</dt><dd>{loan.collectionStatus ? collectionStatusLabels[loan.collectionStatus] : 'Sin saldo pendiente'}</dd></div>
        </dl>
      </section>
      <section className="payment-selected__plan" aria-labelledby="portfolio-plan-title"><h2 id="portfolio-plan-title">Plan de pagos</h2>
        <div className="payment-selected__table-wrap" role="region" aria-label="Plan de pagos" tabIndex={0}><table className="catalog-table payment-selected__table portfolio-tracking__plan">
          <thead><tr><th scope="col">N.º</th><th scope="col">Fecha de vencimiento</th><th scope="col">Cuota</th><th scope="col">Pagado</th><th scope="col">Pendiente</th><th scope="col">Estado</th></tr></thead>
          <tbody>{timeline.map((row, index) => { const paid = row.kind === 'PAYMENT'; const overdue = !paid && row.date < today;
            return <tr key={`${row.kind}:${row.id}`}><td>{index + 1}</td><td>{formatDateOnlyForDisplay(row.date)}</td><td>{formatCRC(row.amount)}</td>
              <td>{paid ? formatCRC(row.amount) : '—'}</td><td>{paid ? '—' : formatCRC(row.amount)}</td>
              <td><span className={`status-badge ${paid ? 'status-badge--active' : overdue ? 'payment-selected__overdue' : 'payment-selected__pending'}`}>
                {paid ? 'PAGADA' : overdue ? 'VENCIDA' : 'PENDIENTE'}</span></td></tr>; })}</tbody>
        </table></div>
        {!timeline.length && <p>No hay pagos válidos ni cuotas pendientes.</p>}
      </section>
    </div>}
  </section>;
}
