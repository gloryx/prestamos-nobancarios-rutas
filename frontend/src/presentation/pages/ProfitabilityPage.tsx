import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createProfitability } from '../../app/profitability';
import { ProfitabilityController, type ProfitabilityState } from '../../application/use-cases/profitability-controller';
import type {
  EconomicCapitalSeries, ProfitabilityLoanStatus, ProfitabilityNormalRow, ProfitabilityPaymentRow, ProfitabilityRefinancingRow,
} from '../../domain/entities/profitability';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { TableActions } from '../components/TableActions';
import { Icon } from '../components/layout/Icon';
import { formatLoanStatus } from '../helpers/loan';

const money = (value: string | null): string => {
  if (value === null) return 'No disponible';
  return value.startsWith('-') ? `-${formatCRCAggregate(value.slice(1))}` : formatCRCAggregate(value);
};

function formatRatio(value: string | null, multiplier: bigint, suffix: string): string {
  if (value === null || !/^-?\d+(?:\.\d+)?$/.test(value)) return 'No disponible';
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = (BigInt(whole) * denominator + BigInt(fraction || '0')) * multiplier * 100n;
  const rounded = (numerator + denominator / 2n) / denominator;
  const formatted = `${rounded / 100n},${(rounded % 100n).toString().padStart(2, '0')}`;
  return `${negative ? '-' : ''}${formatted}${suffix}`;
}

const percent = (value: string | null) => formatRatio(value, 100n, ' %');
const rotation = (value: string | null) => formatRatio(value, 1n, 'x');
const loanStatuses: Array<{ value: ProfitabilityLoanStatus; normal: string; refinancing: string }> = [
  { value: 'ACTIVE', normal: 'Activos', refinancing: 'Cadenas activas' },
  { value: 'CANCELLED', normal: 'Cancelados', refinancing: 'Deuda final cancelada' },
  { value: 'REFINANCED', normal: 'Refinanciados', refinancing: 'Terminal refinanciada' },
  { value: 'UNCOLLECTIBLE', normal: 'Incobrables', refinancing: 'Deuda final incobrable' },
  { value: 'ANNULLED', normal: 'Anulados', refinancing: 'Deuda final anulada' },
];

export function ProfitabilityPage({ controller: supplied }: { controller?: ProfitabilityController } = {}): ReactElement {
  const [controller] = useState(() => supplied ?? createProfitability());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { void controller.load(); }, [controller]);
  useEffect(() => {
    if (!state.detail) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') controller.closeDetail(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [controller, state.detail]);
  return <ProfitabilityView state={state} controller={controller} />;
}

function IntegrityNotice({ state }: { state: ProfitabilityState }): ReactElement | null {
  const integrity = state.summary?.integridad;
  if (!integrity) return null;
  const copy = integrity.estado === 'COMPLETO'
    ? 'Datos completos para el período seleccionado.'
    : integrity.estado === 'CON_ADVERTENCIAS'
      ? 'El resultado está disponible, pero requiere revisar las advertencias.'
      : integrity.estado === 'INCONSISTENTE'
        ? 'Se detectaron inconsistencias. No uses estos datos como cierre definitivo.'
        : 'No hay información suficiente para calcular todos los indicadores.';
  return <section className={`profitability__integrity profitability__integrity--${integrity.estado.toLowerCase()}`}
    aria-label="Estado de integridad">
    <strong>{integrity.estado.replaceAll('_', ' ')}</strong><span>{copy}</span>
    {integrity.advertencias.length > 0 && <ul>{integrity.advertencias.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
  </section>;
}

function BalanceChart({ series }: { series: EconomicCapitalSeries }): ReactElement {
  const values = series.serieDiaria.map((day) => Number(day.saldoFinal));
  const finite = values.every(Number.isFinite);
  const minimum = finite && values.length ? Math.min(...values) : 0;
  const maximum = finite && values.length ? Math.max(...values) : 0;
  const span = maximum - minimum;
  const point = (value: number, index: number) => {
    const x = values.length <= 1 ? 50 : index * 100 / (values.length - 1);
    const y = span === 0 ? 50 : 92 - (value - minimum) * 84 / span;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };
  if (!values.length || !finite) return <p className="loan-list__message">No hay serie diaria disponible para este período.</p>;
  return <figure className="profitability__chart">
    <figcaption><strong>Capital trabajando durante el mes</strong><span>Saldo económico final de cada día</span></figcaption>
    <svg viewBox="0 0 100 100" role="img" aria-label="Evolución diaria del capital trabajando" preserveAspectRatio="none">
      <polyline points={values.map(point).join(' ')} vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="profitability__chart-range"><span>{formatDateOnlyForDisplay(series.fechaDesde)}</span>
      <span>{formatDateOnlyForDisplay(series.fechaHasta)}</span></div>
    <details><summary>Consultar valores diarios</summary><div className="profitability__daily-values">
      {series.serieDiaria.map((day) => <span key={day.fecha}>{formatDateOnlyForDisplay(day.fecha)}: <strong>{money(day.saldoFinal)}</strong></span>)}
    </div></details>
  </figure>;
}

function Pager({ total, page, totalPages, onPage }: { total: number; page: number; totalPages: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, totalPages);
  return <nav className="loan-list__pagination" aria-label="Páginas del detalle">
    <button className="button button--secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
    <span>Página {page} de {pages} · {total} registros</span>
    <button className="button button--secondary" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Siguiente</button>
  </nav>;
}

function NormalTable({ rows, controller }: { rows: ProfitabilityNormalRow[]; controller: ProfitabilityController }) {
  return <table className="loan-list__table"><thead><tr><th>Préstamo</th><th>Cliente</th><th>Estado</th>
    <th>Interés realizado</th><th>Pagos</th><th className="loan-list__actions">Acciones</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.loanId}><td>#{row.loanNumber}</td><td>{row.customerName}</td>
      <td><span className="status-badge">{formatLoanStatus(row.status)}</span></td>
      <td className="loan-list__numeric">{money(row.realizedInterestInPeriod)}</td><td>{row.paymentCountContributing}</td>
      <td className="loan-list__actions"><TableActions ariaLabel={`Acciones del préstamo ${row.loanNumber}`} actions={[
        { key: 'view', icon: 'view', label: 'Ver préstamo', title: 'Ver préstamo', ariaLabel: `Ver préstamo ${row.loanNumber}`,
          to: `/loans/${encodeURIComponent(row.loanId)}` },
        { key: 'payments', icon: 'payment', label: 'Ver pagos', title: 'Ver pagos que aportaron ganancia',
          ariaLabel: `Ver pagos del préstamo ${row.loanNumber}`,
          onClick: () => controller.openPayments({ source: 'NORMAL', loanId: row.loanId }, `Pagos del préstamo #${row.loanNumber}`) },
      ]} /></td></tr>)}</tbody></table>;
}

function RefinancingTable({ rows, controller }: { rows: ProfitabilityRefinancingRow[]; controller: ProfitabilityController }) {
  return <table className="loan-list__table"><thead><tr><th>Cliente</th><th>Cadena</th><th>Estado terminal</th>
    <th>Interés regular</th><th>Rendimiento capitalizado</th><th>Ganancia</th><th>Pendiente</th><th>Pagos</th>
    <th className="loan-list__actions">Acciones</th></tr></thead><tbody>{rows.map((row) => <tr key={row.rootLoanId}>
      <td>{row.customer.name}</td><td>{row.loanIds.length} préstamos</td><td><span className="status-badge">{formatLoanStatus(row.chainStatus)}</span></td>
      <td className="loan-list__numeric">{money(row.regularInterestRealizedInPeriod)}</td>
      <td className="loan-list__numeric">{money(row.capitalizedYieldRecoveredInPeriod)}</td>
      <td className="loan-list__numeric"><strong>{money(row.economicGainInPeriod)}</strong></td>
      <td className="loan-list__numeric">{money(row.capitalizedYieldPendingAtEnd)}</td><td>{row.paymentCountContributing}</td>
      <td className="loan-list__actions"><TableActions ariaLabel={`Acciones de la cadena de ${row.customer.name}`} actions={[
        { key: 'view', icon: 'view', label: 'Ver cadena', title: 'Ver cadena', ariaLabel: `Ver cadena de ${row.customer.name}`,
          to: `/loan-refinancings/chains/loan/${encodeURIComponent(row.rootLoanId)}` },
        { key: 'payments', icon: 'payment', label: 'Ver pagos', title: 'Ver pagos que aportaron ganancia',
          ariaLabel: `Ver pagos de la cadena de ${row.customer.name}`,
          onClick: () => controller.openPayments({ source: 'REFINANCING', rootLoanId: row.rootLoanId }, `Pagos de la cadena de ${row.customer.name}`) },
      ]} /></td></tr>)}</tbody></table>;
}

function PaymentsTable({ rows }: { rows: ProfitabilityPaymentRow[] }) {
  return <table className="loan-list__table"><thead><tr><th>Fecha</th><th>Evento</th><th>Cliente</th><th>Préstamo</th>
    <th>Monto pagado</th><th>Principal contractual</th><th>Capital económico</th><th>Interés</th>
    <th>Rendimiento capitalizado</th><th>Aporte a ganancia</th></tr></thead><tbody>{rows.map((row) =>
      <tr key={`${row.eventType}-${row.paymentId}-${row.paymentDate}`}><td>{formatDateOnlyForDisplay(row.paymentDate)}</td>
        <td>{row.eventType === 'PAYMENT' ? 'Pago' : 'Reverso'}</td><td>{row.customerName}</td><td>#{row.loanNumber}</td>
        <td className="loan-list__numeric">{money(row.paymentAmount)}</td>
        <td className="loan-list__numeric">{money(row.principalAppliedContractual)}</td>
        <td className="loan-list__numeric">{money(row.economicPrincipalRecovered)}</td>
        <td className="loan-list__numeric">{money(row.interestApplied)}</td>
        <td className="loan-list__numeric">{money(row.capitalizedYieldRecovered)}</td>
        <td className="loan-list__numeric"><strong>{money(row.economicGainContribution)}</strong></td></tr>)}</tbody></table>;
}

function DetailSummary({ state }: { state: ProfitabilityState }): ReactElement | null {
  const detail = state.detail;
  if (!detail || detail.kind === 'payments' || !detail.data) return null;
  const summary = detail.data.summary;
  if (detail.kind === 'normal') {
    const realizedInterest = summary && 'realizedInterest' in summary ? summary.realizedInterest : null;
    return <section className="profitability__detail-summary" aria-label="Resumen del conjunto filtrado">
      <div className="profitability__detail-summary-primary"><span>GANANCIA DEL CONJUNTO</span><strong>{money(realizedInterest)}</strong></div>
      <div><span>REGISTROS</span><strong>{detail.data.total}</strong></div>
    </section>;
  }
  const refinancing = summary && 'economicGain' in summary ? summary : null;
  return <section className="profitability__detail-summary" aria-label="Resumen del conjunto filtrado">
    <div className="profitability__detail-summary-primary"><span>GANANCIA ECONÓMICA</span><strong>{money(refinancing?.economicGain ?? null)}</strong></div>
    <div><span>REGISTROS</span><strong>{detail.data.total}</strong></div>
    <div><span>INTERÉS REGULAR</span><strong>{money(refinancing?.regularInterestRealized ?? null)}</strong></div>
    <div><span>RENDIMIENTO CAPITALIZADO RECUPERADO</span><strong>{money(refinancing?.capitalizedYieldRecovered ?? null)}</strong></div>
  </section>;
}

function DetailDialog({ state, controller }: { state: ProfitabilityState; controller: ProfitabilityController }): ReactElement | null {
  const detail = state.detail;
  if (!detail) return null;
  const rows = detail.data?.items ?? [];
  return <div className="dialog-backdrop"><section className="dialog profitability__dialog" role="dialog" aria-modal="true"
    aria-labelledby="profitability-detail-title"><header><div><span className="eyebrow">DETALLE AUDITABLE</span>
      <h2 id="profitability-detail-title">{detail.title}</h2><p>Período {state.period}</p></div>
      <button className="button button--secondary" type="button" autoFocus onClick={() => controller.closeDetail()}>Cerrar</button></header>
    {detail.kind !== 'payments' && <div className="profitability__detail-filter">
      <label htmlFor="profitability-detail-status">{detail.kind === 'normal' ? 'Estado' : 'Estado de la cadena'}
        <select id="profitability-detail-status"
          value={detail.kind === 'normal' ? detail.filters.status ?? '' : detail.filters.terminalStatus ?? ''}
          onChange={(event) => controller.setDetailStatus(event.target.value as ProfitabilityLoanStatus | '')}>
          <option value="">{detail.kind === 'normal' ? 'Todos' : 'Todas las cadenas'}</option>
          {loanStatuses.map((status) => <option key={status.value} value={status.value}>
            {detail.kind === 'normal' ? status.normal : status.refinancing}</option>)}
        </select></label>
    </div>}
    <DetailSummary state={state} />
    {detail.loading && <p className="loan-list__message" role="status">Cargando detalle…</p>}
    {detail.error && <div className="loan-list__message loan-list__message--error" role="alert">{detail.error}
      <button className="button button--secondary" type="button" onClick={() => controller.retryDetail()}>Reintentar</button></div>}
    {!detail.loading && !detail.error && detail.data && !rows.length && <p className="loan-list__message">No hay registros para este filtro.</p>}
    {!detail.error && rows.length > 0 && <div className="loan-list__table-wrap" role="region" aria-label={detail.title} tabIndex={0}>
      {detail.kind === 'normal' && <NormalTable rows={rows as ProfitabilityNormalRow[]} controller={controller} />}
      {detail.kind === 'refinancings' && <RefinancingTable rows={rows as ProfitabilityRefinancingRow[]} controller={controller} />}
      {detail.kind === 'payments' && <PaymentsTable rows={rows as ProfitabilityPaymentRow[]} />}
    </div>}
    {detail.data && <Pager {...detail.data} onPage={(page) => controller.setDetailPage(page)} />}
  </section></div>;
}

export function ProfitabilityView({ state, controller }: { state: ProfitabilityState; controller: ProfitabilityController }): ReactElement {
  const summary = state.summary;
  return <section className="page-section profitability" aria-labelledby="profitability-title">
    <header className="loan-list__heading"><div><span className="eyebrow">FINANZAS · REPORTES</span>
      <h1 id="profitability-title">Rentabilidad integral</h1>
      <p>Ganancia realizada, capital económico y rotación mensual.</p></div>
      <button className="button button--secondary" type="button" aria-busy={state.refreshing}
        disabled={state.loading || state.refreshing} onClick={() => { void controller.load(); }}><Icon name="reverse" />Actualizar</button>
    </header>
    <div className="profitability__period"><label htmlFor="profitability-period">Período
      <input id="profitability-period" type="month" value={state.period} onChange={(event) => controller.setPeriod(event.target.value)} /></label>
      {summary && <span>{formatDateOnlyForDisplay(summary.fechaDesde)} al {formatDateOnlyForDisplay(summary.fechaHasta)}</span>}
    </div>
    {state.loading && <p className="loan-list__message" role="status">Cargando rentabilidad integral…</p>}
    {state.refreshing && <p className="loan-list__message" role="status">Actualizando rentabilidad integral…</p>}
    {state.error && <div className="loan-list__message loan-list__message--error" role="alert">{state.error}
      <button className="button button--secondary" type="button" onClick={() => { void controller.load(); }}>Reintentar</button></div>}
    {summary && <>
      <IntegrityNotice state={state} />
      <button className="profitability__hero" type="button" onClick={() => controller.openPayments()}>
        <span>GANANCIA REALIZADA DEL PERÍODO</span><strong>{money(summary.ganancia.total)}</strong>
        <small>Ver pagos que aportaron a la ganancia</small>
      </button>
      <section className="profitability__origins" aria-label="Origen de la ganancia">
        <button type="button" onClick={() => controller.openNormal()}><span>PRÉSTAMOS NORMALES</span>
          <strong>{money(summary.ganancia.normal)}</strong><small>Ver préstamos y pagos</small></button>
        <button type="button" onClick={() => controller.openRefinancings()}><span>REFINANCIAMIENTOS</span>
          <strong>{money(summary.ganancia.refinanciamientos)}</strong>
          <small>Interés regular {money(summary.ganancia.interesRegularRefinanciamientos)} · Rendimiento capitalizado {money(summary.ganancia.rendimientoCapitalizadoRecuperado)}</small></button>
      </section>
      <section className="profitability__indicators" aria-label="Indicadores de rentabilidad">
        <div><span>RENTABILIDAD DEL PERÍODO</span><strong>{percent(summary.indicadores.rentabilidadPeriodo)}</strong></div>
        <div><span>TASA EQUIVALENTE A 30 DÍAS</span><strong>{percent(summary.indicadores.tasaEquivalente30Dias)}</strong></div>
        <div><span>ROTACIÓN DEL CAPITAL</span><strong>{rotation(summary.indicadores.rotacionCapital)}</strong></div>
      </section>
      <section className="profitability__capital loan-list__surface" aria-labelledby="profitability-capital-title">
        <div><span className="eyebrow">CAPITAL ECONÓMICO</span><h2 id="profitability-capital-title">Capital trabajando</h2></div>
        <dl><div><dt>Capital promedio trabajando</dt><dd>{money(summary.capital.capitalPromedioTrabajando)}</dd></div>
          <div><dt>Saldo inicial</dt><dd>{money(summary.capital.saldoEconomicoInicial)}</dd></div>
          <div><dt>Desembolsado real</dt><dd>{money(summary.capital.desembolsadoRealPeriodo)}</dd></div>
          <div><dt>Recuperado económico</dt><dd>{money(summary.capital.recuperadoEconomicoPeriodo)}</dd></div>
          <div><dt>Saldo final</dt><dd>{money(summary.capital.saldoEconomicoFinal)}</dd></div>
          <div><dt>Capital-días</dt><dd>{money(summary.capital.capitalDays)}</dd></div></dl>
      </section>
      <section className="profitability__chart-section loan-list__surface" aria-label="Serie diaria de capital">
        {state.capitalSeries && <BalanceChart series={state.capitalSeries} />}
        {state.seriesError && <p className="loan-list__message">La serie diaria no está disponible: {state.seriesError}</p>}
      </section>
      <details className="profitability__explanation"><summary>Cómo leer este reporte</summary>
        <p>La ganancia realizada reconoce interés y rendimiento capitalizado recuperado por pagos durante el período. La rotación compara el capital económico recuperado con el capital promedio trabajando. Los indicadores se presentan exactamente como los calcula el backend.</p>
      </details>
    </>}
    <DetailDialog state={state} controller={controller} />
  </section>;
}
