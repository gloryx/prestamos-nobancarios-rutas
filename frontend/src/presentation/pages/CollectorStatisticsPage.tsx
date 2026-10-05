import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createCollectorStatistics } from '../../app/collector-statistics';
import { CollectorStatisticsController, type CollectorStatisticsState } from '../../application/use-cases/collector-statistics-controller';
import type { CollectorStatistics } from '../../domain/entities/collector-statistics';
import { costaRicaDateOnly } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';

const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const monthShort = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const integer = new Intl.NumberFormat('es-CR', { maximumFractionDigits: 0 });

const amountCents = (value: string): bigint => {
  if (!/^(?:0|[1-9]\d*)\.\d{2}$/.test(value)) return 0n;
  return BigInt(value.replace('.', ''));
};
const visualPercent = (value: string, maximum: bigint): number => maximum === 0n
  ? 0
  : Number(amountCents(value) * 10000n / maximum) / 100;

export function CollectorStatisticsPage({ controller: supplied, currentYear: suppliedCurrentYear }: {
  controller?: CollectorStatisticsController;
  currentYear?: number;
} = {}): ReactElement {
  const currentYear = suppliedCurrentYear ?? Number(costaRicaDateOnly().slice(0, 4));
  const [controller] = useState(() => supplied ?? createCollectorStatistics());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { void controller.load(); }, [controller]);
  useEffect(() => () => { if (!supplied) controller.dispose(); }, [controller, supplied]);
  const years = Array.from(new Set([state.year, ...Array.from({ length: 10 }, (_, index) => currentYear - index)]))
    .filter((year) => year <= currentYear).sort((a, b) => b - a);
  return <CollectorStatisticsView state={state} controller={controller} years={years} />;
}

function Indicator({ label, value, help, primary = false, subdued = false }: {
  label: string; value: number; help?: string; primary?: boolean; subdued?: boolean;
}): ReactElement {
  return <article className={`collector-statistics__indicator${primary ? ' collector-statistics__indicator--primary' : ''}${subdued ? ' collector-statistics__indicator--subdued' : ''}`}>
    <span>{label}</span><strong>{integer.format(value)}</strong>{help && <small title={help}>{help}</small>}
  </article>;
}

function MoneyMetric({ label, value, help, primary = false }: { label: string; value: string; help?: string; primary?: boolean }): ReactElement {
  return <article title={help} className={primary ? 'collector-statistics__money collector-statistics__money--primary' : 'collector-statistics__money'}>
    <span>{label}</span><strong>{formatCRCAggregate(value)}</strong>{help && <small>{help}</small>}
  </article>;
}

function CollectionChart({ report }: { report: CollectorStatistics }): ReactElement {
  const annual = report.period.month === null;
  const maximum = report.evolution.reduce((highest, item) => {
    const value = amountCents(item.totalCollectedAmount);
    return value > highest ? value : highest;
  }, 0n);
  const title = annual ? 'Cobros por mes' : `Cobros diarios — ${monthNames[(report.period.month ?? 1) - 1]} ${report.period.year}`;
  return <figure className={`collector-statistics__chart${annual ? '' : ' collector-statistics__chart--daily'}`}>
    <figcaption><span className="eyebrow">EVOLUCIÓN DE COBROS</span><strong>{title}</strong>
      <small>Monto de pagos válidos atribuibles a cobradores.</small></figcaption>
    <div className="collector-statistics__chart-scroll" role="region" aria-label={title} tabIndex={0}>
      <div className="collector-statistics__bars" role="img" aria-label={title}>
        {report.evolution.map((item, index) => {
          const label = annual ? monthShort[index] : String(Number(item.period.slice(-2)));
          const detail = `${annual ? monthNames[index] : `Día ${label}`}: ${formatCRCAggregate(item.totalCollectedAmount)}, ${item.validPaymentsCount} pagos válidos, ${item.uniqueCustomersServed} clientes atendidos`;
          return <div className="collector-statistics__bar" key={item.period} title={detail} aria-label={detail}>
            <span>{formatCRCAggregate(item.totalCollectedAmount)}</span><div><i style={{ height: `${visualPercent(item.totalCollectedAmount, maximum)}%` }} /></div><small>{label}</small>
          </div>;
        })}
      </div>
    </div>
  </figure>;
}

function CollectorTable({ rows }: { rows: CollectorStatistics['byCollector'] }): ReactElement {
  return <div className="loan-list__table-wrap collector-statistics__table-wrap" role="region" aria-label="Desglose de actividad por cobrador" tabIndex={0}>
    <table className="loan-list__table collector-statistics__table"><thead><tr><th>Cobrador</th><th>Pagos</th>
      <th>Clientes atendidos</th><th>Total cobrado</th><th>Capital</th><th>Interés</th><th>Promedio por pago</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.collectorId}><td><strong>{row.fullName}</strong>
        <small>{row.identification} · {row.isActive ? 'Activo' : 'Inactivo'}</small></td>
        <td>{integer.format(row.validPaymentsCount)}</td><td>{integer.format(row.uniqueCustomersServed)}</td>
        <td className="loan-list__numeric"><strong>{formatCRCAggregate(row.totalCollectedAmount)}</strong></td>
        <td className="loan-list__numeric">{formatCRCAggregate(row.principalAppliedAmount)}</td>
        <td className="loan-list__numeric">{formatCRCAggregate(row.interestAppliedAmount)}</td>
        <td className="loan-list__numeric">{formatCRCAggregate(row.averageValidPaymentAmount)}</td></tr>)}</tbody>
    </table>
  </div>;
}

function PaymentMethods({ methods }: { methods: CollectorStatistics['paymentMethods'] }): ReactElement {
  const maximum = methods.reduce((highest, method) => {
    const value = amountCents(method.totalCollectedAmount);
    return value > highest ? value : highest;
  }, 0n);
  return <div className="collector-statistics__methods">{methods.length === 0
    ? <p className="loan-list__message">No se utilizaron formas de pago durante el período.</p>
    : methods.map((method) => <article key={method.paymentMethodId}>
      <header><strong>{method.name}</strong><span>{integer.format(method.validPaymentsCount)} pagos</span></header>
      <div><i style={{ width: `${visualPercent(method.totalCollectedAmount, maximum)}%` }} /></div>
      <strong>{formatCRCAggregate(method.totalCollectedAmount)}</strong>
    </article>)}</div>;
}

function CurrentCoverage({ collectors }: { collectors: CollectorStatistics['byCollector'] }): ReactElement {
  return <section className="loan-list__surface collector-statistics__panel collector-statistics__coverage" aria-labelledby="collector-coverage-title">
    <span className="eyebrow">COBERTURA ACTUAL</span><h2 id="collector-coverage-title">Asignaciones vigentes</h2>
    <p>Las asignaciones representan la configuración actual y no reconstruyen la asignación histórica del período consultado.</p>
    <div className="collector-statistics__coverage-grid">{collectors.map((collector) => <article key={collector.collectorId}>
      <strong>{collector.fullName}</strong><span>{collector.currentActiveRoutes} rutas activas</span>
      <span>{collector.currentAssignedActiveCustomers} clientes actualmente asignados</span>
    </article>)}</div>
  </section>;
}

export function CollectorStatisticsView({ state, controller, years }: {
  state: CollectorStatisticsState;
  controller: CollectorStatisticsController;
  years: number[];
}): ReactElement {
  const report = state.statistics;
  return <section className="page-section collector-statistics" aria-labelledby="collector-statistics-title">
    <header className="loan-list__heading collector-statistics__header"><div><span className="eyebrow">COBRADORES · ESTADÍSTICAS</span>
      <h1 id="collector-statistics-title">Estadísticas de cobradores</h1>
      <p>Actividad de cobro y atención de clientes por período.</p></div>
      <div className="collector-statistics__filters"><label htmlFor="collector-statistics-year">Año<select id="collector-statistics-year"
        value={state.year} disabled={state.loading} onChange={(event) => controller.setYear(Number(event.target.value))}>
        {years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
      <label htmlFor="collector-statistics-month">Período<select id="collector-statistics-month" value={state.month ?? ''}
        disabled={state.loading} onChange={(event) => controller.setMonth(event.target.value === '' ? null : Number(event.target.value))}>
        <option value="">Todo el año</option>{monthNames.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label></div>
    </header>
    {state.loading && <p className="loan-list__message" role="status">Cargando estadísticas de cobradores…</p>}
    {state.error && <div className="loan-list__message loan-list__message--error" role="alert">{state.error}
      <button className="button button--secondary" type="button" onClick={() => { void controller.load(); }}>Reintentar</button></div>}
    {report && <>
      {report.summary.validPaymentsCount === 0 && <p className="loan-list__message">No hubo actividad de cobro válida en este período. Los indicadores se muestran en cero.</p>}
      <section aria-labelledby="collector-overview-title"><span className="eyebrow">PANORAMA GENERAL</span><h2 id="collector-overview-title">Operación del período</h2>
        <div className="collector-statistics__overview">
          <Indicator primary label="COBRADORES ACTIVOS" value={report.summary.activeCollectors} />
          <Indicator label="CON ACTIVIDAD" value={report.summary.collectorsWithValidPayments} help="Cobradores que registraron al menos un pago válido durante el período." />
          <Indicator label="ACTIVOS SIN ACTIVIDAD" value={report.summary.activeCollectorsWithoutValidPayments} help="Cobradores activos que no registraron pagos válidos durante el período." />
          <Indicator label="CLIENTES ATENDIDOS" value={report.summary.uniqueCustomersServed} help="Clientes únicos con al menos un pago válido registrado por un cobrador durante el período." />
          <Indicator subdued label="TOTAL DE COBRADORES" value={report.summary.totalCollectors} />
        </div>
      </section>
      <section className="collector-statistics__activity" aria-labelledby="collector-activity-title"><span className="eyebrow">ACTIVIDAD DE COBRO</span>
        <h2 id="collector-activity-title">Pagos válidos del período</h2><div className="collector-statistics__activity-grid">
          <article className="collector-statistics__payment-count"><span>PAGOS VÁLIDOS</span><strong>{integer.format(report.summary.validPaymentsCount)}</strong></article>
          <MoneyMetric primary label="COBRADO POR COBRADORES" value={report.summary.totalCollectedAmount}
            help="Monto de pagos válidos atribuibles a cobradores durante el período." />
          <MoneyMetric label="CAPITAL COBRADO" value={report.summary.principalAppliedAmount} />
          <MoneyMetric label="INTERÉS COBRADO" value={report.summary.interestAppliedAmount} />
          <MoneyMetric label="PROMEDIO POR PAGO" value={report.summary.averageValidPaymentAmount} />
        </div>
      </section>
      <CollectionChart report={report} />
      <section className="loan-list__surface collector-statistics__panel" aria-labelledby="collector-breakdown-title">
        <span className="eyebrow">ACTIVIDAD POR COBRADOR</span><h2 id="collector-breakdown-title">Desglose de actividad</h2>
        <p>Los cobradores sin pagos permanecen visibles. Esta tabla no representa un ranking de desempeño.</p>
        <CollectorTable rows={report.byCollector} />
      </section>
      <section className="loan-list__surface collector-statistics__panel" aria-labelledby="collector-methods-title">
        <span className="eyebrow">FORMAS DE PAGO</span><h2 id="collector-methods-title">Distribución de cobros válidos</h2>
        <PaymentMethods methods={report.paymentMethods} />
      </section>
      <div className="collector-statistics__audit-grid">
        <section className="collector-statistics__audit" aria-labelledby="collector-annulments-title"><span className="eyebrow">ANULACIONES</span>
          <h2 id="collector-annulments-title">Información de auditoría</h2><strong>{integer.format(report.summary.annulledPaymentsCount)} pagos anulados</strong>
          <span>{formatCRCAggregate(report.summary.annulledAmount)}</span><p>Se muestran aparte y no se restan nuevamente del total cobrado.</p></section>
        <section className="collector-statistics__audit" aria-labelledby="collector-integrity-title"><span className="eyebrow">INTEGRIDAD DE COBRO</span>
          <h2 id="collector-integrity-title">Pagos no atribuibles a un cobrador</h2><strong>{integer.format(report.unattributedPayments.validPaymentsCount)} pagos válidos</strong>
          <span>{formatCRCAggregate(report.unattributedPayments.totalCollectedAmount)}</span>
          <p>Pagos válidos del período que no tienen un cobrador válido asociado.</p></section>
      </div>
      <CurrentCoverage collectors={report.byCollector} />
    </>}
  </section>;
}
