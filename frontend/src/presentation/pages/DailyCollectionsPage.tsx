import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { createDailyCollections } from '../../app/daily-collections';
import { DailyCollectionsController, type DailyCollectionsState } from '../../application/use-cases/daily-collections-controller';
import type { DailyDueItem, DailyReceivedItem } from '../../domain/entities/daily-collections';
import type { PlanBaseline } from '../../infrastructure/api/payment.api';
import { costaRicaDateOnly, formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { PaymentPlanEditorDialog } from '../components/PaymentPlanEditorDialog';
import { TableActions } from '../components/TableActions';
import { Icon } from '../components/layout/Icon';
import { useAuth } from '../hooks/auth-context';
import { downloadDailyPlan, saveDailyPlan } from '../helpers/daily-collections-operations';
import { loadActivePaymentContext } from '../helpers/payment-loan-link';
import { planBaselineFromContext, planDraftFromEntries, planSaveAttempt, reviewPlanDraft,
  type PlanDraftEntry } from '../helpers/payment-plan';

type PlanSession = { loanId: string; base: PlanBaseline; draft: PlanDraftEntry[]; busy: boolean; error: string };
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'No se pudo completar la operación.';

export function DailyCollectionsPage({ controller: supplied }: { controller?: DailyCollectionsController } = {}): ReactElement {
  const { can } = useAuth();
  const [controller] = useState(() => supplied ?? createDailyCollections());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [plan, setPlan] = useState<PlanSession | null>(null);
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const planAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const planLocked = useRef(false);
  const openToken = useRef(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { void controller.load(); }, [controller]);
  useEffect(() => { if (plan) dateRef.current?.focus(); }, [plan?.loanId]);
  const openPlan = async (loanId: string) => {
    if (!can('payments.plan.customize') || planLocked.current) return;
    const token = ++openToken.current;
    setActionError(''); setSuccess('');
    try {
      const context = await loadActivePaymentContext(loanId, () => token === openToken.current);
      if (!context) return;
      planAttempt.current = null;
      setPlan({ loanId, base: planBaselineFromContext(context), draft: planDraftFromEntries(context.combinedPlan), busy: false, error: '' });
    } catch (cause) { if (token === openToken.current) setActionError(message(cause)); }
  };
  const closePlan = () => { if (planLocked.current) return; ++openToken.current; planAttempt.current = null; setPlan(null); };
  const savePlan = async () => {
    if (!plan || planLocked.current || !can('payments.plan.customize')) return;
    const review = reviewPlanDraft(plan.base.financialBalance, plan.draft);
    if (!review.canSave) { setPlan({ ...plan, error: 'Revisa las fechas, los montos y el saldo distribuido.' }); return; }
    const attempt = planSaveAttempt(planAttempt.current, plan.loanId, plan.base, review.entries);
    planAttempt.current = attempt;
    planLocked.current = true; setPlan({ ...plan, busy: true, error: '' });
    try {
      await saveDailyPlan(plan.loanId, plan.base, plan.draft, attempt.key, controller);
      setPlan(null); planAttempt.current = null; setSuccess('Plan de pagos actualizado correctamente.');
    } catch (cause) { setPlan((current) => current ? { ...current, error: message(cause) } : null); }
    finally { planLocked.current = false; setPlan((current) => current ? { ...current, busy: false } : null); }
  };
  const download = async (loanId: string) => {
    setActionError('');
    try { await downloadDailyPlan(loanId); }
    catch (cause) { setActionError(message(cause)); }
  };
  return <DailyCollectionsView state={state} controller={controller} can={can} onCustomize={(id) => { void openPlan(id); }}
    onPrint={(id) => { void download(id); }} actionError={actionError} success={success}>
    {plan && can('payments.plan.customize') && <PaymentPlanEditorDialog draft={plan.draft} balance={plan.base.financialBalance}
      busy={plan.busy} error={plan.error} onChange={(draft) => setPlan((current) => current ? { ...current, draft, error: '' } : null)}
      onAdd={() => setPlan((current) => current ? { ...current, draft: [...current.draft,
        { key: crypto.randomUUID(), id: null, dueDate: costaRicaDateOnly(), pendingAmount: '' }], error: '' } : null)}
      onSave={() => { void savePlan(); }} onClose={closePlan} dialogRef={dialogRef} dateRef={dateRef} />}
  </DailyCollectionsView>;
}

function Pager({ section, total, page, pageSize, onPage }: { section: string; total: number; page: number; pageSize: number;
  onPage: (page: number) => void }): ReactElement {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="loan-list__pagination" aria-label={`Páginas de ${section}`}>
    <button className="button button--secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
    <span>Página {page} de {pages} · {total} registros</span>
    <button className="button button--secondary" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Siguiente</button>
  </nav>;
}

export function DailyCollectionsView({ state, controller, can, onCustomize, onPrint, actionError = '', success = '',
  today = costaRicaDateOnly(), children }: { state: DailyCollectionsState; controller: DailyCollectionsController;
  can: (permission: string) => boolean; onCustomize: (id: string) => void; onPrint: (id: string) => void;
  actionError?: string; success?: string; today?: string; children?: ReactNode }): ReactElement {
  const metrics = [
    { label: 'POR COBRAR', value: state.summary?.dueCount.toLocaleString('es-CR') },
    { label: 'PAGARON', value: state.summary?.paidLoansCount.toLocaleString('es-CR') },
    { label: 'MONTO POR COBRAR', value: state.summary && formatCRCAggregate(state.summary.dueAmount) },
    { label: 'MONTO RECIBIDO', value: state.summary && formatCRCAggregate(state.summary.receivedAmount) },
  ];
  return <section className="page-section loan-list loan-management daily-collections" aria-labelledby="daily-collections-title">
    <div className="loan-list__heading"><div><span className="eyebrow">PAGOS</span><h1 id="daily-collections-title">Cobros del día</h1>
      <p>Consulta de obligaciones por cobrar y pagos recibidos.</p></div>
      <button className="button button--secondary loan-management__refresh" type="button" aria-label="Actualizar cobros"
        aria-busy={state.refreshing} disabled={state.loading || state.refreshing} onClick={() => { void controller.load(); }}>
        <Icon name="reverse" />Actualizar
      </button></div>
    <div className="daily-collections__date-bar" aria-label="Fecha operativa">
      <button className="button button--secondary" type="button" onClick={() => controller.previous()}>Día anterior</button>
      <label htmlFor="daily-collections-date">Fecha <input id="daily-collections-date" type="date" value={state.date}
        onChange={(event) => controller.setDate(event.target.value)} /></label>
      <span>{formatDateOnlyForDisplay(state.date)}</span>
      <button className="button button--secondary" type="button" disabled={state.date === today} onClick={() => controller.resetToday()}>Hoy</button>
      <button className="button button--secondary" type="button" onClick={() => controller.next()}>Día siguiente</button>
    </div>
    {state.loading && <p role="status">Cargando cobros del día…</p>}
    {state.refreshing && <p role="status">Actualizando cobros del día…</p>}
    {actionError && <p role="alert">{actionError}</p>}{success && <p role="status">{success}</p>}
    <div className="loan-management__summary" aria-label="Resumen de cobros del día">{metrics.map(({ label, value }) =>
      <div key={label}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</div>
    {state.errors.summary && <p role="alert">Resumen: {state.errors.summary}</p>}
    <div className="daily-collections__sections">
      <section className="loan-list__surface" aria-labelledby="daily-due-title"><h2 id="daily-due-title" className="daily-collections__section-title">POR COBRAR</h2>
        <div className="loan-list__toolbar"><label htmlFor="daily-collections-search">Buscar<input id="daily-collections-search"
          placeholder="Préstamo, cliente, identificación o teléfono" value={state.search} onChange={(event) => controller.setSearch(event.target.value)} /></label></div>
        {state.errors.due && <p role="alert" className="loan-list__message loan-list__message--error">Por cobrar: {state.errors.due}</p>}
        {state.due && !state.due.items.length && !state.errors.due && <p className="loan-list__message">No hay obligaciones por cobrar para esta fecha.</p>}
        {state.due && state.due.items.length > 0 && <><div className="loan-list__table-wrap" role="region" aria-label="Obligaciones por cobrar" tabIndex={0}>
          <table className="loan-list__table"><thead><tr><th>Cliente</th><th>Préstamo</th><th>Cuota</th><th>Vencimiento</th>
            <th>Saldo operativo</th><th className="loan-list__actions">Acciones</th></tr></thead>
            <tbody>{state.due.items.map((row: DailyDueItem) => <tr key={row.planEntryId}>
              <td className="daily-collections__customer"><strong>{row.customer.fullName}</strong><small>{[row.customer.identification, row.customer.primaryPhone].filter(Boolean).join(' · ')}</small></td>
              <td>#{row.loan.loanNumber}</td><td>{row.sequence}</td><td>{formatDateOnlyForDisplay(row.dueDate)}</td>
              <td className="loan-list__numeric">{formatCRCAggregate(row.pendingAmount)}</td>
              <td className="loan-list__actions"><TableActions ariaLabel={`Acciones de cuota ${row.sequence} del préstamo ${row.loan.loanNumber}`} actions={[
                ...(can('loans.view') ? [{ key: 'view', icon: 'view' as const, label: 'Ver', title: 'Ver información del préstamo',
                  ariaLabel: `Ver préstamo ${row.loan.loanNumber}`, to: `/loans/${encodeURIComponent(row.loan.id)}` }] : []),
                ...(can('payments.view') && can('payments.create') ? [{ key: 'pay', icon: 'payment' as const, label: 'Registrar pago', title: 'Registrar pago',
                  ariaLabel: `Registrar pago del préstamo ${row.loan.loanNumber}`, to: `/payments/new?loanId=${encodeURIComponent(row.loan.id)}` }] : []),
                ...(can('payments.plan.customize') ? [{ key: 'plan', icon: 'edit' as const, label: 'Personalizar plan', title: 'Personalizar plan',
                  ariaLabel: `Personalizar plan del préstamo ${row.loan.loanNumber}`, onClick: () => onCustomize(row.loan.id) }] : []),
                ...(can('loans.view') && can('loans.export') ? [{ key: 'print', icon: 'download' as const, label: 'Imprimir plan', title: 'Imprimir plan',
                  ariaLabel: `Imprimir plan del préstamo ${row.loan.loanNumber}`, onClick: () => onPrint(row.loan.id) }] : []),
              ]} /></td>
            </tr>)}</tbody></table></div>
          <Pager section="obligaciones por cobrar" total={state.due.total} page={state.due.page} pageSize={state.due.pageSize}
            onPage={(page) => controller.setPage('due', page)} /></>}
      </section>
      <section className="loan-list__surface" aria-labelledby="daily-received-title"><h2 id="daily-received-title" className="daily-collections__section-title">PAGOS RECIBIDOS</h2>
        {state.errors.received && <p role="alert" className="loan-list__message loan-list__message--error">Pagos recibidos: {state.errors.received}</p>}
        {state.received && !state.received.items.length && !state.errors.received && <p className="loan-list__message">No hay pagos recibidos para esta fecha.</p>}
        {state.received && state.received.items.length > 0 && <><div className="loan-list__table-wrap" role="region" aria-label="Pagos recibidos" tabIndex={0}>
          <table className="loan-list__table"><thead><tr><th>Cliente</th><th>Préstamo</th><th>Fecha</th><th>Monto</th><th>Forma de pago</th><th>Cobrador</th></tr></thead>
            <tbody>{state.received.items.map((row: DailyReceivedItem) => <tr key={row.paymentId}>
              <td className="daily-collections__customer"><strong>{row.customer.fullName}</strong><small>{row.customer.identification}</small></td><td>#{row.loan.loanNumber}</td>
              <td>{formatDateOnlyForDisplay(row.paymentDate)}</td><td className="loan-list__numeric">{formatCRCAggregate(row.amount)}</td>
              <td>{row.paymentMethod.name}</td><td>{row.collector?.name ?? '—'}</td>
            </tr>)}</tbody></table></div>
          <Pager section="pagos recibidos" total={state.received.total} page={state.received.page} pageSize={state.received.pageSize}
            onPage={(page) => controller.setPage('received', page)} /></>}
      </section>
    </div>{children}
  </section>;
}
