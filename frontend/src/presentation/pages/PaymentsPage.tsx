import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { loanApi } from '../../infrastructure/api/loan.api';
import { paymentApi, type PaymentContext, type PaymentLoan, type PendingPaymentEntry, type PlanBaseline, type ValidPayment } from '../../infrastructure/api/payment.api';
import { generateLoanPaymentPlanReport } from '../../infrastructure/reports/loan-payment-plan-report.service';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRC, moneyFromCents, parseMoneyCents } from '../../shared/utils/money';
import { MoneyInput } from '../components/MoneyInput';
import { PaymentPlanEditorDialog } from '../components/PaymentPlanEditorDialog';
import { TableActions } from '../components/TableActions';
import { Icon } from '../components/layout/Icon';
import { PAGE_SIZE, refreshPaymentLoanPage, reusePendingLoanPage, type LoanList } from '../helpers/payment-loan-selector';
import { loadActivePaymentContext, paymentLoanIdFromSearch, paymentSearchWithLoan, selectPaymentLoanFromDialog } from '../helpers/payment-loan-link';
import { localDateOnly, paymentTimeline, persistPlanAndRefresh, planBaselineFromContext, planDraftFromEntries, planSaveAttempt, PlanRefreshError, reviewPlanDraft, type PlanDraftEntry } from '../helpers/payment-plan';
import { useAuth } from '../hooks/auth-context';

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'No se pudo completar la solicitud.';
export const canDownloadPaymentPlan = (can: (permission: string) => boolean) => can('loans.export') && can('loans.view');
type DownloadLock = { current: { selection: number } | null };
export async function downloadPaymentPlan(
  selectedLoanId: () => string | null, selection: number, isCurrent: () => boolean, lock: DownloadLock,
  api: Pick<typeof loanApi, 'detail'> = loanApi, report: typeof generateLoanPaymentPlanReport = generateLoanPaymentPlanReport,
): Promise<void> {
  const loanId = selectedLoanId();
  if (!loanId || !isCurrent() || lock.current?.selection === selection) return;
  const ticket = { selection };
  lock.current = ticket;
  try {
    const detail = await api.detail(loanId);
    if (isCurrent()) await report(detail);
  } catch (cause) { if (isCurrent()) throw cause; }
  finally { if (lock.current === ticket) lock.current = null; }
}
type CaptureBody = Omit<Parameters<typeof paymentApi.create>[0], 'idempotencyKey'>;
type CaptureAttempt = { fingerprint: string; key: string };

// The context query orders by payment_date, created_at, id; filtering VALID preserves that order.
// The timeline and lastValidPayment projection cannot resolve created_at ties.
export function annulmentTarget(context: PaymentContext): ValidPayment | null {
  return context.validPayments.filter((payment) => payment.status === 'VALID').at(-1) ?? null;
}

export function annulmentAttempt(previous: CaptureAttempt | null, paymentId: string, reason: string, generateKey: () => string = () => crypto.randomUUID()): CaptureAttempt {
  const fingerprint = JSON.stringify({ paymentId, reason: reason.trim() });
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: generateKey() };
}

export async function runAnnulOnce<T>(lock: { current: boolean }, action: () => Promise<T>): Promise<T | undefined> {
  if (lock.current) return undefined;
  lock.current = true;
  try { return await action(); } finally { lock.current = false; }
}

export async function submitAnnulment(loanId: string, paymentId: string, reason: string, key: string, api: Pick<typeof paymentApi, 'annul' | 'context'>) {
  try { await api.annul(paymentId, { reason, idempotencyKey: key }); }
  catch (error) {
    let context: PaymentContext | null = null;
    try { context = await api.context(loanId); } catch { /* Keep the original rejection visible. */ }
    return { accepted: false as const, context, error, retryUncertain: error instanceof TypeError };
  }
  try { return { accepted: true as const, context: await api.context(loanId) }; }
  catch (error) { return { accepted: false as const, context: null, error: new Error(`La anulación fue recibida, pero no se pudo actualizar el contexto. ${errorMessage(error)}`), retryUncertain: true }; }
}

export function defaultPaymentDate(dueDate: string, today = new Date().toISOString().slice(0, 10)): string {
  return dueDate <= today ? dueDate : today;
}

export function paymentCapturePayload(context: PaymentContext, values: { amount: string; paymentDate: string; methodId: string; collectorId: string }, today = new Date().toISOString().slice(0, 10)): CaptureBody | null {
  const cents = parseMoneyCents(values.amount);
  const balance = parseMoneyCents(context.balances.financialBalance);
  if (!context.firstOperationalRow || cents === null || cents <= 0n || balance === null || cents > balance
    || !/^\d{4}-\d{2}-\d{2}$/.test(values.paymentDate) || formatDateOnlyForDisplay(values.paymentDate) === '—' || values.paymentDate > today
    || !context.preferredMethod.activeMethods.some((method) => method.id === values.methodId)
    || (values.collectorId && !context.preferredMethod.collectors.some((collector) => collector.id === values.collectorId))) return null;
  return { loanId: context.summary.loanId, paymentDate: values.paymentDate, amount: moneyFromCents(cents), methodId: values.methodId,
    ...(values.collectorId ? { collectorId: values.collectorId } : {}) };
}

export function paymentCaptureAttempt(previous: CaptureAttempt | null, body: CaptureBody, generateKey = () => crypto.randomUUID()): CaptureAttempt {
  const fingerprint = JSON.stringify(body);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: generateKey() };
}

export function PaymentSelector({ loans, total, page, loading, error, search, onSearch, onPage, onSelect }: {
  loans: PaymentLoan[]; total: number; page: number; loading: boolean; error: string; search: string;
  onSearch: (value: string) => void; onPage: (page: number) => void; onSelect: (id: string) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <section aria-label="Seleccionar préstamo">
    <label>Buscar préstamo, identificación o cliente<input value={search} onChange={(event) => onSearch(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Cargando préstamos…</p>}
    {!loading && !error && (loans.length ? <div className="loan-list__table-wrap"><table className="loan-list__table">
      <thead><tr><th>N°</th><th>Identificación</th><th>Cliente</th><th>Saldo pendiente</th><th>Condición</th><th>Acciones</th></tr></thead>
      <tbody>{loans.map((loan) => <tr key={loan.id}><td>{loan.loanNumber}</td><td>{loan.identification}</td><td>{loan.customerName}</td><td>{loan.financialBalance}</td><td>{loan.isOverdue ? 'Con atraso' : 'Al día'}</td><td className="loan-list__actions"><TableActions ariaLabel={`Acciones del préstamo ${loan.loanNumber}`} actions={[{ key: 'view', icon: 'view', label: 'Seleccionar', title: 'Seleccionar préstamo', ariaLabel: `Seleccionar préstamo ${loan.loanNumber}`, onClick: () => onSelect(loan.id) }]} /></td></tr>)}</tbody>
    </table></div> : <p>No se encontraron préstamos activos.</p>)}
    {!loading && !error && <nav aria-label="Páginas de préstamos"><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button><span>Página {page} de {pages} · {total} préstamos</span><button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Siguiente</button></nav>}
  </section>;
}

export function PaymentLoanDialog({ loans, total, page, loading, refreshing, retainRowsOnError, error, search, onSearch, onPage, onSelect, onRefresh, onClose, dialogRef, searchRef }: {
  loans: PaymentLoan[]; total: number; page: number; loading: boolean; refreshing: boolean; retainRowsOnError: boolean; error: string; search: string;
  onSearch: (value: string) => void; onPage: (page: number) => void; onSelect: (id: string) => void;
  onRefresh: () => void;
  onClose: () => void; dialogRef: RefObject<HTMLDivElement | null>; searchRef: RefObject<HTMLInputElement | null>;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <div className="dialog-backdrop"><div className="dialog payment-loan-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-loan-dialog-title" ref={dialogRef}>
    <header className="payment-loan-dialog__header"><h2 id="payment-loan-dialog-title">Seleccionar préstamo activo</h2><div className="payment-loan-dialog__header-actions"><button className="button button--secondary payment-loan-dialog__refresh" type="button" aria-label="Refrescar préstamos" title="Refrescar préstamos" aria-busy={refreshing} disabled={refreshing} onClick={onRefresh}><span className={refreshing ? 'payment-loan-dialog__refresh-icon--spinning' : ''}><Icon name="reverse" /></span>Refrescar</button><button className="button button--secondary" type="button" onClick={onClose}>Cerrar</button></div></header>
    <div className="payment-loan-dialog__search"><label htmlFor="payment-loan-search">Buscar préstamo</label><input id="payment-loan-search" ref={searchRef} value={search} placeholder="N.º préstamo, identificación, nombre o teléfono" onChange={(event) => onSearch(event.target.value)} /></div>
    <div className="payment-loan-dialog__table-wrap">
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Cargando préstamos…</p>}
      {refreshing && <span className="loan-list__sr-only" role="status">Actualizando préstamos…</span>}
      {!loading && (!error || retainRowsOnError) && (loans.length ? <table className="catalog-table payment-loan-dialog__table">
        <thead><tr><th>N°</th><th>Identificación</th><th>Cliente</th><th>Saldo pendiente</th><th>Condición</th><th>Acción</th></tr></thead>
        <tbody>{loans.map((loan) => <tr key={loan.id}><td>#{loan.loanNumber}</td><td>{loan.identification}</td><td>{loan.customerName}</td><td>{formatCRC(loan.financialBalance)}</td><td><span className={`status-badge ${loan.isOverdue ? 'payment-loan-dialog__late' : 'status-badge--active'}`}>{loan.isOverdue ? 'Con atraso' : 'Al día'}</span></td><td><button className="button button--secondary payment-loan-dialog__select" type="button" aria-label={`Seleccionar préstamo ${loan.loanNumber}`} onClick={() => onSelect(loan.id)}>Seleccionar</button></td></tr>)}</tbody>
      </table> : <p>No se encontraron préstamos activos.</p>)}
    </div>
    <footer className="payment-loan-dialog__footer"><nav aria-label="Páginas de préstamos"><button className="button button--secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button><span>Página {page} de {pages} · {total} préstamos</span><button className="button button--secondary" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Siguiente</button></nav></footer>
  </div></div>;
}

export function PaymentDetails({ context, canCreate, amount, methodId, busy, onAmount, onMethod, onSubmit }: {
  context: PaymentContext; canCreate: boolean; amount: string; methodId: string; busy: boolean;
  onAmount: (value: string) => void; onMethod: (value: string) => void; onSubmit: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = [
    ...context.validPayments.map((payment) => ({ id: payment.id, date: payment.paymentDate, amount: payment.amount, kind: 'Pago válido' })),
    ...context.combinedPlan.map((entry) => ({ id: entry.id, date: entry.dueDate, amount: entry.pendingAmount, kind: entry.dueDate < today ? 'Cuota vencida' : 'Cuota pendiente' })),
  ].sort((left, right) => left.date.localeCompare(right.date) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  return <section aria-label="Contexto de pago"><h2>Préstamo {context.summary.loanNumber}</h2>
    <p>Cliente: {context.summary.customerName} · Identificación: {context.summary.identification}</p>
    <p>Saldo financiero: {context.balances.financialBalance}</p>
    <p>Capital pendiente (valor actual): {context.balances.outstandingPrincipal}</p>
    <p>Interés pendiente: {context.balances.outstandingInterest}</p>
    <p>Primera cuota pendiente: {context.firstOperationalRow ? `${formatDateOnlyForDisplay(context.firstOperationalRow.dueDate)} · ${context.firstOperationalRow.pendingAmount}` : 'Ninguna'}</p>
    <p>Elegible para refinanciar: {context.refinanceEligibility ? 'Sí' : 'No'}</p>
    <p>Último pago válido: {context.lastValidPayment ? `${formatDateOnlyForDisplay(context.lastValidPayment.paymentDate)} · ${context.lastValidPayment.amount}` : 'Ninguno'}</p>
    {canCreate && <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <label>Monto<input inputMode="decimal" value={amount} onChange={(event) => onAmount(event.target.value)} required /></label>
      <label>Método de pago<select value={methodId} onChange={(event) => onMethod(event.target.value)} required><option value="">Seleccionar método</option>{context.preferredMethod.activeMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>
      <button type="submit" disabled={busy || !methodId}>{busy ? 'Registrando…' : 'Registrar pago'}</button>
    </form>}
    <h3>Plan vigente y pagos válidos</h3>
    {rows.length ? <ul>{rows.map((row) => <li key={`${row.kind}:${row.id}`}>{formatDateOnlyForDisplay(row.date)} · {row.kind}: {row.amount}</li>)}</ul> : <p>No hay pagos válidos ni cuotas pendientes.</p>}
  </section>;
}

export function PaymentCaptureDialog({ context, entry, visibleNumber, amount, paymentDate, methodId, collectorId, busy, error, onAmount, onDate, onMethod, onCollector, onSubmit, onClose, dialogRef, dateRef, today }: {
  context: PaymentContext; entry: PendingPaymentEntry; visibleNumber: number; amount: string; paymentDate: string; methodId: string; collectorId: string; busy: boolean; error: string;
  onAmount: (value: string) => void; onDate: (value: string) => void; onMethod: (value: string) => void; onCollector: (value: string) => void;
  onSubmit: () => void; onClose: () => void; dialogRef: RefObject<HTMLDivElement | null>; dateRef: RefObject<HTMLInputElement | null>; today: string;
}) {
  return <div className="dialog-backdrop"><div className="dialog payment-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-capture-title" ref={dialogRef}>
    <header className="payment-capture-dialog__header"><h2 id="payment-capture-title">Registrar pago</h2></header>
    <div className="payment-capture-dialog__context"><strong>Cuota operativa N.º {visibleNumber}</strong><span>Vencimiento: {formatDateOnlyForDisplay(entry.dueDate)}</span><span>Pendiente: {formatCRC(entry.pendingAmount)}</span></div>
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="payment-capture-dialog__fields">
        <label>Fecha del pago<input ref={dateRef} type="date" value={paymentDate} max={today} onChange={(event) => onDate(event.target.value)} required /></label>
        <label>Monto recibido<MoneyInput value={amount} onChange={onAmount} required /></label>
        <label>Forma de pago<select value={methodId} onChange={(event) => onMethod(event.target.value)} required><option value="">Seleccionar método</option>{context.preferredMethod.activeMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>
        <label>Cobrador (opcional)<select value={collectorId} onChange={(event) => onCollector(event.target.value)}><option value="">Sin cobrador</option>{context.preferredMethod.collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}</option>)}</select></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="payment-capture-dialog__footer"><button className="button button--secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="button button--primary" type="submit" disabled={busy || !methodId}>{busy ? 'Registrando…' : 'Registrar pago'}</button></footer>
    </form>
  </div></div>;
}

export function PaymentAnnulDialog({ context, payment, reason, busy, eligible, error, onReason, onSubmit, onClose, dialogRef, reasonRef }: {
  context: PaymentContext; payment: ValidPayment; reason: string; busy: boolean; eligible: boolean; error: string;
  onReason: (value: string) => void; onSubmit: () => void; onClose: () => void;
  dialogRef: RefObject<HTMLDivElement | null>; reasonRef: RefObject<HTMLTextAreaElement | null>;
}) {
  return <div className="dialog-backdrop"><div className="dialog payment-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-annul-title" tabIndex={-1} ref={dialogRef} aria-busy={busy}>
    <header className="payment-capture-dialog__header"><h2 id="payment-annul-title">Anular pago</h2></header>
    <div className="payment-capture-dialog__context"><strong>Préstamo #{context.summary.loanNumber} · {context.summary.customerName}</strong><span>Identificación: {context.summary.identification}</span><span>Fecha del pago: {formatDateOnlyForDisplay(payment.paymentDate)}</span><span>Monto: {formatCRC(payment.amount)}</span></div>
    <p>Esta acción anula el pago y recalcula el saldo y el plan de pagos. No elimina el registro.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy && eligible && reason.trim()) onSubmit(); }}>
      <label htmlFor="payment-annul-reason">Motivo<textarea id="payment-annul-reason" ref={reasonRef} value={reason} required disabled={busy} onChange={(event) => onReason(event.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="payment-capture-dialog__footer"><button className="button button--secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="button button--danger" type="submit" disabled={busy || !eligible || !reason.trim()}>{busy ? 'Anulando…' : 'Anular pago'}</button></footer>
    </form>
  </div></div>;
}

export function SelectedPaymentDetails({ context, canCreate, canCustomize, canAnnul, canExport, annulBusy, downloadBusy, onPay, onCustomize, onAnnul, onDownload, onChangeLoan, onCloseLoan, triggerRef, paymentTriggerRef, planTriggerRef, annulTriggerRef }: {
  context: PaymentContext; canCreate: boolean; canCustomize: boolean; canAnnul: boolean; canExport: boolean; annulBusy: boolean; downloadBusy: boolean; onPay: () => void; onCustomize: () => void; onAnnul: (paymentId: string) => void; onDownload: () => void;
  onChangeLoan: () => void; onCloseLoan: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>; paymentTriggerRef: RefObject<HTMLButtonElement | null>; planTriggerRef: RefObject<HTMLButtonElement | null>; annulTriggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const today = localDateOnly();
  const rows = paymentTimeline(context);
  const lastValid = annulmentTarget(context);
  const isOverdue = rows.some((row) => row.kind === 'PLAN_ENTRY' && row.date < today);

  return <div className="payment-selected">
    <section className="payment-selected__summary" aria-labelledby="payment-selected-loan">
      <header className="payment-selected__header">
        <div><h2 id="payment-selected-loan">{context.summary.customerName}</h2><p>Préstamo #{context.summary.loanNumber}</p><small>Identificación: {context.summary.identification}</small></div>
        <div className="payment-selected__actions">
          <button className="button button--secondary" type="button" ref={triggerRef} onClick={onChangeLoan}>Cambiar préstamo</button>
          <button className="button button--secondary" type="button" onClick={onCloseLoan}>Cerrar préstamo</button>
        </div>
      </header>
      <dl className="payment-selected__metrics">
        <div><dt>Próximo vencimiento</dt><dd>{context.firstOperationalRow ? formatDateOnlyForDisplay(context.firstOperationalRow.dueDate) : '—'}</dd></div>
        <div><dt>Capital pendiente</dt><dd>{context.balances.outstandingPrincipal ? formatCRC(context.balances.outstandingPrincipal) : '—'}</dd></div>
        <div><dt>Interés pendiente</dt><dd>{context.balances.outstandingInterest ? formatCRC(context.balances.outstandingInterest) : '—'}</dd></div>
        <div><dt>Saldo pendiente</dt><dd>{context.balances.financialBalance ? formatCRC(context.balances.financialBalance) : '—'}</dd></div>
        <div className="payment-selected__statuses"><dt>Condición</dt><dd><span className={`status-badge ${isOverdue ? 'payment-selected__late' : 'status-badge--active'}`}>{isOverdue ? 'Con atraso' : 'Al día'}</span></dd><dt>Refinanciamiento</dt><dd><span className={`status-badge ${context.refinanceEligibility ? 'status-badge--active' : 'status-badge--inactive'}`}>{context.refinanceEligibility ? 'APTO' : 'NO APTO'}</span></dd></div>
      </dl>
    </section>
    <section className="payment-selected__plan" aria-labelledby="payment-selected-plan">
      <div className="payment-selected__plan-header"><h2 id="payment-selected-plan">Plan de pagos</h2><div className="payment-selected__actions">
        {canCustomize && <button className="button button--secondary" type="button" ref={planTriggerRef} onClick={onCustomize}>Personalizar plan</button>}
        {canExport && <button className="button button--secondary" type="button" title="Descargar plan de pago" aria-label="Descargar plan de pago" aria-busy={downloadBusy} disabled={downloadBusy} onClick={onDownload}><Icon name="download" />{downloadBusy ? 'Descargando…' : 'Descargar plan de pago'}</button>}
      </div></div>
      <div className="payment-selected__table-wrap"><table className="catalog-table payment-selected__table">
        <thead><tr><th scope="col">N.º</th><th scope="col">Fecha</th><th scope="col">Monto pendiente</th><th scope="col">Monto pagado</th><th scope="col">Estado</th><th scope="col">Acción</th></tr></thead>
        <tbody>{rows.map((row, index) => {
          const paid = row.kind === 'PAYMENT';
          const overdue = !paid && row.date < today;
          const number = index + 1;
           return <tr key={`${row.kind}:${row.id}`}><td>{number}</td><td>{formatDateOnlyForDisplay(row.date)}</td><td>{paid ? '—' : formatCRC(row.amount)}</td><td>{paid ? formatCRC(row.amount) : '—'}</td><td><span className={`status-badge ${paid ? 'status-badge--active' : overdue ? 'payment-selected__overdue' : 'payment-selected__pending'}`}>{paid ? 'PAGADA' : overdue ? 'VENCIDA' : 'PENDIENTE'}</span></td><td>{paid && canAnnul && row.id === lastValid?.id ? <TableActions ariaLabel={`Acciones del pago del ${formatDateOnlyForDisplay(row.date)}`} actions={[{ key: 'annul', icon: 'reverse', label: 'Anular pago', title: 'Anular último pago válido', ariaLabel: `Anular pago del ${formatDateOnlyForDisplay(row.date)} por ${formatCRC(row.amount)} del préstamo ${context.summary.loanNumber}`, buttonRef: annulTriggerRef, disabled: annulBusy, onClick: () => onAnnul(row.id) }]} /> : !paid && canCreate && row.id === context.firstOperationalRow?.id ? <TableActions ariaLabel={`Acciones de la obligación ${number}`} actions={[{ key: 'pay', icon: 'payment', label: 'Pagar', title: `Pagar cuota ${number}`, ariaLabel: `Pagar cuota ${number}`, buttonRef: paymentTriggerRef, onClick: onPay }]} /> : '—'}</td></tr>;
        })}</tbody>
      </table></div>
      {!rows.length && <p>No hay pagos válidos ni cuotas pendientes.</p>}
      <details className="payment-selected__history"><summary>Pagos válidos</summary>
         <p>Último pago válido: {lastValid ? `${formatDateOnlyForDisplay(lastValid.paymentDate)} · ${formatCRC(lastValid.amount)}` : 'Ninguno'}</p>
        {context.validPayments.length ? <ul>{context.validPayments.map((payment) => <li key={payment.id}>{formatDateOnlyForDisplay(payment.paymentDate)} · Pago válido: {payment.amount ? formatCRC(payment.amount) : '—'}</li>)}</ul> : <p>No hay pagos válidos.</p>}
      </details>
    </section>
  </div>;
}

export function PaymentsPage() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const isNewPayment = pathname === '/payments/new';
  const [searchParams, setSearchParams] = useSearchParams();
  const { id: urlLoanId, error: urlError } = isNewPayment ? paymentLoanIdFromSearch(searchParams.toString()) : { id: null, error: null };
  const [loanList, setLoanList] = useState<LoanList>({ loans: [], total: 0, page: 1 });
  const { loans, total, page } = loanList;
  const setPage = (next: number) => { ++listRequest.current; setLoanList((current) => ({ ...current, page: next })); };
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [retainRowsOnError, setRetainRowsOnError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshLocked = useRef(false);
  const listRequest = useRef(0);
  const pendingAutoList = useRef<{ search: string; page: number; promise: Promise<LoanList> } | null>(null);
  const skipAutoFetch = useRef<{ search: string; page: number } | null>(null);
  const [selection, setSelected] = useState<PaymentContext | null>(null);
  const selected = isNewPayment ? (urlLoanId && selection?.summary.loanId === urlLoanId ? selection : null) : selection;
  const selectedLoanId = useRef<string | null>(null);
  const downloadLock = useRef<DownloadLock['current']>(null);
  const [downloadingSelection, setDownloadingSelection] = useState<number | null>(null);
  const [selectionError, setSelectionError] = useState<{ id: string; message: string } | null>(null);
  const [showSelector, setShowSelector] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const paymentTriggerRef = useRef<HTMLButtonElement>(null);
  const captureDialogRef = useRef<HTMLDivElement>(null);
  const paymentDateRef = useRef<HTMLInputElement>(null);
  const planTriggerRef = useRef<HTMLButtonElement>(null);
  const planDialogRef = useRef<HTMLDivElement>(null);
  const planDateRef = useRef<HTMLInputElement>(null);
  const returnPlanFocus = useRef(false);
  const planLocked = useRef(false);
  const planAttempt = useRef<CaptureAttempt | null>(null);
  const planOpenToken = useRef(0);
  const [showPlan, setShowPlan] = useState(false);
  const [planBase, setPlanBase] = useState<PlanBaseline | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanDraftEntry[]>([]);
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError] = useState('');
  const [planSuccess, setPlanSuccess] = useState('');
  const annulTriggerRef = useRef<HTMLButtonElement>(null);
  const annulDialogRef = useRef<HTMLDivElement>(null);
  const annulReasonRef = useRef<HTMLTextAreaElement>(null);
  const annulLocked = useRef(false);
  const annulAttempt = useRef<CaptureAttempt | null>(null);
  const annulOpenToken = useRef(0);
  const annulFocusPaymentId = useRef<string | null>(null);
  const returnAnnulFocus = useRef(false);
  const [annulTarget, setAnnulTarget] = useState<{ loanId: string; payment: ValidPayment } | null>(null);
  const [showAnnul, setShowAnnul] = useState(false);
  const [annulReason, setAnnulReason] = useState('');
  const [annulError, setAnnulError] = useState('');
  const [annulSaving, setAnnulSaving] = useState(false);
  const [annulRetryUncertain, setAnnulRetryUncertain] = useState(false);
  const returnPaymentFocus = useRef(false);
  const captureLocked = useRef(false);
  const captureAttempt = useRef<CaptureAttempt | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentDate, setPaymentDate] = useState('');
  const [collectorId, setCollectorId] = useState('');
  const [selecting, setSelecting] = useState(false);
  const selectionToken = useRef(0);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState('');
  const [busy, setBusy] = useState(false);
  const selectionPending = Boolean(isNewPayment && urlLoanId && !selected && selectionError?.id !== urlLoanId);

  const closeSelector = useCallback(() => { setShowSelector(false); triggerRef.current?.focus(); }, []);
  const closePayment = useCallback(() => {
    if (captureLocked.current) return;
    returnPaymentFocus.current = true;
    setError(''); setShowPayment(false);
  }, []);
  const closePlan = useCallback(() => {
    if (planLocked.current) return;
    returnPlanFocus.current = true;
    ++planOpenToken.current;
    setShowPlan(false); setPlanBase(null); setPlanDraft([]); setPlanError(''); planAttempt.current = null;
  }, []);
  const closeAnnul = useCallback(() => {
    if (annulLocked.current) return;
    ++annulOpenToken.current;
    returnAnnulFocus.current = true;
    setShowAnnul(false); setAnnulTarget(null); setAnnulReason(''); setAnnulError(''); setAnnulRetryUncertain(false); annulAttempt.current = null;
  }, []);
  useEffect(() => {
    if (!showSelector || !isNewPayment) return;
    searchRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeSelector(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showSelector, isNewPayment, closeSelector]);
  useEffect(() => { if (isNewPayment && selected && !showAnnul) detailsRef.current?.focus(); }, [isNewPayment, selected, showAnnul]);
  useEffect(() => {
    if (!showAnnul && returnAnnulFocus.current) {
      returnAnnulFocus.current = false;
      const samePayment = selected && annulmentTarget(selected)?.id === annulFocusPaymentId.current;
      (samePayment ? annulTriggerRef.current ?? detailsRef.current : detailsRef.current ?? triggerRef.current)?.focus();
      annulFocusPaymentId.current = null;
    }
  }, [showAnnul, selected]);
  useEffect(() => {
    if (!showAnnul) return;
    if (annulSaving) annulDialogRef.current?.focus();
    else annulReasonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!annulLocked.current) closeAnnul(); return; }
      if (event.key !== 'Tab' || !annulDialogRef.current) return;
      const focusable = Array.from(annulDialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled])'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first || !last) { event.preventDefault(); annulDialogRef.current.focus(); return; }
      if (!annulDialogRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showAnnul, annulSaving, closeAnnul]);
  useEffect(() => {
    if (!showPayment && returnPaymentFocus.current) {
      returnPaymentFocus.current = false;
      (paymentTriggerRef.current ?? triggerRef.current)?.focus();
    }
  }, [showPayment, selected]);
  useEffect(() => { if (showPayment) paymentDateRef.current?.focus(); }, [showPayment]);
  useEffect(() => {
    if (!showPlan && returnPlanFocus.current) {
      returnPlanFocus.current = false;
      planTriggerRef.current?.focus();
    }
  }, [showPlan]);
  useEffect(() => {
    if (!showPlan) return;
    if (planSaving) planDialogRef.current?.focus();
    else (planDateRef.current ?? planDialogRef.current?.querySelector<HTMLButtonElement>('button'))?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!planSaving) closePlan(); return; }
      if (event.key !== 'Tab' || !planDialogRef.current) return;
      const focusable = Array.from(planDialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first || !last) { event.preventDefault(); planDialogRef.current.focus(); return; }
      if (!planDialogRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showPlan, planSaving, closePlan]);
  useEffect(() => {
    if (!showPayment) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) closePayment(); return; }
      if (event.key !== 'Tab' || !captureDialogRef.current) return;
      const focusable = Array.from(captureDialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (!captureDialogRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showPayment, busy, closePayment]);

  useEffect(() => {
    if (isNewPayment && !showSelector) return;
    if (skipAutoFetch.current?.search === search && skipAutoFetch.current.page === page) { skipAutoFetch.current = null; return; }
    skipAutoFetch.current = null;
    const request = ++listRequest.current;
    setLoading(true); setListError(''); setRetainRowsOnError(false);
    void reusePendingLoanPage(pendingAutoList, search, page).then((result) => {
      if (request !== listRequest.current) return;
      if (result.page !== page) skipAutoFetch.current = { search, page: result.page };
      setLoanList(result);
    }).catch((cause: unknown) => { if (request === listRequest.current) setListError(errorMessage(cause)); })
      .finally(() => { if (request === listRequest.current) setLoading(false); });
    return () => { ++listRequest.current; };
  }, [search, page, isNewPayment, showSelector]);

  const refreshLoans = () => {
    if (!showSelector || refreshLocked.current) return;
    const request = ++listRequest.current;
    setRefreshing(true); setLoading(false); setListError(''); setRetainRowsOnError(false);
    void refreshPaymentLoanPage(refreshLocked, search, page).then((result) => {
      if (!result || request !== listRequest.current) return;
      if (result.page !== page) skipAutoFetch.current = { search, page: result.page };
      setLoanList(result);
    }).catch((cause: unknown) => {
      if (request !== listRequest.current) return;
      setRetainRowsOnError(true);
      setListError(errorMessage(cause));
    }).finally(() => { setRefreshing(false); });
  };
  const searchLoans = (value: string) => { ++listRequest.current; setSearch(value); setLoanList((current) => ({ ...current, page: 1 })); };

  const select = useCallback(async (loanId: string) => {
    const token = ++selectionToken.current;
    selectedLoanId.current = null;
    ++annulOpenToken.current; setShowAnnul(false); setAnnulTarget(null); setAnnulError(''); annulAttempt.current = null;
    ++planOpenToken.current; setShowPlan(false); setPlanBase(null); setPlanDraft([]); planAttempt.current = null;
    setShowPayment(false); captureAttempt.current = null;
    setSelected(null); setSelecting(true); setError(''); setSelectionError(null); setMethodId(''); setPlanSuccess('');
    try {
      const context = await loadActivePaymentContext(loanId, () => token === selectionToken.current);
      if (!context) return;
      selectedLoanId.current = context.summary.loanId;
      setSelected(context);
      setMethodId(context.preferredMethod.activeMethods.some((method) => method.id === context.preferredMethod.id) ? context.preferredMethod.id ?? '' : '');
    } catch (cause) { if (token === selectionToken.current) { setSelectionError({ id: loanId, message: errorMessage(cause) }); setError(errorMessage(cause)); triggerRef.current?.focus(); } }
    finally { if (token === selectionToken.current) setSelecting(false); }
  }, []);
  useEffect(() => {
    if (!isNewPayment) return;
    if (urlLoanId) void select(urlLoanId);
    else { ++selectionToken.current; ++planOpenToken.current; selectedLoanId.current = null; setSelected(null); setSelecting(false); setSelectionError(null); }
    return () => { ++selectionToken.current; };
  }, [isNewPayment, urlLoanId, select]);
  const clearLoan = () => {
    ++selectionToken.current; ++planOpenToken.current;
    selectedLoanId.current = null;
    setSelected(null); setSelecting(false); setSelectionError(null); setError(''); setPlanSuccess('');
    setShowPayment(false); setShowPlan(false); setPlanBase(null); setPlanDraft([]);
    setSearchParams(paymentSearchWithLoan(searchParams.toString(), null));
  };
  const download = async () => {
    const loanId = selected?.summary.loanId;
    const token = selectionToken.current;
    if (!loanId || selectedLoanId.current !== loanId || !canDownloadPaymentPlan(can) || downloadLock.current?.selection === token) return;
    setDownloadingSelection(token); setError('');
    try { await downloadPaymentPlan(() => selectedLoanId.current, token, () => token === selectionToken.current && selectedLoanId.current === loanId, downloadLock); }
    catch (cause) { if (token === selectionToken.current) setError(errorMessage(cause)); }
    finally { setDownloadingSelection((current) => current === token ? null : current); }
  };
  const register = async () => {
    if (!selected || !amount || !methodId) return;
    setBusy(true); setError('');
    try {
      await paymentApi.create({ loanId: selected.summary.loanId, amount, paymentDate: new Date().toISOString().slice(0, 10), methodId, idempotencyKey: crypto.randomUUID() });
      setSelected(await paymentApi.context(selected.summary.loanId)); setAmount('');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const openPayment = () => {
    if (!selected?.firstOperationalRow || !can('payments.create')) return;
    const today = new Date().toISOString().slice(0, 10);
    setPaymentDate(defaultPaymentDate(selected.firstOperationalRow.dueDate, today));
    setAmount(selected.firstOperationalRow.pendingAmount);
    setMethodId(selected.preferredMethod.activeMethods.some((method) => method.id === selected.preferredMethod.id) ? selected.preferredMethod.id ?? '' : '');
    setCollectorId(''); setError(''); setShowPayment(true);
  };
  const registerSelectedPayment = async () => {
    if (captureLocked.current || !showPayment || !selected || !can('payments.create')) return;
    const payload = paymentCapturePayload(selected, { amount, paymentDate, methodId, collectorId });
    if (!payload) { setError('Revisa la fecha, el monto, la forma de pago y el cobrador. El monto debe ser mayor que cero y no superar el saldo pendiente.'); return; }
    const selection = selectionToken.current;
    const attempt = paymentCaptureAttempt(captureAttempt.current, payload);
    captureAttempt.current = attempt;
    captureLocked.current = true;
    setBusy(true); setError('');
    try {
      await paymentApi.create({ ...payload, idempotencyKey: attempt.key });
      const refreshed = await paymentApi.context(selected.summary.loanId);
      if (selection !== selectionToken.current) return;
      setSelected(refreshed);
      setAmount(''); captureAttempt.current = null; returnPaymentFocus.current = true; setShowPayment(false);
    } catch (cause) { if (selection === selectionToken.current) setError(errorMessage(cause)); }
    finally { captureLocked.current = false; setBusy(false); }
  };
  const openPlan = async () => {
    if (!selected || !can('payments.plan.customize') || showAnnul || annulLocked.current) return;
    const token = ++planOpenToken.current;
    const selection = selectionToken.current;
    try {
      const current = await paymentApi.context(selected.summary.loanId);
      if (token !== planOpenToken.current || selection !== selectionToken.current) return;
      setSelected(current); setPlanBase(planBaselineFromContext(current)); setPlanDraft(planDraftFromEntries(current.combinedPlan));
      planAttempt.current = null; setError(''); setPlanError(''); setPlanSuccess(''); setShowPlan(true);
    } catch (cause) { if (token === planOpenToken.current && selection === selectionToken.current) setError(errorMessage(cause)); }
  };
  const savePlan = async () => {
    if (planLocked.current || !showPlan || !selected || !planBase || !can('payments.plan.customize')) return;
    const selection = selectionToken.current;
    const review = reviewPlanDraft(planBase.financialBalance, planDraft);
    if (!review.canSave) { setPlanError('Revisa las fechas, los montos y el saldo distribuido.'); return; }
    const attempt = planSaveAttempt(planAttempt.current, selected.summary.loanId, planBase, review.entries);
    planAttempt.current = attempt;
    planLocked.current = true; setPlanSaving(true); setPlanError('');
    try {
      const refreshed = await persistPlanAndRefresh(selected.summary.loanId, planBase, review.entries, attempt.key, paymentApi);
      if (selection !== selectionToken.current) return;
      ++planOpenToken.current; setSelected(refreshed); returnPlanFocus.current = true; setShowPlan(false); setPlanBase(null); setPlanDraft([]); planAttempt.current = null;
      setPlanError(''); setPlanSuccess('Plan de pagos actualizado correctamente.');
    } catch (cause) { if (selection === selectionToken.current) setPlanError(cause instanceof PlanRefreshError ? `El plan se guardó, pero no se pudo actualizar el contexto. ${cause.message}` : errorMessage(cause)); }
    finally { planLocked.current = false; setPlanSaving(false); }
  };
  const openAnnul = (paymentId: string) => {
    if (!selected || !can('payments.annul') || annulLocked.current) return;
    const payment = annulmentTarget(selected);
    if (payment?.id !== paymentId) return;
    ++planOpenToken.current;
    ++annulOpenToken.current;
    annulFocusPaymentId.current = paymentId;
    setAnnulTarget({ loanId: selected.summary.loanId, payment }); setAnnulReason(''); setAnnulError(''); setAnnulRetryUncertain(false); annulAttempt.current = null;
    setPlanSuccess(''); setShowAnnul(true);
  };
  const confirmAnnul = async () => {
    if (annulLocked.current || !showAnnul || !annulTarget || !selected || selected.summary.loanId !== annulTarget.loanId || !can('payments.annul')) return;
    const reason = annulReason.trim();
    if (!reason) { setAnnulError('Indica el motivo de la anulación.'); return; }
    const eligible = annulmentTarget(selected)?.id === annulTarget.payment.id;
    const retry = annulRetryUncertain && annulAttempt.current?.fingerprint === JSON.stringify({ paymentId: annulTarget.payment.id, reason });
    if (!eligible && !retry) return;
    const attempt = annulmentAttempt(annulAttempt.current, annulTarget.payment.id, reason);
    annulAttempt.current = attempt;
    const selection = selectionToken.current; const open = annulOpenToken.current;
    await runAnnulOnce(annulLocked, async () => {
      setAnnulSaving(true); setAnnulError('');
      try {
        const result = await submitAnnulment(annulTarget.loanId, annulTarget.payment.id, reason, attempt.key, paymentApi);
        if (selection !== selectionToken.current || open !== annulOpenToken.current) return;
        if (!result.accepted) {
          if (result.context) setSelected(result.context);
          setAnnulRetryUncertain(result.retryUncertain);
          setAnnulError(errorMessage(result.error));
          return;
        }
        setSelected(result.context); setAnnulTarget(null); setAnnulReason(''); annulAttempt.current = null;
        setAnnulRetryUncertain(false); returnAnnulFocus.current = true; setShowAnnul(false);
        setPlanSuccess('Pago anulado correctamente. El saldo y el plan de pagos se actualizaron.');
      } finally { setAnnulSaving(false); }
    });
  };
  const annulEligible = Boolean(annulTarget && selected && selected.summary.loanId === annulTarget.loanId && (annulmentTarget(selected)?.id === annulTarget.payment.id
    || (annulRetryUncertain && annulAttempt.current?.fingerprint === JSON.stringify({ paymentId: annulTarget.payment.id, reason: annulReason.trim() }))));
  return <main className="page-content">{isNewPayment ? (<>
    <div className="payments-intro">
      <header className="payments-intro__heading"><p className="eyebrow">PAGOS</p><h1>Registrar pago</h1></header>
       {!selected && !selectionPending && <section className="payments-intro__card" aria-labelledby="payments-intro-title">
        <div><h2 id="payments-intro-title">Préstamo</h2><p>Selecciona un préstamo activo para comenzar.</p></div>
        <button className="button button--primary" type="button" ref={triggerRef} onClick={() => setShowSelector(true)}>Seleccionar préstamo</button>
      </section>}
    </div>
    {showSelector && <PaymentLoanDialog loans={loans} total={total} page={page} loading={loading} refreshing={refreshing} retainRowsOnError={retainRowsOnError} error={listError} search={search} onSearch={searchLoans} onPage={setPage} onSelect={(id) => { if (annulLocked.current) return; setShowSelector(false); selectPaymentLoanFromDialog(id, urlLoanId, selectionError?.id ?? null, (loanId) => { void select(loanId); }, (loanId) => { selectedLoanId.current = null; setSearchParams(paymentSearchWithLoan(searchParams.toString(), loanId)); }); }} onRefresh={refreshLoans} onClose={closeSelector} dialogRef={dialogRef} searchRef={searchRef} />}
  </>
  ) : <><h1>Pagos</h1>
    {!isNewPayment && <PaymentSelector loans={loans} total={total} page={page} loading={loading} error={listError} search={search} onSearch={searchLoans} onPage={setPage} onSelect={(id) => { void select(id); }} />}
  </>}
    {isNewPayment && (urlError || (urlLoanId && selectionError?.id === urlLoanId && selectionError.message)) && <p role="alert">{urlError || selectionError?.message}</p>}
    {error && !showPayment && (!isNewPayment || selected) && <p role="alert">{error}</p>}
    {planSuccess && <div className="success-message" role="status">{planSuccess}</div>}
    {(selectionPending || (!isNewPayment && selecting)) && <p role="status">Cargando contexto de pago…</p>}
    {selected && <div ref={detailsRef} tabIndex={-1}>{isNewPayment
      ? <SelectedPaymentDetails context={selected} canCreate={can('payments.create')} canCustomize={can('payments.plan.customize')} canAnnul={can('payments.annul')} canExport={canDownloadPaymentPlan(can)} annulBusy={annulSaving} downloadBusy={downloadingSelection === selectionToken.current} onPay={openPayment} onCustomize={() => { void openPlan(); }} onAnnul={openAnnul} onDownload={() => { void download(); }} onChangeLoan={() => { if (annulLocked.current) return; clearLoan(); setShowSelector(true); }} onCloseLoan={() => { if (annulLocked.current) return; if (showAnnul) closeAnnul(); clearLoan(); setShowSelector(false); }} triggerRef={triggerRef} paymentTriggerRef={paymentTriggerRef} planTriggerRef={planTriggerRef} annulTriggerRef={annulTriggerRef} />
      : <><button type="button" onClick={() => { selectionToken.current += 1; setSelected(null); setError(''); }}>Cerrar préstamo</button><PaymentDetails context={selected} canCreate={can('payments.create')} amount={amount} methodId={methodId} busy={busy} onAmount={setAmount} onMethod={setMethodId} onSubmit={() => { void register(); }} /></>}
    </div>}
    {isNewPayment && showPayment && selected?.firstOperationalRow && can('payments.create') && <PaymentCaptureDialog
      context={selected} entry={selected.firstOperationalRow} visibleNumber={paymentTimeline(selected).findIndex((row) => row.kind === 'PLAN_ENTRY' && row.id === selected.firstOperationalRow?.id) + 1} amount={amount} paymentDate={paymentDate} methodId={methodId} collectorId={collectorId} busy={busy} error={error}
      onAmount={setAmount} onDate={setPaymentDate} onMethod={setMethodId} onCollector={setCollectorId} onSubmit={() => { void registerSelectedPayment(); }} onClose={closePayment}
      dialogRef={captureDialogRef} dateRef={paymentDateRef} today={new Date().toISOString().slice(0, 10)} />}
    {isNewPayment && showPlan && selected && planBase && can('payments.plan.customize') && <PaymentPlanEditorDialog
      draft={planDraft} balance={planBase.financialBalance} busy={planSaving} error={planError}
      onChange={(draft) => { setPlanDraft(draft); setPlanError(''); }} onAdd={() => { setPlanDraft((draft) => [...draft, { key: crypto.randomUUID(), id: null, dueDate: localDateOnly(), pendingAmount: '' }]); setPlanError(''); }}
      onSave={() => { void savePlan(); }} onClose={closePlan} dialogRef={planDialogRef} dateRef={planDateRef} />}
    {isNewPayment && showAnnul && selected && annulTarget && selected.summary.loanId === annulTarget.loanId && can('payments.annul') && <PaymentAnnulDialog
      context={selected} payment={annulTarget.payment} reason={annulReason} busy={annulSaving} eligible={annulEligible} error={annulError}
      onReason={setAnnulReason} onSubmit={() => { void confirmAnnul(); }} onClose={closeAnnul} dialogRef={annulDialogRef} reasonRef={annulReasonRef} />}
  </main>;
}
