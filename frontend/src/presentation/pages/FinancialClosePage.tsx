import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createFinancialClose } from '../../app/financial-close';
import { FinancialCloseController, type FinancialCloseState } from '../../application/use-cases/financial-close-controller';
import type { FinancialCloseDetail, FinancialCloseIssue, FinancialClosePreview, FinancialCloseSectionKey, FinancialCloseValue } from '../../domain/entities/financial-close';
import { formatCRC } from '../../shared/utils/money';
import { TableActions } from '../components/TableActions';
import { Icon } from '../components/layout/Icon';
import { useAuth } from '../hooks/auth-context';

const sections: Array<{ key: FinancialCloseSectionKey; title: string }> = [
  { key: 'liquidity', title: 'Liquidez' },
  { key: 'contractualPortfolio', title: 'Cartera contractual' },
  { key: 'economicCapital', title: 'Capital económico' },
  { key: 'refinancings', title: 'Refinanciaciones' },
  { key: 'profitability', title: 'Rentabilidad' },
  { key: 'reconciliations', title: 'Conciliaciones' },
];

const label = (value: string) => value.replace(/([a-záéíóú])([A-ZÁÉÍÓÚ])/g, '$1 $2').replaceAll('_', ' ')
  .replace(/^./, (character) => character.toUpperCase());
const display = (name: string, value: FinancialCloseValue) => {
  if (value === null) return 'No disponible';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (/(?:count|cantidad|cadenas|coincide|estado|status)/i.test(name)) return String(value);
  return formatCRC(value);
};
const timestamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

function Issues({ title, issues, severity }: { title: string; issues: FinancialCloseIssue[]; severity: 'error' | 'warning' }) {
  if (!issues.length) return null;
  return <section className={`financial-close__issues financial-close__issues--${severity}`} role={severity === 'error' ? 'alert' : 'status'}>
    <strong>{title}</strong><ul>{issues.map((issue, index) => <li key={`${issue.code ?? issue.message}-${index}`}>
      {issue.section && <span>{sections.find((section) => section.key === issue.section)?.title}: </span>}{issue.message}
    </li>)}</ul>
  </section>;
}

function Snapshot({ snapshot }: { snapshot: FinancialClosePreview }) {
  return <>
    <Issues title="Errores que impiden confirmar" issues={snapshot.errors} severity="error" />
    <Issues title="Advertencias para revisar" issues={snapshot.warnings} severity="warning" />
    <div className="financial-close__sections">
      {sections.map(({ key, title }) => {
        const section = snapshot.sections[key];
        return <section className="financial-close__section loan-list__surface" key={key} aria-labelledby={`financial-close-${key}`}>
          <header><h2 id={`financial-close-${key}`}>{title}</h2>{section.status &&
            <span className={`financial-close__status financial-close__status--${section.status.toLowerCase()}`}>{section.status}</span>}</header>
          {Object.keys(section.values).length ? <dl>{Object.entries(section.values).map(([name, value]) =>
             <div key={name}><dt>{label(name)}</dt><dd>{display(name, value)}</dd></div>)}</dl>
            : <p className="loan-list__message">Sin valores para este apartado.</p>}
        </section>;
      })}
    </div>
  </>;
}

function DetailDialog({ detail, loading, error, close }: {
  detail: FinancialCloseDetail | null; loading: boolean; error: string; close: () => void;
}) {
  if (!detail && !loading && !error) return null;
  return <div className="dialog-backdrop"><section className="dialog financial-close__dialog" role="dialog" aria-modal="true"
    aria-labelledby="financial-close-detail-title"><header><div><span className="eyebrow">REGISTRO INMUTABLE</span>
      <h2 id="financial-close-detail-title">Cierre {detail?.period ?? ''}</h2>
      {detail && <p>Confirmado {timestamp(detail.confirmedAt)}{detail.confirmedBy ? ` por ${detail.confirmedBy}` : ''}</p>}</div>
      <button className="button button--secondary" type="button" autoFocus onClick={close}>Cerrar</button></header>
    {loading && <p className="loan-list__message" role="status">Cargando cierre confirmado…</p>}
    {error && <p className="loan-list__message loan-list__message--error" role="alert">{error}</p>}
    {detail && <Snapshot snapshot={detail} />}
  </section></div>;
}

export function FinancialClosePage({ controller: supplied }: { controller?: FinancialCloseController } = {}): ReactElement {
  const [controller] = useState(() => supplied ?? createFinancialClose());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { can } = useAuth();
  useEffect(() => { void controller.load(); }, [controller]);
  return <FinancialCloseView state={state} controller={controller} canConfirm={can('financial-closes.confirm')} />;
}

export function FinancialCloseView({ state, controller, canConfirm }: {
  state: FinancialCloseState; controller: FinancialCloseController; canConfirm: boolean;
}): ReactElement {
  const blocked = Boolean(state.preview?.errors.length);
  return <section className="page-section financial-close" aria-labelledby="financial-close-title">
    <header className="loan-list__heading"><div><span className="eyebrow">FINANZAS</span>
      <h1 id="financial-close-title">Cierre financiero mensual</h1>
      <p>Revisa el cálculo del servidor y confirma una instantánea inmutable del período.</p></div>
      <button className="button button--secondary" type="button" disabled={state.loading || state.confirming}
        onClick={() => { void controller.load(); }}><Icon name="reverse" />Actualizar</button>
    </header>
    <div className="financial-close__toolbar"><label htmlFor="financial-close-period">Período
      <input id="financial-close-period" type="month" value={state.period}
        onChange={(event) => controller.setPeriod(event.target.value)} /></label>
      {canConfirm && <button className="button button--primary" type="button"
        disabled={!state.preview || blocked || state.loading || state.confirming}
        title={blocked ? 'Corrige los errores antes de confirmar.' : undefined}
        onClick={() => controller.requestConfirmation()}>{state.confirming ? 'Confirmando…' : 'Confirmar cierre'}</button>}
    </div>
    {state.loading && <p className="loan-list__message" role="status">Calculando vista previa…</p>}
    {state.error && <p className="loan-list__message loan-list__message--error" role="alert">{state.error}</p>}
    {state.success && <p className="financial-close__success" role="status">{state.success}</p>}
    {state.preview && <Snapshot snapshot={state.preview} />}
    <section className="financial-close__history loan-list__surface" aria-labelledby="financial-close-history-title">
      <header><div><span className="eyebrow">AUDITORÍA</span><h2 id="financial-close-history-title">Historial de cierres</h2></div></header>
      {!state.history.length ? <p className="loan-list__message">No hay cierres confirmados.</p> :
        <div className="loan-list__table-wrap" role="region" aria-label="Historial de cierres" tabIndex={0}><table className="loan-list__table">
          <thead><tr><th>Período</th><th>Confirmado</th><th>Responsable</th><th className="loan-list__actions">Acciones</th></tr></thead>
          <tbody>{state.history.map((item) => <tr key={item.id}><td>{item.period}</td><td>{timestamp(item.confirmedAt)}</td>
            <td>{item.confirmedBy || 'No informado'}</td><td className="loan-list__actions"><TableActions
              ariaLabel={`Acciones del cierre ${item.period}`} actions={[{ key: 'view', icon: 'view', label: 'Ver cierre',
                title: 'Ver cierre inmutable', ariaLabel: `Ver cierre inmutable de ${item.period}`,
                onClick: () => { void controller.openDetail(item.id); } }]} /></td></tr>)}</tbody>
        </table></div>}
    </section>
    {state.confirmationOpen && <div className="dialog-backdrop"><section className="dialog financial-close__confirm" role="dialog"
      aria-modal="true" aria-labelledby="financial-close-confirm-title"><h2 id="financial-close-confirm-title">Confirmar cierre de {state.period}</h2>
      <p>Esta acción guardará la versión calculada por el servidor y no podrá editarse. Las advertencias permanecerán en el registro.</p>
      <div className="financial-close__confirm-actions"><button className="button button--secondary" type="button"
        onClick={() => controller.cancelConfirmation()}>Cancelar</button><button className="button button--primary" type="button" autoFocus
        onClick={() => { void controller.confirm(); }}>Sí, confirmar cierre</button></div></section></div>}
    <DetailDialog detail={state.detail} loading={state.detailLoading} error={state.detailError} close={() => controller.closeDetail()} />
  </section>;
}
