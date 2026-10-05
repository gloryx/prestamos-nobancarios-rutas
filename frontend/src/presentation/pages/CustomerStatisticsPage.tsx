import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createCustomerStatistics } from '../../app/customer-statistics';
import { CustomerStatisticsController, type CustomerStatisticsState } from '../../application/use-cases/customer-statistics-controller';
import type { CustomerStatistics } from '../../domain/entities/customer-statistics';
import { costaRicaDateOnly } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';

const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const integer = new Intl.NumberFormat('es-CR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('es-CR', { maximumFractionDigits: 2 });
const topCriteria = [
  { key: 'capitalDisbursed', label: 'Mayor capital prestado', monetary: true },
  { key: 'loansPlaced', label: 'Más préstamos', monetary: false },
  { key: 'realizedGain', label: 'Mayor ganancia', monetary: true },
  { key: 'recoveredPrincipal', label: 'Mayor capital recuperado', monetary: true },
  { key: 'currentBalance', label: 'Mayor saldo actual', monetary: true },
] as const;
export type CustomerTopCriterion = (typeof topCriteria)[number]['key'];

export function CustomerStatisticsPage({ controller: supplied, currentYear: suppliedCurrentYear }: {
  controller?: CustomerStatisticsController;
  currentYear?: number;
} = {}): ReactElement {
  const currentYear = suppliedCurrentYear ?? Number(costaRicaDateOnly().slice(0, 4));
  const [controller] = useState(() => supplied ?? createCustomerStatistics());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { void controller.load(); }, [controller]);
  useEffect(() => () => { if (!supplied) controller.dispose(); }, [controller, supplied]);
  const years = Array.from(new Set([state.year, ...Array.from({ length: 10 }, (_, index) => currentYear - index)]))
    .filter((year) => year <= currentYear).sort((a, b) => b - a);
  return <CustomerStatisticsView state={state} controller={controller} years={years} />;
}

function Indicator({ label, value, help, primary = false }: {
  label: string; value: number; help?: string; primary?: boolean;
}): ReactElement {
  return <article className={`customer-statistics__indicator${primary ? ' customer-statistics__indicator--primary' : ''}`}>
    <span>{label}</span><strong>{integer.format(value)}</strong>{help && <small>{help}</small>}
  </article>;
}

const situationEntries = (situation: CustomerStatistics['currentSituation']) => [
  { key: 'active', label: 'Con deuda activa', value: situation.activeDebt, color: '#1769aa' },
  { key: 'uncollectible', label: 'Incobrable sin deuda activa', value: situation.uncollectibleOnly, color: '#b56a20' },
  { key: 'clear', label: 'Sin deuda vigente', value: situation.noCurrentDebt, color: '#4e8b67' },
];

function CurrentSituationChart({ situation }: { situation: CustomerStatistics['currentSituation'] }): ReactElement {
  const entries = situationEntries(situation);
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const percentages = entries.map((entry) => total === 0 ? 0 : entry.value * 100 / total);
  const first = percentages[0];
  const second = first + percentages[1];
  const background = total === 0 ? '#e8edf3'
    : `conic-gradient(${entries[0].color} 0 ${first}%, ${entries[1].color} ${first}% ${second}%, ${entries[2].color} ${second}% 100%)`;
  return <div className="customer-statistics__situation-layout">
    <div className="customer-statistics__donut" role="img" aria-label="Distribución de la situación actual de los clientes"
      style={{ background }}><div><strong>{integer.format(total)}</strong><span>clientes</span></div></div>
    <div className="customer-statistics__legend">{entries.map((entry, index) => <div key={entry.key}>
      <i style={{ backgroundColor: entry.color }} /><span>{entry.label}</span><strong>{integer.format(entry.value)}</strong>
      <small>{total === 0 ? '0' : decimal.format(percentages[index])} %</small>
    </div>)}</div>
  </div>;
}

function MonthlyCustomersChart({ series }: { series: CustomerStatistics['monthlyNewCustomers'] }): ReactElement {
  const maximum = Math.max(1, ...series.map((item) => item.newCustomers));
  return <figure className="customer-statistics__monthly-chart">
    <figcaption><span className="eyebrow">NUEVOS CLIENTES POR MES</span>
      <strong>Registro mensual de clientes</strong></figcaption>
    <div className="customer-statistics__bars" role="img" aria-label="Nuevos clientes registrados por mes">
      {series.map((item) => <div className="customer-statistics__bar-column" key={item.month}>
        <span>{integer.format(item.newCustomers)}</span>
        <div><i style={{ height: `${item.newCustomers * 100 / maximum}%` }} /></div>
        <small>{months[item.month - 1] ?? String(item.month)}</small>
      </div>)}
    </div>
  </figure>;
}

export function TopCustomersRanking({ rankings, criterion, limit, onSelect = () => undefined }: {
  rankings: CustomerStatistics['topCustomers']; criterion: CustomerTopCriterion; limit: number;
  onSelect?: (criterion: CustomerTopCriterion) => void;
}): ReactElement {
  const selected = topCriteria.find((item) => item.key === criterion) ?? topCriteria[0];
  const ranking = rankings[selected.key];
  const maximum = Math.max(0, ...ranking.map((item) => Number(item.value)));
  return <>
    <div className="customer-statistics__top-tabs" role="tablist" aria-label="Criterio del top de clientes">
      {topCriteria.map((item) => <button key={item.key} type="button" role="tab"
        aria-selected={item.key === selected.key} onClick={() => onSelect(item.key)}>{item.label}</button>)}
    </div>
    <strong className="customer-statistics__top-heading" aria-live="polite">TOP {limit} · {selected.label}</strong>
    {ranking.length === 0 ? <p className="customer-statistics__top-empty">No hay información disponible para este indicador.</p>
      : <ol className="customer-statistics__top-list" aria-label={`Top ${limit}: ${selected.label}`}>
        {ranking.map((item, index) => { const numericValue = Number(item.value); return <li key={item.customerId}>
          <strong className="customer-statistics__top-position">{index + 1}</strong>
          <div><span>{item.fullName}</span><i><b style={{ width: `${maximum > 0 ? numericValue * 100 / maximum : 0}%` }} /></i></div>
          <strong className="customer-statistics__top-value">{selected.monetary ? formatCRCAggregate(String(item.value)) : integer.format(numericValue)}</strong>
        </li>; })}
      </ol>}
  </>;
}

export function CustomerStatisticsView({ state, controller, years }: {
  state: CustomerStatisticsState;
  controller: CustomerStatisticsController;
  years: number[];
}): ReactElement {
  const report = state.statistics;
  const [topCriterion, setTopCriterion] = useState<CustomerTopCriterion>('capitalDisbursed');
  const [topLimitInput, setTopLimitInput] = useState(String(state.limit));
  useEffect(() => { setTopLimitInput(String(state.limit)); }, [state.limit]);
  const commitTopLimit = (value: string) => {
    const limit = Number(value);
    if (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(limit)) controller.setLimit(limit);
    else setTopLimitInput(String(state.limit));
  };
  return <section className="page-section customer-statistics" aria-labelledby="customer-statistics-title">
    <header className="loan-list__heading customer-statistics__header"><div><span className="eyebrow">CLIENTES · ESTADÍSTICAS</span>
      <h1 id="customer-statistics-title">Estadísticas de clientes</h1>
      <p>Panorama general y comportamiento de la base de clientes.</p></div>
      <label htmlFor="customer-statistics-year">Año<select id="customer-statistics-year" value={state.year}
        disabled={state.loading} onChange={(event) => controller.setYear(Number(event.target.value))}>
        {years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
    </header>
    {state.loading && <p className="loan-list__message" role="status">Cargando estadísticas de clientes…</p>}
    {state.error && <div className="loan-list__message loan-list__message--error" role="alert">{state.error}
      <button className="button button--secondary" type="button" onClick={() => { void controller.load(); }}>Reintentar</button></div>}
    {report && <>
      {report.summary.totalCustomers === 0 && <p className="loan-list__message">No hay clientes registrados. Los indicadores se muestran en cero.</p>}
      <section aria-labelledby="customer-statistics-overview"><span className="eyebrow">PANORAMA GENERAL</span>
        <h2 id="customer-statistics-overview">Base actual de clientes</h2>
        <div className="customer-statistics__overview">
          <Indicator primary label="TOTAL DE CLIENTES" value={report.summary.totalCustomers} />
          <Indicator label="CON DEUDA ACTIVA" value={report.summary.customersWithActiveDebt}
            help="Clientes que actualmente tienen al menos un préstamo activo." />
          <Indicator label="SIN DEUDA VIGENTE" value={report.summary.customersWithoutCurrentDebt}
            help="Clientes que actualmente no tienen préstamos activos ni exposición incobrable." />
          <Indicator label="CLIENTES CON INCOBRABLES" value={report.summary.customersWithUncollectibleDebt}
            help="Clientes que tienen al menos un préstamo clasificado como incobrable; también pueden tener deuda activa." />
        </div>
      </section>
      <section className="loan-list__surface customer-statistics__panel" aria-labelledby="customer-statistics-situation">
        <span className="eyebrow">SITUACIÓN ACTUAL DE LOS CLIENTES</span><h2 id="customer-statistics-situation">Distribución actual</h2>
        <p>Incobrable sin deuda activa identifica sólo clientes sin préstamos activos que sí conservan exposición incobrable.</p>
        <CurrentSituationChart situation={report.currentSituation} />
      </section>
      <section className="customer-statistics__growth" aria-labelledby="customer-statistics-growth">
        <span className="eyebrow">CRECIMIENTO DE CLIENTES</span><h2 id="customer-statistics-growth">Nuevos registros</h2>
        <div className="customer-statistics__growth-cards">
          <article><span>NUEVOS CLIENTES EN {report.year}</span><strong>{integer.format(report.summary.newCustomersInYear)}</strong></article>
          <article><span>NUEVOS ESTE MES</span><strong>{report.summary.newCustomersCurrentMonth === null
            ? 'No aplica' : integer.format(report.summary.newCustomersCurrentMonth)}</strong></article>
        </div>
        <MonthlyCustomersChart series={report.monthlyNewCustomers} />
      </section>
      <section className="loan-list__surface customer-statistics__panel customer-statistics__top" aria-labelledby="customer-statistics-top">
        <span className="eyebrow">ANÁLISIS DE CLIENTES</span><h2 id="customer-statistics-top">Top de clientes</h2>
        <p>Compara los clientes con mayor valor en el indicador seleccionado.</p>
        <label className="customer-statistics__top-limit" htmlFor="customer-statistics-top-limit">Cantidad de clientes
          <input id="customer-statistics-top-limit" type="number" min="1" step="1" inputMode="numeric"
            value={topLimitInput} onChange={(event) => setTopLimitInput(event.target.value)}
            onBlur={(event) => commitTopLimit(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { commitTopLimit(event.currentTarget.value); event.currentTarget.blur(); } }} />
        </label>
        <TopCustomersRanking rankings={report.topCustomers} criterion={topCriterion} limit={state.limit} onSelect={setTopCriterion} />
      </section>
    </>}
  </section>;
}
