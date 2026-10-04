import { createRef, isValidElement, type ChangeEvent, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PaymentContext, PaymentLoan } from '../../infrastructure/api/payment.api';
import { PaymentAnnulDialog, PaymentCaptureDialog, PaymentDetails, PaymentLoanDialog, PaymentSelector, PaymentsPage, SelectedPaymentDetails, annulmentAttempt, annulmentTarget, canDownloadPaymentPlan, defaultPaymentDate, downloadPaymentPlan, paymentCaptureAttempt, paymentCapturePayload, runAnnulOnce, submitAnnulment } from './PaymentsPage';
import { loadPaymentLoanPage, refreshPaymentLoanPage, reusePendingLoanPage } from '../helpers/payment-loan-selector';
import { MoneyInput } from '../components/MoneyInput';
import { PaymentPlanEditorDialog } from '../components/PaymentPlanEditorDialog';
import { PaymentPlanDraftFields } from '../components/PaymentPlanDraftFields';
import { TableActions, type TableAction } from '../components/TableActions';
import { localDateOnly, paymentTimeline, persistPlanAndRefresh, planBaselineFromContext, planDraftFromEntries, orderedPlanDraft, planSaveAttempt, PlanRefreshError, reviewPlanDraft, type PlanDraftEntry } from '../helpers/payment-plan';
import { canAccess } from '../hooks/auth-permissions';
import { loadActivePaymentContext, paymentLoanIdFromSearch } from '../helpers/payment-loan-link';
import type { AuthIdentity } from '../../domain/entities/auth';

vi.mock('../hooks/auth-context', () => ({ useAuth: () => ({ can: () => true }) }));

const loan: PaymentLoan = { id: 'loan-1', loanNumber: '7', identification: '101', customerName: 'Ana', financialBalance: '60.00', isOverdue: true };
const context: PaymentContext = {
  summary: { loanId: 'loan-1', loanNumber: '7', identification: '101', customerName: 'Ana', totalAmount: '100.00', interestAmount: '30.00' },
  balances: { financialBalance: '60.00', outstandingPrincipal: '30.00', outstandingInterest: '30.00' },
  combinedPlan: [{ id: 'entry', sequence: 2, dueDate: '2020-01-01', pendingAmount: '60.00' }],
  validPayments: [{ id: 'payment', paymentDate: '2020-01-02', amount: '40.00', status: 'VALID' }],
  firstOperationalRow: { id: 'entry', sequence: 2, dueDate: '2020-01-01', pendingAmount: '60.00' },
  lastValidPayment: { id: 'payment', paymentDate: '2020-01-02', amount: '40.00', status: 'VALID' },
  refinanceEligibility: true,
  preferredMethod: { id: 'cash', activeMethods: [{ id: 'cash', name: 'Efectivo' }, { id: 'card', name: 'Tarjeta' }], collectors: [{ id: 'collector-1', name: 'María' }] },
};
const noop = vi.fn();
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node)
  ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];

describe('payment selection presentation', () => {
  const selector = (options: Partial<Parameters<typeof PaymentSelector>[0]> = {}) => renderToStaticMarkup(<PaymentSelector
    loans={[loan]} total={21} page={2} loading={false} error="" search="Ana" onSearch={noop} onPage={noop} onSelect={noop} {...options} />);
  const dialogProps = (options: Partial<Parameters<typeof PaymentLoanDialog>[0]> = {}): Parameters<typeof PaymentLoanDialog>[0] => ({
    loans: [{ ...loan, financialBalance: '60000.00' }], total: 21, page: 2, loading: false, refreshing: false, retainRowsOnError: false, error: '', search: 'Ana',
    onSearch: noop, onPage: noop, onSelect: noop, onRefresh: noop, onClose: noop,
    dialogRef: createRef<HTMLDivElement>(), searchRef: createRef<HTMLInputElement>(), ...options,
  });
  const dialog = (options: Partial<Parameters<typeof PaymentLoanDialog>[0]> = {}) => renderToStaticMarkup(<PaymentLoanDialog {...dialogProps(options)} />);
  const selectedProps = (options: Partial<Parameters<typeof SelectedPaymentDetails>[0]> = {}): Parameters<typeof SelectedPaymentDetails>[0] => ({
    context, canCreate: true, canCustomize: false, canAnnul: false, canExport: false, annulBusy: false, downloadBusy: false, onPay: noop, onCustomize: noop, onAnnul: noop, onDownload: noop,
    onChangeLoan: noop, onCloseLoan: noop, triggerRef: createRef<HTMLButtonElement>(), paymentTriggerRef: createRef<HTMLButtonElement>(), planTriggerRef: createRef<HTMLButtonElement>(), annulTriggerRef: createRef<HTMLButtonElement>(), ...options,
  });
  const selected = (options: Partial<Parameters<typeof SelectedPaymentDetails>[0]> = {}) => renderToStaticMarkup(<SelectedPaymentDetails {...selectedProps(options)} />);
  const captureProps = (options: Partial<Parameters<typeof PaymentCaptureDialog>[0]> = {}): Parameters<typeof PaymentCaptureDialog>[0] => ({
    context, entry: context.firstOperationalRow!, visibleNumber: 2, amount: '60.00', paymentDate: '2020-01-01', methodId: 'cash', collectorId: '', busy: false, error: '',
    onAmount: noop, onDate: noop, onMethod: noop, onCollector: noop, onSubmit: noop, onClose: noop,
    dialogRef: createRef<HTMLDivElement>(), dateRef: createRef<HTMLInputElement>(), today: '2026-09-28', ...options,
  });

  it('shows the introductory card only on the new-payment route before loan selection', () => {
    const initial = renderToStaticMarkup(<MemoryRouter initialEntries={['/payments/new']}><PaymentsPage /></MemoryRouter>);
    expect(initial).toContain('PAGOS');
    expect(initial).toContain('<h1>Registrar pago</h1>');
    expect(initial).toContain('<h2 id="payments-intro-title">Préstamo</h2>');
    expect(initial).toContain('Selecciona un préstamo activo para comenzar.');
    expect(initial).toContain('>Seleccionar préstamo</button>');
    expect(initial).not.toContain('aria-label="Seleccionar préstamo"');
    expect(initial).not.toContain('role="dialog"');
    expect(initial).not.toContain('Refrescar préstamos');
    expect(initial).not.toContain('Descargar plan de pago');

    const existingRoute = renderToStaticMarkup(<MemoryRouter initialEntries={['/payments']}><PaymentsPage /></MemoryRouter>);
    expect(existingRoute).toContain('aria-label="Seleccionar préstamo"');
    expect(existingRoute).toContain('Buscar préstamo, identificación o cliente');
    expect(existingRoute).not.toContain('role="dialog"');
    expect(existingRoute).not.toContain('Refrescar préstamos');
    expect(existingRoute).not.toContain('payments-intro__card');
  });

  it('holds the intro card during a direct UUID selection without opening a selector or capture dialog', () => {
    const id = '14870d77-8723-49e5-96b8-e4313943d726';
    const pending = renderToStaticMarkup(<MemoryRouter initialEntries={[`/payments/new?loanId=${id}`]}><PaymentsPage /></MemoryRouter>);
    expect(pending).toContain('<h1>Registrar pago</h1>');
    expect(pending).toContain('Cargando contexto de pago…');
    expect(pending).not.toContain('payments-intro__card');
    expect(pending).not.toContain('role="dialog"');
    expect(pending).not.toContain('aria-label="Seleccionar préstamo"');
    expect(pending).not.toContain('Descargar plan de pago');
    const uppercase = renderToStaticMarkup(<MemoryRouter initialEntries={[`/payments/new?loanId=${id.toUpperCase()}`]}><PaymentsPage /></MemoryRouter>);
    expect(uppercase).toContain('Cargando contexto de pago…');
    expect(uppercase).not.toContain('payments-intro__card');
    for (const search of ['?loanId=', '?loanId=bad', `?loanId=${id}&loanId=${id}`]) {
      const invalid = renderToStaticMarkup(<MemoryRouter initialEntries={[`/payments/new${search}`]}><PaymentsPage /></MemoryRouter>);
      expect(invalid).toContain('role="alert">El identificador del préstamo no es válido.');
      expect(invalid).toContain('>Seleccionar préstamo</button>');
      expect(invalid).not.toContain('Cargando contexto de pago…');
      expect(invalid).not.toContain('Descargar plan de pago');
    }
  });

  it('requires both existing loan permissions and keeps superadmin authorization centralized', () => {
    const user: AuthIdentity = { id: 'u', username: 'u', fullName: 'User', role: { id: 'r', code: 'STAFF', name: 'Staff', isSuperAdmin: false }, permissions: [] };
    const allowed = (identity: AuthIdentity) => canDownloadPaymentPlan((permission) => canAccess(identity, permission));
    for (const permissions of [[], ['loans.export'], ['loans.view']]) {
      expect(allowed({ ...user, permissions })).toBe(false);
      expect(selected({ canExport: allowed({ ...user, permissions }) })).not.toContain('Descargar plan de pago');
    }
    expect(allowed({ ...user, permissions: ['loans.export', 'loans.view'] })).toBe(true);
    expect(allowed({ ...user, role: { ...user.role, isSuperAdmin: true } })).toBe(true);
    expect(selected({ canExport: true })).toContain('aria-label="Descargar plan de pago"');
  });

  it('places the compact export beside plan customization without removing payment or annul actions', () => {
    const onDownload = vi.fn(); const onCustomize = vi.fn();
    const markup = selected({ canExport: true, canCustomize: true, canAnnul: true });
    expect(markup).toMatch(/Personalizar plan.*title="Descargar plan de pago"/);
    expect(markup).toContain('aria-label="Descargar plan de pago"');
    expect(markup).toContain('Pagar cuota 1');
    expect(markup).toContain('Anular pago del 02/01/2020');
    expect(markup).toContain('Cambiar préstamo');
    expect(markup).toContain('Cerrar préstamo');
    const tree = elements(SelectedPaymentDetails(selectedProps({ canExport: true, canCustomize: true, onDownload, onCustomize })));
    (tree.find((element) => element.type === 'button' && (element.props as { onClick?: () => void; title?: string }).title === 'Descargar plan de pago')!.props as { onClick: () => void }).onClick();
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onCustomize).not.toHaveBeenCalled();
    expect(selected({ canExport: true, downloadBusy: true })).toMatch(/aria-label="Descargar plan de pago"[^>]*aria-busy="true" disabled=""/);
    expect(selected({ canExport: true, downloadBusy: true })).toContain('Descargando…');
  });

  it('downloads exactly once using the resolved deep-link loan ID and a fresh canonical detail', async () => {
    const id = '14870d77-8723-49e5-96b8-e4313943d726';
    const parsed = paymentLoanIdFromSearch(`loanId=${id.toUpperCase()}`);
    const resolved = await loadActivePaymentContext(parsed.id!, () => true, {
      context: vi.fn().mockResolvedValue({ ...context, summary: { ...context.summary, loanId: id, status: 'ACTIVE' } }),
    });
    expect(resolved?.summary.loanId).toBe(id);
    let selectedId: string | null = resolved!.summary.loanId;
    let finish!: (detail: { id: string }) => void;
    const api = { detail: vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; })) };
    const report = vi.fn().mockResolvedValue(undefined);
    const lock = { current: null as { selection: number } | null };
    const first = downloadPaymentPlan(() => selectedId, 1, () => true, lock, api, report);
    await downloadPaymentPlan(() => selectedId, 1, () => true, lock, api, report);
    expect(api.detail).toHaveBeenCalledExactlyOnceWith(id);
    expect(report).not.toHaveBeenCalled();
    finish({ id }); await first;
    expect(report).toHaveBeenCalledExactlyOnceWith({ id });
    expect(lock.current).toBeNull();
    selectedId = null;
    await downloadPaymentPlan(() => selectedId, 2, () => true, lock, api, report);
    expect(api.detail).toHaveBeenCalledTimes(1);
  });

  it('reads the latest selected ID, ignores stale results and errors, and allows the next loan while the first is pending', async () => {
    let selectedId = 'loan-a'; let selection = 1;
    let finishA!: (detail: { id: string }) => void;
    const api = { detail: vi.fn().mockImplementation((id: string) => id === 'loan-a'
      ? new Promise((resolve) => { finishA = resolve; }) : Promise.resolve({ id })) };
    const report = vi.fn().mockResolvedValue(undefined);
    const lock = { current: null as { selection: number } | null };
    const start = () => {
      const token = selection; const id = selectedId;
      return downloadPaymentPlan(() => selectedId, token, () => token === selection && selectedId === id, lock, api, report);
    };
    const stale = start();
    selectedId = 'loan-b'; selection = 2;
    await start();
    finishA({ id: 'loan-a' }); await stale;
    expect(api.detail.mock.calls).toEqual([['loan-a'], ['loan-b']]);
    expect(report).toHaveBeenCalledExactlyOnceWith({ id: 'loan-b' });
    expect(lock.current).toBeNull();
    const rejected = { detail: vi.fn().mockRejectedValue(new Error('Connection lost')) };
    selectedId = 'loan-a'; selection = 3;
    const old = downloadPaymentPlan(() => selectedId, selection, () => selectedId === 'loan-a', lock, rejected, report);
    selectedId = 'loan-b';
    await expect(old).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('releases the lock on a current download error and preserves selected-loan payment actions for retry', async () => {
    const api = { detail: vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({ id: 'loan-1' }) };
    const report = vi.fn().mockResolvedValue(undefined);
    const lock = { current: null as { selection: number } | null };
    const download = () => downloadPaymentPlan(() => context.summary.loanId, 1, () => true, lock, api, report);
    await expect(download()).rejects.toThrow('Connection lost');
    expect(lock.current).toBeNull();
    const markup = selected({ canCreate: true, canCustomize: true, canAnnul: true, canExport: true });
    expect(markup).toContain('Descargar plan de pago');
    expect(markup).toContain('Pagar cuota 1');
    expect(markup).toContain('Personalizar plan');
    expect(markup).toContain('Anular pago');
    await download();
    expect(api.detail).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledExactlyOnceWith({ id: 'loan-1' });
  });

  it('renders an accessible modal with exactly six institutional columns and formatted loan details', () => {
    const markup = dialog();
    expect(markup).toContain('role="dialog" aria-modal="true" aria-labelledby="payment-loan-dialog-title"');
    expect(markup).toContain('id="payment-loan-dialog-title">Seleccionar préstamo activo</h2>');
    expect(markup).toContain('placeholder="N.º préstamo, identificación, nombre o teléfono"');
    expect([...markup.matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1])).toEqual(['N°', 'Identificación', 'Cliente', 'Saldo pendiente', 'Condición', 'Acción']);
    expect(markup).toContain('<td>#7</td><td>101</td><td>Ana</td><td>₡60.000,00</td>');
    expect(markup).toContain('payment-loan-dialog__late">Con atraso</span>');
    expect(dialog({ loans: [{ ...loan, isOverdue: false }] })).toContain('status-badge--active">Al día</span>');
    expect(markup).toContain('aria-label="Seleccionar préstamo 7">Seleccionar</button>');
    expect(markup).toContain('aria-label="Refrescar préstamos" title="Refrescar préstamos"');
    expect(markup).toContain('>Refrescar</button>');
    expect(markup).toContain('>Cerrar</button>');
    expect(markup).not.toContain('>Cancelar</button>');
    expect(markup).toContain('<footer class="payment-loan-dialog__footer"><nav aria-label="Páginas de préstamos">');
    expect(markup).toContain('Página 2 de 2 · 21 préstamos');
  });

  it('wires modal search, paging, selection, refresh, and close', () => {
    const onSearch = vi.fn(); const onPage = vi.fn(); const onSelect = vi.fn(); const onClose = vi.fn(); const onRefresh = vi.fn();
    const tree = elements(PaymentLoanDialog(dialogProps({ onSearch, onPage, onSelect, onClose, onRefresh })));
    const input = tree.find((element) => element.type === 'input')!;
    (input.props as { onChange: (event: ChangeEvent<HTMLInputElement>) => void }).onChange({ target: { value: '8888-8888' } } as ChangeEvent<HTMLInputElement>);
    expect(onSearch).toHaveBeenCalledWith('8888-8888');
    const button = (label: string) => tree.find((element) => element.type === 'button' && (element.props as { children?: ReactNode }).children === label)!;
    (button('Anterior').props as { onClick: () => void }).onClick();
    expect(onPage).toHaveBeenCalledWith(1);
    (button('Seleccionar').props as { onClick: () => void }).onClick();
    expect(onSelect).toHaveBeenCalledWith('loan-1');
    const refresh = tree.find((element) => element.type === 'button' && (element.props as { 'aria-label'?: string })['aria-label'] === 'Refrescar préstamos')!;
    (refresh.props as { onClick: () => void }).onClick();
    expect(onRefresh).toHaveBeenCalledOnce();
    (button('Cerrar').props as { onClick: () => void }).onClick();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps modal pagination and close visible while loading, empty, or failed', () => {
    for (const options of [{ loading: true }, { loans: [], total: 0 }, { error: 'Request failed' }]) {
      const markup = dialog(options);
      expect(markup).toContain('Página 2 de');
      expect(markup).toContain('>Cerrar</button>');
    }
    expect(dialog({ loading: true })).toContain('Cargando préstamos');
    expect(dialog({ loans: [], total: 0 })).toContain('No se encontraron préstamos activos');
    expect(dialog({ error: 'Request failed' })).toContain('Request failed');
  });

  it('keeps the loan rows and modal controls interactive while manual refresh is pending', () => {
    const markup = dialog({ refreshing: true });
    expect(markup).toMatch(/aria-label="Refrescar préstamos"[^>]*aria-busy="true" disabled=""/);
    expect(markup).toContain('payment-loan-dialog__refresh-icon--spinning');
    expect(markup).toContain('role="status">Actualizando préstamos…');
    expect(markup).toContain('>Con atraso</span>');
    expect(markup).toContain('aria-label="Seleccionar préstamo 7"');
    expect(markup).toContain('>Cerrar</button>');
    expect(markup).not.toContain('Cargando préstamos…');
  });

  it('keeps the previous rows, balance, search, and page on refresh failure with an alert', () => {
    const markup = dialog({ retainRowsOnError: true, error: 'No fue posible actualizar la lista.' });
    expect(markup).toContain('role="alert">No fue posible actualizar la lista.');
    expect(markup).toContain('value="Ana"');
    expect(markup).toContain('₡60.000,00');
    expect(markup).toContain('>Con atraso</span>');
    expect(markup).toContain('Página 2 de 2 · 21 préstamos');
    expect(markup).not.toMatch(/aria-label="Refrescar préstamos"[^>]*disabled/);
  });

  it('replaces server-provided overdue condition, balance, total, and rows after a fresh selector GET without loading context', async () => {
    const current = { ...loan, isOverdue: false, financialBalance: '25.50' };
    const api = { listLoans: vi.fn().mockResolvedValue({ items: [current], total: 1, page: 1, pageSize: 20 }), context: vi.fn() };
    const result = await loadPaymentLoanPage('Ana 101', 1, api);
    expect(api.listLoans).toHaveBeenCalledExactlyOnceWith('Ana 101', 1, 20);
    expect(api.context).not.toHaveBeenCalled();
    expect(result).toEqual({ loans: [current], total: 1, page: 1 });
    const markup = dialog({ ...result, search: 'Ana 101' });
    expect(markup).toContain('value="Ana 101"');
    expect(markup).toContain('₡25,50');
    expect(markup).toContain('>Al día</span>');
    expect(markup).not.toContain('>Con atraso</span>');
    expect(markup).toContain('Página 1 de 1 · 1 préstamos');
  });

  it('keeps a valid current page without another GET, or clamps and re-fetches only if total shrinks', async () => {
    const api = { listLoans: vi.fn()
      .mockResolvedValueOnce({ items: [loan], total: 46, page: 2, pageSize: 20 })
      .mockResolvedValueOnce({ items: [], total: 17, page: 3, pageSize: 20 })
      .mockResolvedValueOnce({ items: [{ ...loan, loanNumber: '17' }], total: 17, page: 1, pageSize: 20 }) };
    expect(await loadPaymentLoanPage('Ana', 2, api)).toMatchObject({ loans: [loan], total: 46, page: 2 });
    expect(api.listLoans).toHaveBeenCalledTimes(1);
    const clamped = await loadPaymentLoanPage('Ana', 3, api);
    expect(api.listLoans.mock.calls).toEqual([['Ana', 2, 20], ['Ana', 3, 20], ['Ana', 1, 20]]);
    expect(clamped).toMatchObject({ loans: [{ loanNumber: '17' }], total: 17, page: 1 });
    expect(dialog({ ...clamped })).toContain('Página 1 de 1 · 17 préstamos');
    expect(dialog({ ...clamped })).toContain('<td>#17</td>');
    expect(dialog({ ...clamped })).not.toContain('<td>#7</td>');

    const lastValid = { listLoans: vi.fn()
      .mockResolvedValueOnce({ items: [], total: 37, page: 3, pageSize: 20 })
      .mockResolvedValueOnce({ items: [loan], total: 37, page: 2, pageSize: 20 }) };
    expect(await loadPaymentLoanPage('Ana', 3, lastValid)).toMatchObject({ loans: [loan], total: 37, page: 2 });
    expect(lastValid.listLoans.mock.calls).toEqual([['Ana', 3, 20], ['Ana', 2, 20]]);
    const empty = { listLoans: vi.fn()
      .mockResolvedValueOnce({ items: [], total: 0, page: 2, pageSize: 20 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 }) };
    expect(await loadPaymentLoanPage('Ana', 2, empty)).toEqual({ loans: [], total: 0, page: 1 });
  });

  it('prevents overlapping manual refreshes and unlocks after rejection without publishing partial results', async () => {
    let resolve!: (value: { items: PaymentLoan[]; total: number; page: number; pageSize: number }) => void;
    const pending = new Promise<{ items: PaymentLoan[]; total: number; page: number; pageSize: number }>((done) => { resolve = done; });
    const api = { listLoans: vi.fn().mockReturnValueOnce(pending).mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({ items: [loan], total: 1, page: 1, pageSize: 20 }) };
    const lock = { current: false };
    const first = refreshPaymentLoanPage(lock, 'Ana', 2, api);
    expect(lock.current).toBe(true);
    expect(await refreshPaymentLoanPage(lock, 'Ana', 2, api)).toBeUndefined();
    expect(api.listLoans).toHaveBeenCalledTimes(1);
    resolve({ items: [], total: 1, page: 2, pageSize: 20 });
    await expect(first).rejects.toThrow('Connection lost');
    expect(api.listLoans.mock.calls).toEqual([['Ana', 2, 20], ['Ana', 1, 20]]);
    expect(lock.current).toBe(false);
    expect(await refreshPaymentLoanPage(lock, 'Ana', 1, api)).toMatchObject({ loans: [loan], total: 1, page: 1 });
  });

  it('shares only an in-flight automatic GET for the same search and page, then permits a new GET', async () => {
    let resolve!: (value: { items: PaymentLoan[]; total: number; page: number; pageSize: number }) => void;
    const api = { listLoans: vi.fn().mockReturnValueOnce(new Promise((done) => { resolve = done; }))
      .mockResolvedValueOnce({ items: [loan], total: 1, page: 1, pageSize: 20 }) };
    const pending: { current: { search: string; page: number; promise: Promise<{ loans: PaymentLoan[]; total: number; page: number }> } | null } = { current: null };
    const first = reusePendingLoanPage(pending, 'Ana', 1, api);
    expect(reusePendingLoanPage(pending, 'Ana', 1, api)).toBe(first);
    expect(api.listLoans).toHaveBeenCalledTimes(1);
    resolve({ items: [loan], total: 1, page: 1, pageSize: 20 });
    await first;
    expect(pending.current).toBeNull();
    await reusePendingLoanPage(pending, 'Ana', 1, api);
    expect(api.listLoans).toHaveBeenCalledTimes(2);
  });

  it('renders the active selector, filtered search, overdue condition, and pagination', () => {
    const markup = selector();
    expect(markup).toContain('value="Ana"');
    expect(markup).toContain('Identificación');
    expect(markup).toContain('Saldo pendiente');
    expect(markup).toContain('60.00');
    expect(markup).toContain('Con atraso');
    expect(selector({ loans: [{ ...loan, isOverdue: false }] })).toContain('Al día');
    expect(markup).toContain('Seleccionar préstamo 7');
    expect(markup).toContain('Página 2 de 2 · 21 préstamos');
  });

  it('wires searching, previous page, and loan selection to the supplied actions', () => {
    const onSearch = vi.fn(); const onPage = vi.fn(); const onSelect = vi.fn();
    const tree = elements(PaymentSelector({ loans: [loan], total: 21, page: 2, loading: false, error: '', search: 'Ana', onSearch, onPage, onSelect }));
    const searchInput = tree.find((element) => element.type === 'input')!;
    (searchInput.props as { onChange: (event: ChangeEvent<HTMLInputElement>) => void }).onChange({ target: { value: '101' } } as ChangeEvent<HTMLInputElement>);
    expect(onSearch).toHaveBeenCalledWith('101');
    const previous = tree.find((element) => element.type === 'button' && (element.props as { children?: ReactNode }).children === 'Anterior')!;
    (previous.props as { onClick: () => void }).onClick();
    expect(onPage).toHaveBeenCalledWith(1);
    const actions = tree.find((element) => element.type === TableActions)!.props as { actions: TableAction[] };
    actions.actions[0].onClick?.();
    expect(onSelect).toHaveBeenCalledWith('loan-1');
  });

  it('distinguishes loading, empty results, and failed requests', () => {
    expect(selector({ loading: true })).toContain('Cargando préstamos');
    expect(selector({ loans: [], total: 0 })).toContain('No se encontraron préstamos activos');
    const failed = selector({ loans: [], error: 'Request failed' });
    expect(failed).toContain('Request failed');
    expect(failed).not.toContain('No se encontraron préstamos activos');
  });

  it('renders valid payments alongside positive current obligations without reading selected.payments', () => {
    const props = { context, canCreate: true, amount: '', methodId: 'cash', collectorId: '', busy: false, onAmount: noop, onMethod: noop, onCollector: noop, onSubmit: noop };
    const markup = renderToStaticMarkup(<PaymentDetails {...props} />);
    expect(markup).toContain('Ana');
    expect(markup).toContain('Capital pendiente (valor actual): 30.00');
    expect(markup).toContain('Interés pendiente: 30.00');
    expect(markup).toContain('Cuota vencida: 60.00');
    expect(markup).toContain('Pago válido: 40.00');
    expect(markup).toContain('Efectivo');
    expect(markup).toContain('Elegible para refinanciar: Sí');
    expect(renderToStaticMarkup(<PaymentDetails {...props} context={{ ...context, validPayments: [], combinedPlan: [], firstOperationalRow: null, lastValidPayment: null }} canCreate={false} />)).toContain('No hay pagos válidos ni cuotas pendientes');
  });

  it('shows the selected loan summary using only contracted balances, dates, and eligibility', () => {
    const markup = selected({ context: { ...context, summary: { ...context.summary, interestAmount: '2700.00' }, balances: { outstandingPrincipal: '12500.00', outstandingInterest: '20000.00', financialBalance: '32500.00' } } });
    expect(markup).toContain('id="payment-selected-loan">Ana</h2>');
    expect(markup).toContain('Préstamo #7');
    expect(markup).not.toContain('Préstamo #loan-1');
    expect(markup).toContain('<dt>Próximo vencimiento</dt><dd>01/01/2020</dd>');
    expect(markup).toContain('<dt>Capital pendiente</dt><dd>₡12.500,00</dd>');
    expect(markup).toContain('<dt>Interés pendiente</dt><dd>₡20.000,00</dd>');
    expect(markup).toContain('<dt>Saldo pendiente</dt><dd>₡32.500,00</dd>');
    expect(markup).toContain('>Con atraso</span>');
    expect(markup).toContain('>APTO</span>');
    expect(markup).toContain('>Cambiar préstamo</button>');
    expect(markup).toContain('>Cerrar préstamo</button>');
    expect(markup).not.toMatch(/Personalizar plan|Estado de cuenta|Refinanciar/);

    const empty = selected({ context: { ...context, balances: { outstandingPrincipal: '', outstandingInterest: '', financialBalance: '' }, combinedPlan: [], firstOperationalRow: null, validPayments: [], lastValidPayment: null, refinanceEligibility: false } });
    expect(empty).toContain('<dt>Próximo vencimiento</dt><dd>—</dd>');
    expect(empty).toContain('<dt>Capital pendiente</dt><dd>—</dd>');
    expect(empty).toContain('<dt>Interés pendiente</dt><dd>—</dd>');
    expect(empty).toContain('<dt>Saldo pendiente</dt><dd>—</dd>');
    expect(empty).toContain('>Al día</span>');
    expect(empty).toContain('>NO APTO</span>');
    expect(empty).toContain('No hay pagos válidos ni cuotas pendientes.');
  });

  it('combines valid payments and positive obligations into dated, numbered rows while preserving history', () => {
    const markup = selected({ context: { ...context, combinedPlan: [context.combinedPlan[0], { id: 'future', sequence: 3, dueDate: '9999-12-31', pendingAmount: '12.50' }] } });
    const body = markup.split('<tbody>')[1].split('</tbody>')[0];
    const rows = body.match(/<tr>.*?<\/tr>/g) ?? [];
    expect([...markup.matchAll(/<th scope="col">(.*?)<\/th>/g)].map((match) => match[1])).toEqual(['N.º', 'Fecha', 'Monto pendiente', 'Monto pagado', 'Estado', 'Acción']);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('<td>1</td><td>01/01/2020</td><td>₡60,00</td><td>—</td>');
    expect(rows[0]).toContain('>VENCIDA</span>');
    expect(rows[0]).toContain('aria-label="Pagar cuota 1"');
    expect(rows[0]).toContain('title="Pagar cuota 1"');
    expect(body.match(/aria-label="Pagar cuota/g)).toHaveLength(1);
    expect(rows[1]).toContain('<td>2</td><td>02/01/2020</td><td>—</td><td>₡40,00</td>');
    expect(rows[1]).toContain('>PAGADA</span>');
    expect(rows[1]).not.toContain('Pagar cuota');
    expect(rows[2]).toContain('<td>3</td><td>31/12/9999</td><td>₡12,50</td><td>—</td>');
    expect(rows[2]).toContain('>PENDIENTE</span>');
    expect(rows[2]).not.toContain('Pagar cuota');
    expect(markup).toContain('<summary>Pagos válidos</summary>');
    expect(markup).toContain('02/01/2020 · Pago válido: ₡40,00');
    expect(selected({ canCreate: false })).not.toContain('Pagar cuota');
    expect(selected({ canCustomize: true })).toContain('>Personalizar plan</button>');
    expect(selected({ canCustomize: false })).not.toContain('Personalizar plan');
    expect(markup).not.toContain('payment-selected__form');
  });

  it('opens payment capture only from the first operational row and retains loan actions', () => {
    const onPay = vi.fn(); const onChangeLoan = vi.fn(); const onCloseLoan = vi.fn();
    const paymentTriggerRef = createRef<HTMLButtonElement>();
    const tree = elements(SelectedPaymentDetails(selectedProps({ onChangeLoan, onCloseLoan, onPay, paymentTriggerRef })));
    const button = (label: string) => tree.find((element) => element.type === 'button' && (element.props as { children?: ReactNode }).children === label)!;
    (button('Cambiar préstamo').props as { onClick: () => void }).onClick();
    (button('Cerrar préstamo').props as { onClick: () => void }).onClick();
    expect(onChangeLoan).toHaveBeenCalledOnce();
    expect(onCloseLoan).toHaveBeenCalledOnce();
    const actions = tree.find((element) => element.type === TableActions)!.props as { actions: TableAction[] };
    expect(actions.actions).toMatchObject([{ icon: 'payment', ariaLabel: 'Pagar cuota 1', buttonRef: paymentTriggerRef }]);
    actions.actions[0].onClick?.();
    expect(onPay).toHaveBeenCalledOnce();
  });

  it('uses the refreshed firstOperationalRow rather than the earliest displayed row', () => {
    const future = { id: 'future', sequence: 3, dueDate: '9999-12-31', pendingAmount: '12.50' };
    const markup = selected({ context: { ...context, combinedPlan: [context.combinedPlan[0], future], firstOperationalRow: future } });
    const rows = markup.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>.*?<\/tr>/g) ?? [];
    expect(rows[0]).toContain('>VENCIDA</span>');
    expect(rows[0]).not.toContain('aria-label="Pagar cuota');
    expect(rows[0]).toContain('<td>—</td></tr>');
    expect(rows[2]).toContain('aria-label="Pagar cuota 3"');
    expect(rows[1]).toContain('>PAGADA</span>');
  });

  it('does not expose a plan mutation when only payment creation is authorized, and wires its authorized trigger', () => {
    const onCustomize = vi.fn();
    const denied = selected({ canCreate: true, canCustomize: false });
    expect(denied).not.toContain('Personalizar plan');
    const tree = elements(SelectedPaymentDetails(selectedProps({ canCreate: false, canCustomize: true, onCustomize })));
    const customize = tree.find((element) => element.type === 'button' && (element.props as { children?: ReactNode }).children === 'Personalizar plan')!;
    (customize.props as { onClick: () => void }).onClick();
    expect(onCustomize).toHaveBeenCalledOnce();
    expect(selected({ canCreate: false, canCustomize: true })).not.toContain('Pagar cuota');
  });

  it('numbers a 120000 payment with multiple applications once, then only the positive 60000 obligation', () => {
    const onePayment = { ...context.validPayments[0], amount: '120000.00', paymentDate: '2026-01-01', applications: [{ amount: '50000.00' }, { amount: '70000.00' }] };
    const positive = { id: 'positive', sequence: 8, dueDate: '2026-01-02', pendingAmount: '60000.00' };
    const projected = { ...context, validPayments: [onePayment], combinedPlan: [
      { id: 'zero-a', sequence: 1, dueDate: '2025-01-01', pendingAmount: '0.00' },
      { id: 'zero-b', sequence: 2, dueDate: '2025-01-02', pendingAmount: '0.00' }, positive,
    ], firstOperationalRow: positive };
    expect(paymentTimeline(projected).map((row) => [row.kind, row.id])).toEqual([['PAYMENT', 'payment'], ['PLAN_ENTRY', 'positive']]);
    const markup = selected({ context: projected });
    const rows = markup.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>.*?<\/tr>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('<td>1</td><td>01/01/2026</td><td>—</td><td>₡120.000,00</td>');
    expect(rows[1]).toContain('<td>2</td><td>02/01/2026</td><td>₡60.000,00</td><td>—</td>');
    expect(rows[1]).toContain('aria-label="Pagar cuota 2"');
    expect(markup).not.toContain('zero-a');
  });

  it('orders equal dates payment-first then by persisted ID and treats today as pending', () => {
    const today = localDateOnly();
    const mixed = { ...context, combinedPlan: [
      { id: 'plan-z', sequence: 0, dueDate: today, pendingAmount: '10.00' },
      { id: 'plan-a', sequence: 99, dueDate: today, pendingAmount: '50.00' },
    ], validPayments: [
      { id: 'pay-z', amount: '5.00', paymentDate: today, status: 'VALID' as const },
      { id: 'pay-a', amount: '5.00', paymentDate: today, status: 'VALID' as const },
    ], firstOperationalRow: { id: 'plan-a', sequence: 99, dueDate: today, pendingAmount: '50.00' } };
    expect(paymentTimeline(mixed).map((row) => row.id)).toEqual(['pay-a', 'pay-z', 'plan-a', 'plan-z']);
    const rows = selected({ context: mixed }).split('<tbody>')[1].split('</tbody>')[0].match(/<tr>.*?<\/tr>/g) ?? [];
    expect(rows[0]).toContain('>PAGADA</span>');
    expect(rows[2]).toContain('>PENDIENTE</span>');
    expect(rows[2]).toContain('Pagar cuota 3');
    expect(localDateOnly(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01');
  });

  it('excludes annulled records even if an unexpected context includes them', () => {
    const unexpected = { ...context, validPayments: [
      ...context.validPayments, { id: 'annulled', amount: '999.00', paymentDate: '2019-01-01', status: 'ANNULLED' },
    ] } as unknown as PaymentContext;
    expect(paymentTimeline(unexpected).map((row) => row.id)).toEqual(['entry', 'payment']);
    expect(selected({ context: unexpected }).split('<tbody>')[1].split('</tbody>')[0]).not.toContain('₡999,00');
  });

  it('renders a compact capture dialog with only four editable fields and no unsupported date minimum', () => {
    const markup = renderToStaticMarkup(<PaymentCaptureDialog {...captureProps()} />);
    expect(markup).toContain('role="dialog" aria-modal="true" aria-labelledby="payment-capture-title"');
    expect(markup).toContain('Cuota operativa N.º 2');
    expect(markup).toContain('Vencimiento: 01/01/2020');
    expect(markup).toContain('Pendiente: ₡60,00');
    expect(markup).toContain('Fecha del pago');
    const dateInput = markup.match(/<input[^>]*type="date"[^>]*>/)?.[0];
    expect(dateInput).toContain('value="2020-01-01"');
    expect(dateInput).toContain('max="2026-09-28"');
    expect(markup).not.toMatch(/\smin=/);
    expect(markup).toContain('Monto recibido');
    expect(markup).toContain('class="money-input"');
    expect(markup).toContain('Forma de pago');
    expect(markup).toContain('Tarjeta');
    expect(markup).toContain('Cobrador *');
    expect(markup).toContain('María');
    expect(markup).toContain('Seleccionar cobrador');
    expect(markup).toContain('Seleccione un cobrador.');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Registrar pago<\/button>/);
    expect(markup).not.toContain('Observaciones');
    expect(defaultPaymentDate('2020-01-01', '2026-09-28')).toBe('2020-01-01');
    expect(defaultPaymentDate('2026-10-01', '2026-09-28')).toBe('2026-09-28');
    const todayInput = renderToStaticMarkup(<PaymentCaptureDialog {...captureProps({ paymentDate: defaultPaymentDate('2026-10-01', '2026-09-28') })} />).match(/<input[^>]*type="date"[^>]*>/)?.[0];
    expect(todayInput).toContain('value="2026-09-28"');
    expect(todayInput).toContain('max="2026-09-28"');
    const busy = renderToStaticMarkup(<PaymentCaptureDialog {...captureProps({ busy: true })} />);
    expect(busy).toContain('disabled=""');
    expect(busy).toContain('>Registrando…</button>');
  });

  it('forwards edits and Cancel without submitting; submit forwards only the form action', () => {
    const onAmount = vi.fn(); const onDate = vi.fn(); const onMethod = vi.fn(); const onCollector = vi.fn(); const onSubmit = vi.fn(); const onClose = vi.fn();
    const tree = elements(PaymentCaptureDialog(captureProps({ onAmount, onDate, onMethod, onCollector, onSubmit, onClose })));
    const money = tree.find((element) => element.type === MoneyInput)!;
    (money.props as { onChange: (value: string) => void }).onChange('12.50');
    const date = tree.find((element) => element.type === 'input')!;
    (date.props as { onChange: (event: ChangeEvent<HTMLInputElement>) => void }).onChange({ target: { value: '2026-09-28' } } as ChangeEvent<HTMLInputElement>);
    const selects = tree.filter((element) => element.type === 'select');
    (selects[0].props as { onChange: (event: ChangeEvent<HTMLSelectElement>) => void }).onChange({ target: { value: 'card' } } as ChangeEvent<HTMLSelectElement>);
    (selects[1].props as { onChange: (event: ChangeEvent<HTMLSelectElement>) => void }).onChange({ target: { value: 'collector-1' } } as ChangeEvent<HTMLSelectElement>);
    expect(onAmount).toHaveBeenCalledWith('12.50');
    expect(onDate).toHaveBeenCalledWith('2026-09-28');
    expect(onMethod).toHaveBeenCalledWith('card');
    expect(onCollector).toHaveBeenCalledWith('collector-1');
    const cancel = tree.find((element) => element.type === 'button' && (element.props as { children?: ReactNode }).children === 'Cancelar')!;
    (cancel.props as { onClick: () => void }).onClick();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    const preventDefault = vi.fn();
    (tree.find((element) => element.type === 'form')!.props as { onSubmit: (event: FormEvent<HTMLFormElement>) => void }).onSubmit({ preventDefault } as unknown as FormEvent<HTMLFormElement>);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('normalizes edited amounts, accepts partial or above-installment amounts within balance, and reuses a key per payload', () => {
    const largerBalance = { ...context, balances: { ...context.balances, financialBalance: '100.00' } };
    const edited = paymentCapturePayload(largerBalance, { amount: '₡75,5', paymentDate: '2026-09-28', methodId: 'card', collectorId: 'collector-1' }, '2026-09-28');
    expect(edited).toEqual({ loanId: 'loan-1', paymentDate: '2026-09-28', amount: '75.50', methodId: 'card', collectorId: 'collector-1' });
    const partial = paymentCapturePayload(context, { amount: '₡25,00', paymentDate: '2020-01-01', methodId: 'cash', collectorId: 'collector-1' }, '2026-09-28');
    expect(partial).toEqual({ loanId: 'loan-1', paymentDate: '2020-01-01', amount: '25.00', methodId: 'cash', collectorId: 'collector-1' });
    const withoutCollector = paymentCapturePayload(context, { amount: '₡12,5', paymentDate: '2020-01-01', methodId: 'cash', collectorId: '' }, '2026-09-28');
    expect(withoutCollector).toBeNull();
    expect(paymentCapturePayload(context, { amount: '0', paymentDate: '2020-01-01', methodId: 'cash', collectorId: '' }, '2026-09-28')).toBeNull();
    expect(paymentCapturePayload(context, { amount: '12', paymentDate: '2026-09-29', methodId: 'cash', collectorId: '' }, '2026-09-28')).toBeNull();
    expect(paymentCapturePayload(context, { amount: '12', paymentDate: '2020-01-01', methodId: 'inactive', collectorId: '' }, '2026-09-28')).toBeNull();
    expect(paymentCapturePayload(context, { amount: '12', paymentDate: '2020-01-01', methodId: 'cash', collectorId: 'inactive' }, '2026-09-28')).toBeNull();
    const key = vi.fn().mockReturnValueOnce('key-1').mockReturnValueOnce('key-2');
    const first = paymentCaptureAttempt(null, edited!, key);
    expect(paymentCaptureAttempt(first, edited!, key)).toEqual(first);
    const changed = paymentCapturePayload(context, { amount: '12.50', paymentDate: '2020-01-01', methodId: 'cash', collectorId: 'collector-1' }, '2026-09-28');
    expect(paymentCaptureAttempt(first, changed!, key)).toEqual({ fingerprint: JSON.stringify(changed), key: 'key-2' });
    expect(key).toHaveBeenCalledTimes(2);
  });

  it('offers one reverse action only for the last backend-ordered VALID payment, not the visually last row', () => {
    // Backend orders by payment_date, created_at, id; created_at can reverse the ID tie.
    const earlier = { id: 'z-earlier', paymentDate: '2020-01-02', amount: '10.00', status: 'VALID' as const };
    const later = { id: 'a-later', paymentDate: '2020-01-02', amount: '30.00', status: 'VALID' as const };
    const ordered = { ...context, validPayments: [earlier, later], lastValidPayment: earlier };
    expect(annulmentTarget(ordered)).toBe(later);
    expect(paymentTimeline(ordered).filter((row) => row.kind === 'PAYMENT').map((row) => row.id)).toEqual(['a-later', 'z-earlier']);
    const markup = selected({ context: ordered, canAnnul: true });
    const rows = markup.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>.*?<\/tr>/g) ?? [];
    expect(rows[0]).toContain('Pagar cuota 1');
    expect(rows[1]).toContain('aria-label="Anular pago del 02/01/2020 por ₡30,00 del préstamo 7"');
    expect(rows[1]).toContain('title="Anular último pago válido"');
    expect(rows[2]).not.toContain('Anular pago');
    expect(markup.match(/title="Anular último pago válido"/g)).toHaveLength(1);
    expect(markup).toContain('Último pago válido: 02/01/2020 · ₡30,00');
    expect(markup.split('<summary>Pagos válidos</summary>')[1]).not.toContain('title="Anular');
    const onAnnul = vi.fn();
    const tree = elements(SelectedPaymentDetails(selectedProps({ context: ordered, canAnnul: true, onAnnul })));
    const actions = tree.filter((element) => element.type === TableActions).map((element) => (element.props as { actions: TableAction[] }).actions);
    expect(actions.flat().filter((action) => action.key === 'annul')).toMatchObject([{ icon: 'reverse', disabled: false }]);
    actions.flat().find((action) => action.key === 'annul')?.onClick?.();
    expect(onAnnul).toHaveBeenCalledWith('a-later');
    expect(selected({ context: ordered, canAnnul: true, annulBusy: true })).toMatch(/title="Anular último pago válido"[^>]*disabled=""/);
  });

  it('keeps a single valid payment eligible, excludes ANNULLED rows, and respects central authorization', () => {
    const unexpected = { ...context, validPayments: [...context.validPayments, { id: 'void', paymentDate: '2020-01-03', amount: '99.00', status: 'ANNULLED' }] } as unknown as PaymentContext;
    expect(annulmentTarget(unexpected)?.id).toBe('payment');
    expect(selected({ context: unexpected, canAnnul: true }).match(/title="Anular último pago válido"/g)).toHaveLength(1);
    const noPayments = { ...context, validPayments: [], lastValidPayment: null };
    expect(annulmentTarget(noPayments)).toBeNull();
    expect(selected({ context: noPayments, canAnnul: true })).not.toContain('Anular último pago válido');
    const paidOff = { ...context, combinedPlan: [], firstOperationalRow: null, balances: { ...context.balances, financialBalance: '0.00' } };
    expect(selected({ context: paidOff, canAnnul: true })).toContain('title="Anular último pago válido"');
    expect(selected({ context: paidOff, canAnnul: true })).not.toContain('Pagar cuota');
    const cancelledAfterPayment = { ...paidOff, summary: { ...paidOff.summary, status: 'CANCELLED' } };
    expect(selected({ context: cancelledAfterPayment, canAnnul: true })).toContain('title="Anular último pago válido"');
    const user: AuthIdentity = { id: 'u', username: 'u', fullName: 'User', role: { id: 'r', code: 'STAFF', name: 'Staff', isSuperAdmin: false }, permissions: [] };
    expect(selected({ canAnnul: canAccess(user, 'payments.annul') })).not.toContain('Anular último pago válido');
    expect(selected({ canAnnul: canAccess({ ...user, role: { ...user.role, isSuperAdmin: true } }, 'payments.annul') })).toContain('Anular último pago válido');
    expect(selected({ canAnnul: canAccess({ ...user, permissions: ['payments.annul'] }, 'payments.annul') })).toContain('Anular último pago válido');
  });

  it('shows loan and payment facts, required reason, controlled errors and a disabled destructive confirmation for blank or busy input', () => {
    const props = { context, payment: context.validPayments[0], reason: '  ', busy: false, eligible: true, error: '', onReason: noop, onSubmit: noop, onClose: noop,
      dialogRef: createRef<HTMLDivElement>(), reasonRef: createRef<HTMLTextAreaElement>() };
    const markup = renderToStaticMarkup(<PaymentAnnulDialog {...props} />);
    expect(markup).toContain('role="dialog" aria-modal="true" aria-labelledby="payment-annul-title"');
    expect(markup).toContain('Préstamo #7 · Ana');
    expect(markup).toContain('Fecha del pago: 02/01/2020');
    expect(markup).toContain('Monto: ₡40,00');
    expect(markup).toContain('anula el pago y recalcula el saldo y el plan de pagos. No elimina el registro.');
    expect(markup).toContain('Motivo<textarea id="payment-annul-reason"');
    expect(markup).toContain('required=""');
    expect(markup).toContain('disabled="">Anular pago</button>');
    expect(renderToStaticMarkup(<PaymentAnnulDialog {...props} reason=" Corrección " eligible={false} error="Solo el último pago válido." />)).toContain('role="alert">Solo el último pago válido.');
    expect(renderToStaticMarkup(<PaymentAnnulDialog {...props} reason=" Corrección " busy />)).toContain('aria-busy="true"');
    const onSubmit = vi.fn(); const onReason = vi.fn(); const onClose = vi.fn();
    const tree = elements(PaymentAnnulDialog({ ...props, reason: ' Corrección ', onSubmit, onReason, onClose }));
    (tree.find((item) => item.type === 'textarea')!.props as { onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void }).onChange({ target: { value: 'Nuevo motivo' } } as ChangeEvent<HTMLTextAreaElement>);
    expect(onReason).toHaveBeenCalledWith('Nuevo motivo');
    const form = (item: ReturnType<typeof PaymentAnnulDialog>) => (elements(item).find((node) => node.type === 'form')!.props as { onSubmit: (event: FormEvent<HTMLFormElement>) => void }).onSubmit({ preventDefault: noop } as unknown as FormEvent<HTMLFormElement>);
    form(PaymentAnnulDialog(props)); form(PaymentAnnulDialog({ ...props, reason: 'x', busy: true })); form(PaymentAnnulDialog({ ...props, reason: 'x', eligible: false }));
    expect(onSubmit).not.toHaveBeenCalled();
    form(PaymentAnnulDialog({ ...props, reason: ' Corrección ', onSubmit }));
    expect(onSubmit).toHaveBeenCalledOnce();
    (tree.find((item) => item.type === 'button' && (item.props as { children?: ReactNode }).children === 'Cancelar')!.props as { onClick: () => void }).onClick();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reuses keys for the same trimmed attempt and synchronously excludes concurrent submissions', async () => {
    const keys = vi.fn().mockReturnValueOnce('key-1').mockReturnValueOnce('key-2').mockReturnValueOnce('key-3');
    const first = annulmentAttempt(null, 'payment', ' Reason ', keys);
    expect(annulmentAttempt(first, 'payment', 'Reason', keys)).toBe(first);
    expect(annulmentAttempt(first, 'payment', 'Other', keys).key).toBe('key-2');
    expect(annulmentAttempt(first, 'different', 'Reason', keys).key).toBe('key-3');
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const lock = { current: false }; const action = vi.fn(async () => { await pending; return 'completed'; });
    const firstCall = runAnnulOnce(lock, action);
    expect(await runAnnulOnce(lock, action)).toBeUndefined();
    expect(action).toHaveBeenCalledOnce();
    finish(); expect(await firstCall).toBe('completed'); expect(lock.current).toBe(false);
  });

  it('requires a fresh context for success and makes the previous VALID payment eligible after annulment', async () => {
    const previous = { id: 'previous', paymentDate: '2020-01-01', amount: '10.00', status: 'VALID' as const };
    const before = { ...context, validPayments: [previous, context.validPayments[0]] };
    const after = { ...before, validPayments: [previous], combinedPlan: [{ ...context.combinedPlan[0], pendingAmount: '100.00' }], balances: { ...context.balances, financialBalance: '100.00' } };
    const api = { annul: vi.fn().mockResolvedValue({ status: 'ANNULLED' }), context: vi.fn().mockResolvedValue(after) };
    const result = await submitAnnulment('loan-1', annulmentTarget(before)!.id, 'Reason', 'key-1', api);
    expect(result).toEqual({ accepted: true, context: after });
    if (!result.accepted) throw new Error('Expected a refreshed context.');
    expect(annulmentTarget(result.context)?.id).toBe('previous');
    expect(selected({ context: result.context, canAnnul: true })).toContain('Anular pago del 01/01/2020');
    expect(api.annul.mock.invocationCallOrder[0]).toBeLessThan(api.context.mock.invocationCallOrder[0]);
  });

  it('refreshes stale 409 without claiming success and preserves controlled fingerprint errors', async () => {
    const refreshed = { ...context, validPayments: [], lastValidPayment: null };
    const api = { annul: vi.fn().mockRejectedValue(new Error('Solo se puede anular el último pago válido.')), context: vi.fn().mockResolvedValue(refreshed) };
    const stale = await submitAnnulment('loan-1', 'payment', 'Reason', 'same-key', api);
    expect(stale).toMatchObject({ accepted: false, context: refreshed, retryUncertain: false });
    expect(stale.error).toEqual(new Error('Solo se puede anular el último pago válido.'));
    expect(annulmentTarget(stale.context!)?.id).toBeUndefined();
    api.annul.mockRejectedValueOnce(new Error('The annulment idempotency key was used with different data.'));
    const conflict = await submitAnnulment('loan-1', 'payment', 'Other', 'same-key', api);
    expect(conflict).toMatchObject({ accepted: false, retryUncertain: false });
    expect((conflict.error as Error).message).toContain('idempotency key was used with different data');
  });

  it('retains the same payload and key after an ambiguous POST or a successful POST with failed context GET', async () => {
    const key = annulmentAttempt(null, 'payment', '  Reason  ', () => 'retry-key');
    const api = { annul: vi.fn().mockRejectedValueOnce(new TypeError('Network unavailable')).mockResolvedValue({ status: 'ANNULLED' }), context: vi.fn().mockResolvedValue(context) };
    const uncertain = await submitAnnulment('loan-1', 'payment', 'Reason', key.key, api);
    expect(uncertain).toMatchObject({ accepted: false, retryUncertain: true, context });
    expect(await submitAnnulment('loan-1', 'payment', 'Reason', annulmentAttempt(key, 'payment', 'Reason').key, api)).toMatchObject({ accepted: true, context });
    expect(api.annul.mock.calls).toEqual([['payment', { reason: 'Reason', idempotencyKey: 'retry-key' }], ['payment', { reason: 'Reason', idempotencyKey: 'retry-key' }]]);
    const refresh = { annul: vi.fn().mockResolvedValue({ status: 'ANNULLED' }), context: vi.fn().mockRejectedValueOnce(new Error('GET failed')).mockResolvedValue(context) };
    const failed = await submitAnnulment('loan-1', 'payment', 'Reason', key.key, refresh);
    expect(failed).toMatchObject({ accepted: false, context: null, retryUncertain: true });
    expect((failed.error as Error).message).toContain('GET failed');
    expect(await submitAnnulment('loan-1', 'payment', 'Reason', key.key, refresh)).toMatchObject({ accepted: true, context });
    expect(refresh.annul.mock.calls[1]).toEqual(refresh.annul.mock.calls[0]);
  });
});

describe('payment plan editor', () => {
  const draft: PlanDraftEntry[] = [
    { key: 'old-a', id: 'old-a', dueDate: '2026-11-02', pendingAmount: '40.00' },
    { key: 'old-b', id: 'old-b', dueDate: '2026-12-01', pendingAmount: '60.00' },
  ];
  const props = (options: Partial<Parameters<typeof PaymentPlanEditorDialog>[0]> = {}): Parameters<typeof PaymentPlanEditorDialog>[0] => ({
    draft, balance: '100.00', busy: false, error: '', onChange: noop, onAdd: noop, onSave: noop, onClose: noop,
    dialogRef: createRef<HTMLDivElement>(), dateRef: createRef<HTMLInputElement>(), ...options,
  });

  it('keeps persisted IDs after changing dates, amounts, and display order; sends null only for new rows', () => {
    const initial = planDraftFromEntries([...context.combinedPlan, { id: 'zero', sequence: 3, dueDate: '2026-12-01', pendingAmount: '0.00' }]);
    expect(initial).toEqual([{ key: 'entry', id: 'entry', dueDate: '2020-01-01', pendingAmount: '60.00' }]);
    const changed = [
      { ...draft[0], dueDate: '2026-10-01', pendingAmount: '₡40,01' },
      { ...draft[1], pendingAmount: '₡59,99' },
      { key: 'local-new', id: null, dueDate: '2026-12-10', pendingAmount: '0.01' },
    ];
    expect(orderedPlanDraft(changed).map((entry) => entry.key)).toEqual(['old-a', 'old-b', 'local-new']);
    const review = reviewPlanDraft('100.01', changed);
    expect(review.canSave).toBe(true);
    expect(review.entries).toEqual([
      { id: 'old-a', dueDate: '2026-10-01', pendingAmount: '40.01' },
      { id: 'old-b', dueDate: '2026-12-01', pendingAmount: '59.99' },
      { id: null, dueDate: '2026-12-10', pendingAmount: '0.01' },
    ]);
    expect(reviewPlanDraft('60.00', [draft[1]]).entries).toEqual([{ id: 'old-b', dueDate: '2026-12-01', pendingAmount: '60.00' }]);
    expect(draft[0]).toEqual({ key: 'old-a', id: 'old-a', dueDate: '2026-11-02', pendingAmount: '40.00' });
  });

  it('captures an immutable positive-only opening baseline independently from editable and refreshed drafts', () => {
    const opening = { ...context, combinedPlan: [...context.combinedPlan.map((entry) => ({ ...entry })), { id: 'old', sequence: 3, dueDate: '2020-01-02', pendingAmount: '0.00' }] };
    const base = planBaselineFromContext(opening);
    const editing = planDraftFromEntries(opening.combinedPlan);
    editing[0].dueDate = '2026-11-30'; editing[0].pendingAmount = '25.00';
    editing.push({ key: 'new', id: null, dueDate: '2026-09-30', pendingAmount: '35.00' });
    opening.combinedPlan[0].pendingAmount = '15.00';
    expect(base).toEqual({ financialBalance: '60.00', entries: [{ id: 'entry', dueDate: '2020-01-01', pendingAmount: '60.00' }] });
    expect(Object.isFrozen(base)).toBe(true);
    expect(Object.isFrozen(base.entries[0])).toBe(true);
    expect(reviewPlanDraft(base.financialBalance, editing).entries.map(({ id }) => id)).toEqual([null, 'entry']);
    const reopened = { ...opening, combinedPlan: [{ id: 'refreshed', sequence: 9, dueDate: '2026-10-15', pendingAmount: '60.00' }] };
    expect(planBaselineFromContext(reopened).entries[0].id).toBe('refreshed');
    expect(planDraftFromEntries(reopened.combinedPlan)[0].id).toBe('refreshed');
    expect(base.entries[0].id).toBe('entry');
  });

  it('requires exact cents, positive amounts, valid dates and at least one obligation', () => {
    expect(reviewPlanDraft('100.00', draft).differenceCents).toBe(0n);
    expect(reviewPlanDraft('100.00', draft).canSave).toBe(true);
    expect(reviewPlanDraft('100.01', draft)).toMatchObject({ distributedCents: 10000n, differenceCents: 1n, canSave: false });
    expect(reviewPlanDraft('99.99', draft).differenceCents).toBe(-1n);
    expect(reviewPlanDraft('100.00', [{ ...draft[0], pendingAmount: '0' }, draft[1]]).canSave).toBe(false);
    expect(reviewPlanDraft('100.00', [{ ...draft[0], dueDate: '2026-02-30' }, draft[1]]).canSave).toBe(false);
    expect(reviewPlanDraft('100.00', [{ ...draft[0], pendingAmount: '12.' }, draft[1]]).canSave).toBe(false);
    expect(reviewPlanDraft('100.00', [{ ...draft[0], dueDate: '2026-11-01' }, draft[1]])).toMatchObject({ dateIssue: 'sunday', canSave: false });
    expect(reviewPlanDraft('100.00', [draft[1], draft[0]])).toMatchObject({ dateIssue: 'order', canSave: false });
    expect(reviewPlanDraft('100.00', []).canSave).toBe(false);
  });

  it('reuses the save key after a refresh failure but changes it when the draft or loan changes', () => {
    const keys = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('second').mockReturnValueOnce('third').mockReturnValueOnce('fourth');
    const base = planBaselineFromContext(context);
    const entries = reviewPlanDraft('100.00', draft).entries;
    const attempt = planSaveAttempt(null, 'loan-1', base, entries, keys);
    expect(planSaveAttempt(attempt, 'loan-1', base, entries, keys)).toBe(attempt);
    expect(planSaveAttempt(attempt, 'loan-1', base, entries.slice(1), keys).key).toBe('second');
    expect(planSaveAttempt(attempt, 'loan-2', base, entries, keys).key).toBe('third');
    expect(planSaveAttempt(attempt, 'loan-1', { ...base, entries: [{ ...base.entries[0], pendingAmount: '59.99' }] }, entries, keys).key).toBe('fourth');
    expect(keys).toHaveBeenCalledTimes(4);
  });

  it('renders a keyboard-friendly editor with date-only/money inputs, icon removal, exact summary and errors', () => {
    const markup = renderToStaticMarkup(<PaymentPlanEditorDialog {...props({ error: 'El servidor rechazó el plan.' })} />);
    expect(markup).toContain('role="dialog" aria-modal="true"');
    expect(markup).toContain('aria-label="Fecha de la obligación 1"');
    expect(markup).toContain('aria-label="Monto de la obligación 1"');
    expect(markup).toContain('type="date"');
    expect(markup).not.toMatch(/\smax=/);
    expect(markup).not.toMatch(/\smin=/);
    expect(markup).toContain('title="Eliminar obligación"');
    expect(markup).toContain('₡100,00');
    expect(markup).toContain('₡0,00');
    expect(markup).toContain('role="alert">El servidor rechazó el plan.');
    expect(markup).toContain('>Guardar plan</button>');
    expect(renderToStaticMarkup(<PaymentPlanEditorDialog {...props({ balance: '100.01' })} />)).toContain('disabled="">Guardar plan');
    expect(renderToStaticMarkup(<PaymentPlanEditorDialog {...props({ balance: '99.99' })} />)).toContain('-₡0,01');
  });

  it('updates by local key, removes only the chosen row, and cannot submit invalid or busy plans', () => {
    const onChange = vi.fn(); const onAdd = vi.fn(); const onSave = vi.fn(); const onClose = vi.fn();
    const tree = elements(PaymentPlanEditorDialog(props({ onChange, onAdd, onSave, onClose })));
    const fields = elements(PaymentPlanDraftFields(tree.find((element) => element.type === PaymentPlanDraftFields)!.props as Parameters<typeof PaymentPlanDraftFields>[0]));
    const dates = fields.filter((element) => element.type === 'input');
    (dates[0].props as { onChange: (event: ChangeEvent<HTMLInputElement>) => void }).onChange({ target: { value: '2026-10-01' } } as ChangeEvent<HTMLInputElement>);
    expect(onChange).toHaveBeenCalledWith([{ ...draft[0], dueDate: '2026-10-01' }, draft[1]]);
    const money = fields.find((element) => element.type === MoneyInput)!;
    (money.props as { onChange: (value: string) => void }).onChange('59.99');
    expect(onChange).toHaveBeenCalledWith([{ ...draft[0], pendingAmount: '59.99' }, draft[1]]);
    const remove = fields.find((element) => element.type === TableActions)!.props as { actions: TableAction[] };
    remove.actions[0].onClick?.();
    expect(onChange).toHaveBeenCalledWith([draft[1]]);
    const button = (label: string) => tree.find((element) => element.type === 'button' && (element.props as { children?: ReactNode }).children === label)!;
    (fields.find((element) => element.type === 'button' && (element.props as { children?: ReactNode }).children === 'Agregar obligación')!.props as { onClick: () => void }).onClick();
    (button('Cancelar').props as { onClick: () => void }).onClick();
    expect(onAdd).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
    const submit = (component: ReturnType<typeof PaymentPlanEditorDialog>) =>
      (elements(component).find((element) => element.type === 'form')!.props as { onSubmit: (event: FormEvent<HTMLFormElement>) => void }).onSubmit({ preventDefault: noop } as unknown as FormEvent<HTMLFormElement>);
    submit(PaymentPlanEditorDialog(props({ onSave, balance: '99.99' })));
    submit(PaymentPlanEditorDialog(props({ onSave, busy: true })));
    expect(onSave).not.toHaveBeenCalled();
    submit(PaymentPlanEditorDialog(props({ onSave })));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('commits a full ID-bearing draft before fetching persisted context; rejection leaves input for retry', async () => {
    const persisted = { ...context, combinedPlan: [{ id: 'new-from-backend', sequence: 12, dueDate: '2026-11-01', pendingAmount: '100.00' }] };
    const api = { customizePlan: vi.fn().mockResolvedValue([]), context: vi.fn().mockResolvedValue(persisted) };
    const entries = reviewPlanDraft('100.00', draft).entries;
    const base = planBaselineFromContext(context);
    expect(await persistPlanAndRefresh('loan-1', base, entries, 'retry-key', api)).toBe(persisted);
    expect(api.customizePlan).toHaveBeenCalledWith('loan-1', base, entries, 'retry-key');
    expect(api.context).toHaveBeenCalledWith('loan-1');
    expect(api.customizePlan.mock.invocationCallOrder[0]).toBeLessThan(api.context.mock.invocationCallOrder[0]);
    api.customizePlan.mockRejectedValueOnce(new Error('Plan rejected'));
    await expect(persistPlanAndRefresh('loan-1', base, entries, 'retry-key', api)).rejects.toThrow('Plan rejected');
    expect(api.context).toHaveBeenCalledTimes(1);
    api.context.mockRejectedValueOnce(new Error('Refresh failed'));
    await expect(persistPlanAndRefresh('loan-1', base, entries, 'retry-key', api)).rejects.toBeInstanceOf(PlanRefreshError);
    expect(await persistPlanAndRefresh('loan-1', base, entries, 'retry-key', api)).toBe(persisted);
    expect(api.customizePlan).toHaveBeenCalledTimes(4);
    expect(api.customizePlan.mock.calls[3]).toEqual(['loan-1', base, entries, 'retry-key']);
    expect(renderToStaticMarkup(<PaymentPlanEditorDialog {...props({ error: 'Refresh failed' })} />)).toContain('role="dialog"');
    expect(draft).toHaveLength(2);
  });
});
