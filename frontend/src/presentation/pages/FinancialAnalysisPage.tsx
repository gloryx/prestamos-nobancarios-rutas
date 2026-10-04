import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createCustomerFinancialAnalysis } from '../../app/customer-financial-analysis';
import { CustomerFinancialAnalysisController, type CustomerFinancialAnalysisState } from '../../application/use-cases/customer-financial-analysis-controller';
import type { CustomerListItem } from '../../domain/entities/customer';
import type { CustomerFinancialAnalysis, CustomerFinancialIntegrity } from '../../domain/entities/customer-financial-analysis';
import { costaRicaDateOnly, formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { CustomerSelectionModal } from '../components/CustomerSelectionModal';
import { customerFinancialAnalysisPath } from '../helpers/table-action-definitions';
import { useAuth } from '../hooks/auth-context';

const money = (value: string | null): string => {
  if (value === null || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return 'No disponible';
  return value.startsWith('-') ? `-${formatCRCAggregate(value.slice(1))}` : formatCRCAggregate(value);
};

const percent = (value: string | null): string => {
  if (value === null || !/^-?\d+(?:\.\d+)?$/.test(value)) return 'No disponible';
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const scaled = (BigInt(whole) * denominator + BigInt(fraction || '0')) * 10_000n;
  const rounded = (scaled + denominator / 2n) / denominator;
  return `${negative ? '-' : ''}${rounded / 100n},${(rounded % 100n).toString().padStart(2, '0')} %`;
};

const statusCount = (analysis: CustomerFinancialAnalysis, status: string): number => analysis.historial.prestamosPorEstado[status] ?? 0;

export function FinancialAnalysisPage({ controller: supplied }: { controller?: CustomerFinancialAnalysisController } = {}): ReactElement {
  const { customerId } = useParams<{ customerId: string }>();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const effectiveCustomerId = customerId ?? supplied?.getSnapshot().customerId;
  const asOf = searchParams.get('asOf') || supplied?.getSnapshot().asOf || costaRicaDateOnly();
  const canListCustomers = can('customers.view');
  const [customerSelectionOpen, setCustomerSelectionOpen] = useState(!effectiveCustomerId);
  const previousCustomerId = useRef(effectiveCustomerId);
  useEffect(() => {
    if (previousCustomerId.current === effectiveCustomerId) return;
    previousCustomerId.current = effectiveCustomerId;
    setCustomerSelectionOpen(!effectiveCustomerId);
  }, [effectiveCustomerId]);
  const selectCustomer = (customer: CustomerListItem) => {
    setCustomerSelectionOpen(false);
    navigate(customerFinancialAnalysisPath(customer.id, asOf));
  };
  const changeAsOf = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('asOf', value);
    setSearchParams(next, { replace: true });
  };
  return <>
    {effectiveCustomerId
      ? <FinancialAnalysisReport key={supplied ? 'supplied' : effectiveCustomerId} supplied={supplied}
        customerId={effectiveCustomerId} initialAsOf={asOf} canChangeCustomer={canListCustomers}
        onChangeCustomer={() => setCustomerSelectionOpen(true)} onAsOfChange={changeAsOf} />
      : <FinancialAnalysisLanding canListCustomers={canListCustomers} onSelectCustomer={() => setCustomerSelectionOpen(true)} />}
    {customerSelectionOpen && <CustomerSelectionModal canListCustomers={canListCustomers}
      onClose={() => setCustomerSelectionOpen(false)} onSelect={selectCustomer} />}
  </>;
}

export function FinancialAnalysisReport({ supplied, customerId, initialAsOf, canChangeCustomer, onChangeCustomer, onAsOfChange }: {
  supplied?: CustomerFinancialAnalysisController;
  customerId: string;
  initialAsOf: string;
  canChangeCustomer: boolean;
  onChangeCustomer: () => void;
  onAsOfChange: (value: string) => void;
}): ReactElement {
  const [stableController] = useState(() => supplied ?? createCustomerFinancialAnalysis(customerId, initialAsOf));
  const state = useSyncExternalStore(stableController.subscribe, stableController.getSnapshot, stableController.getSnapshot);
  useEffect(() => { void stableController.load(); }, [stableController]);
  useEffect(() => {
    if (state.asOf !== initialAsOf) stableController.setAsOf(initialAsOf);
  }, [initialAsOf, stableController, state.asOf]);
  return <FinancialAnalysisView state={state} controller={stableController} canChangeCustomer={canChangeCustomer}
    onChangeCustomer={onChangeCustomer} onAsOfChange={onAsOfChange} />;
}

export function FinancialAnalysisLanding({ canListCustomers, onSelectCustomer }: {
  canListCustomers: boolean;
  onSelectCustomer: () => void;
}): ReactElement {
  return <section className="page-section customer-financial-analysis customer-financial-analysis--landing" aria-labelledby="customer-financial-title">
    <span className="eyebrow">CLIENTES · ANÁLISIS</span>
    <h1 id="customer-financial-title">Análisis financiero del cliente</h1>
    <p>Seleccione un cliente para consultar su análisis financiero.</p>
    <button className="button button--primary" type="button" disabled={!canListCustomers} onClick={onSelectCustomer}>Seleccionar cliente</button>
    {!canListCustomers && <div className="loan-list__message">Necesitás acceso al listado de clientes para iniciar una consulta desde esta pantalla.</div>}
  </section>;
}

function IntegrityNotice({ status, warnings }: { status: CustomerFinancialIntegrity; warnings: string[] }): ReactElement {
  const copy = status === 'COMPLETO'
    ? 'La reconstrucción financiera está completa para la fecha seleccionada.'
    : status === 'CON_ADVERTENCIAS'
      ? 'El análisis está disponible, pero contiene observaciones que conviene revisar.'
      : status === 'INCONSISTENTE'
        ? 'Se detectaron inconsistencias. No uses estas cifras como conclusión definitiva.'
        : 'No existe información suficiente para presentar todos los indicadores.';
  return <section className={`customer-financial-analysis__integrity customer-financial-analysis__integrity--${status.toLowerCase()}`}
    aria-label="Estado de integridad">
    <div><strong>{status.replaceAll('_', ' ')}</strong><span>{copy}</span></div>
    {warnings.length > 0 && <details><summary>Consultar advertencias ({warnings.length})</summary>
      <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
  </section>;
}

function Metric({ label, value, detail, emphasis = false }: {
  label: string;
  value: string;
  detail?: ReactElement | string;
  emphasis?: boolean;
}): ReactElement {
  return <article className={`customer-financial-analysis__metric${emphasis ? ' customer-financial-analysis__metric--emphasis' : ''}`}>
    <span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}
  </article>;
}

function Definition({ label, value, help }: { label: string; value: string; help?: string }): ReactElement {
  return <div><dt>{label}</dt><dd>{value}</dd>{help && <small className="customer-financial-analysis__help">{help}</small>}</div>;
}

export function FinancialAnalysisView({ state, controller, canChangeCustomer, onChangeCustomer = () => undefined,
  onAsOfChange = () => undefined }: {
  state: CustomerFinancialAnalysisState;
  controller: CustomerFinancialAnalysisController;
  canChangeCustomer: boolean;
  onChangeCustomer?: () => void;
  onAsOfChange?: (value: string) => void;
}): ReactElement {
  const analysis = state.analysis;
  return <section className="page-section customer-financial-analysis" aria-labelledby="customer-financial-title">
    <header className="customer-financial-analysis__header">
      <div><span className="eyebrow">CLIENTES · ANÁLISIS</span><h1 id="customer-financial-title">Análisis financiero del cliente</h1>
        {analysis && <div className="customer-financial-analysis__identity"><strong>{analysis.cliente.nombreCompleto}</strong>
          <span>Identificación {analysis.cliente.identificacion}</span></div>}</div>
      <div className="customer-financial-analysis__change-customer">
        <button className="button button--secondary" type="button" disabled={!canChangeCustomer} onClick={onChangeCustomer}>Cambiar cliente</button>
        {!canChangeCustomer && <small>Se requiere permiso para consultar clientes.</small>}
      </div>
    </header>
    <div className="customer-financial-analysis__cutoff"><label htmlFor="customer-financial-as-of">Fecha de corte
      <input id="customer-financial-as-of" type="date" value={state.asOf} max={costaRicaDateOnly()}
        onChange={(event) => { onAsOfChange(event.target.value); controller.setAsOf(event.target.value); }} /></label>
      <p>Los indicadores reflejan la situación financiera hasta esta fecha.</p></div>
    {state.loading && <div className="loan-list__message" role="status">Cargando análisis financiero…</div>}
    {state.error && <div className="loan-list__message loan-list__message--error" role="alert">{state.error}
      <button className="button button--secondary" type="button" disabled={state.loading} onClick={() => { void controller.load(); }}>Reintentar</button></div>}
    {analysis && <>
      <IntegrityNotice status={analysis.integridad.estado} warnings={analysis.integridad.advertencias} />
      <section className="customer-financial-analysis__summary" aria-label="Resumen financiero principal">
        <Metric label="DINERO REAL ENTREGADO" value={money(analysis.flujoCaja.capitalRealDesembolsado)} />
        <Metric label="TOTAL RECIBIDO DEL CLIENTE" value={money(analysis.flujoCaja.pagosRecibidos)} />
        <Metric label="GANANCIA COBRADA" value={money(analysis.gananciaRealizada.total)} emphasis detail={<>
          Interés cobrado {money(analysis.gananciaRealizada.interesRegular)}<br />
          Ganancia anterior recuperada {money(analysis.gananciaRealizada.rendimientoCapitalizadoRecuperado)}
        </>} />
        <Metric label="CAPITAL REAL PENDIENTE DE RECUPERAR" value={money(analysis.capitalEconomico.pendiente)} />
      </section>
      <div className="customer-financial-analysis__columns">
        <section className="loan-list__surface customer-financial-analysis__panel" aria-labelledby="customer-financial-current">
          <span className="eyebrow">EXPOSICIÓN</span><h2 id="customer-financial-current">Situación actual</h2>
          <dl><Definition label="Capital real pendiente de recuperar" value={money(analysis.capitalEconomico.pendiente)}
            help="Efectivo real del negocio que aún no ha sido recuperado." />
          <Definition label="Ganancia anterior pendiente de recuperar" value={money(analysis.rendimientoCapitalizado.pendiente)}
            help="Rendimiento trasladado a una refinanciación que todavía no se ha recuperado." />
          <Definition label="Saldo contractual pendiente" value={money(analysis.exposicionContractual.saldoTotal)}
            help="Saldo del contrato vigente; puede incluir capital económico, rendimiento capitalizado e interés contractual." />
          <Definition label="Principal contractual pendiente" value={money(analysis.exposicionContractual.principalPendiente)} />
          <Definition label="Interés contractual pendiente" value={money(analysis.exposicionContractual.interesPendiente)} /></dl>
        </section>
        <section className="loan-list__surface customer-financial-analysis__panel" aria-labelledby="customer-financial-profitability">
          <span className="eyebrow">DESEMPEÑO HISTÓRICO</span><h2 id="customer-financial-profitability">Rentabilidad del cliente</h2>
          <div className="customer-financial-analysis__returns">
            <Metric label="RETORNO ACUMULADO" value={percent(analysis.profitability.cumulativeReturnRate)}
              detail="Ganancia cobrada respecto a todo el dinero real entregado al cliente." />
            <Metric label="RENTABILIDAD EQUIVALENTE A 30 DÍAS" value={percent(analysis.indicadores.tasaEquivalente30Dias)}
              detail="Rendimiento considerando cuánto capital estuvo invertido y durante cuánto tiempo, expresado sobre una base de 30 días calendario." />
          </div>
          <dl className="customer-financial-analysis__profitability-secondary">
            <Definition label="Capital promedio invertido" value={money(analysis.capitalEconomico.capitalPromedioTrabajando)} />
            <Definition label="Rendimiento sobre capital promedio del período" value={percent(analysis.indicadores.rentabilidadHistorica)}
              help="Relaciona la ganancia realizada con el capital económico promedio mantenido durante el período analizado. No representa el retorno acumulado sobre todo el dinero entregado." />
            <Definition label="Capital × días" value={money(analysis.capitalEconomico.capitalDays)} />
          </dl>
        </section>
      </div>
      <section className="loan-list__surface customer-financial-analysis__history" aria-labelledby="customer-financial-history">
        <div><span className="eyebrow">RELACIÓN HISTÓRICA</span><h2 id="customer-financial-history">Historial del cliente</h2>
          <p>{analysis.historial.fechaPrimerCapitalDesplegado
            ? `Primera operación: ${formatDateOnlyForDisplay(analysis.historial.fechaPrimerCapitalDesplegado)}`
            : 'Primera operación: No disponible'}</p></div>
        <dl><Definition label="Total préstamos" value={String(analysis.historial.cantidadPrestamos)} />
          <Definition label="Activos" value={String(statusCount(analysis, 'ACTIVE'))} />
          <Definition label="Cancelados" value={String(statusCount(analysis, 'CANCELLED'))} />
          <Definition label="Refinanciados" value={String(statusCount(analysis, 'REFINANCED'))} />
          <Definition label="Incobrables" value={String(statusCount(analysis, 'UNCOLLECTIBLE'))} />
          <Definition label="Anulados" value={String(statusCount(analysis, 'ANNULLED'))} /></dl>
      </section>
      <section className="loan-list__surface customer-financial-analysis__loans" aria-labelledby="customer-financial-loans">
        <span className="eyebrow">DETALLE</span><h2 id="customer-financial-loans">Préstamos del cliente</h2>
        <p className="loan-list__message">El contrato actual ofrece totales y conteos autoritativos, pero no detalle financiero por préstamo para esta fecha de corte.</p>
      </section>
    </>}
  </section>;
}
