import { isValidElement, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LoanManagementController, type LoanManagementPort, type LoanManagementState, type LoanOperation } from '../../application/use-cases/loan-management-controller';
import type { LoanManagementResult, OverdueLoan, UncollectibleLoan } from '../../domain/entities/loan';
import type { AuthIdentity } from '../../domain/entities/auth';
import { TableActions } from '../components/TableActions';
import { LoanManagementStatusDialog } from '../components/LoanManagementStatusDialog';
import { canAccess } from '../hooks/auth-permissions';
import { AuthContext } from '../hooks/auth-context';
import { LoanManagementPage, LoanManagementView } from './LoanManagementPage';

const overdue: OverdueLoan = { loanId: 'loan-1', loanNumber: '42', customer: { id: 'customer-1', fullName: 'Ana López', identification: '101' },
  startDate: '2026-01-02', firstOverdueDueDate: '2026-02-03', firstOverdueAmount: '20.50', status: 'ACTIVE', canMarkUncollectible: true,
  principal: '1000.00', interestAmount: '10.00', totalAmount: '1010.00', recoveredAmount: '10.00', financialBalance: '990.00' };
const uncollectible: UncollectibleLoan = { ...overdue, status: 'UNCOLLECTIBLE', uncollectibleAt: '2026-03-01T01:00:00Z',
  uncollectibleBusinessDate: '2026-02-28', uncollectibleReason: 'Revisión extensa de situación financiera', changedByUserId: 'user-1' };
const summary = { total: 31, lentAmount: '99999999999999999.01', recoveredAmount: '700.02', pendingAmount: '999.03' };
const result = <Row extends OverdueLoan | UncollectibleLoan>(items: Row[], total = 31, page = 1): LoanManagementResult<Row> =>
  ({ items, total, page, pageSize: 20, summary: { ...summary, total } });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const identity: AuthIdentity = { id: 'user', username: 'tester', fullName: 'Tester', role: { id: 'role', code: 'ROLE', name: 'Role', isSuperAdmin: false }, permissions: [] };
const can = (permissions: string[] = [], superAdmin = false) => (code: string) => canAccess({ ...identity, permissions, role: { ...identity.role, isSuperAdmin: superAdmin } }, code);
const noop = vi.fn();

function setup(allowed: (operation: LoanOperation) => boolean = () => true) {
  const api = {
    getOverdueLoans: vi.fn<LoanManagementPort['getOverdueLoans']>(async (query) => ({ ...result([overdue], 31, query.page), pageSize: query.pageSize ?? 20 })),
    getUncollectibleLoans: vi.fn<LoanManagementPort['getUncollectibleLoans']>(async (query) => ({ ...result([uncollectible], 31, query.page), pageSize: query.pageSize ?? 20 })),
    markLoanUncollectible: vi.fn<LoanManagementPort['markLoanUncollectible']>(async () => ({ loanId: 'loan-1', status: 'UNCOLLECTIBLE', event: { id: 'event', sequence: 1, changedAt: 'now' } })),
    reactivateLoan: vi.fn<LoanManagementPort['reactivateLoan']>(async () => ({ loanId: 'loan-1', status: 'ACTIVE', event: { id: 'event', sequence: 2, changedAt: 'now' } })),
  };
  const controller = new LoanManagementController(api, () => 'key-1', allowed);
  return { api, controller };
}
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
function props(controller: LoanManagementController, options: { state?: Partial<LoanManagementState>; permissions?: string[]; superAdmin?: boolean; row?: OverdueLoan | UncollectibleLoan | null; onBegin?: (operation: LoanOperation, row: OverdueLoan | UncollectibleLoan) => void } = {}) {
  return { controller, state: { ...controller.getSnapshot(), ...options.state }, can: can(options.permissions, options.superAdmin),
    onBegin: options.onBegin ?? noop, selectedRow: options.row ?? null };
}
const view = (controller: LoanManagementController, options: Parameters<typeof props>[1] = {}) =>
  renderToStaticMarkup(<LoanManagementView {...props(controller, options)} />);
const tree = (controller: LoanManagementController, options: Parameters<typeof props>[1] = {}) =>
  elements(LoanManagementView(props(controller, options)));
const button = (nodes: ReactElement[], label: string) => nodes.find((element) => element.type === 'button' &&
  (element.props as { children?: ReactNode }).children === label)!;
const click = (element: ReactElement) => (element.props as { onClick: () => void }).onClick();
async function loadOverdue(controller: LoanManagementController) {
  controller.setActiveTab('OVERDUE');
  await tick();
}

describe('loan management page', () => {
  it('starts on uncollectible and renders an initial placeholder before mount-only loading', () => {
    const { controller, api } = setup();
    const user = { ...identity, permissions: ['loans.status.uncollectible'] };
    const html = renderToStaticMarkup(<AuthContext.Provider value={{ user, loading: false, can: (code) => canAccess(user, code), canAll: (codes) => codes.every((code) => canAccess(user, code)),
      login: async () => {}, logout: async () => {}, changePassword: async () => {} }}><LoanManagementPage controller={controller} /></AuthContext.Provider>);
    expect(html).toContain('Gestión de incobrables');
    expect(html).toMatch(/id="loan-management-uncollectible-tab"[^>]*aria-selected="true"/);
    expect(html.indexOf('>Incobrables</button>')).toBeLessThan(html.indexOf('>Candidatos a vencerse</button>'));
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('Cargando préstamos');
    expect(api.getOverdueLoans).not.toHaveBeenCalled();
    expect(api.getUncollectibleLoans).not.toHaveBeenCalled();
  });

  it('keeps both tabs visible with loans.view alone while hiding separate status actions', async () => {
    const { controller } = setup(); await loadOverdue(controller);
    const overdueHtml = view(controller, { permissions: ['loans.view'] });
    expect(overdueHtml).toContain('aria-selected="true"');
    expect(overdueHtml).toContain('>Candidatos a vencerse</button>');
    expect(overdueHtml).toContain('>Incobrables</button>');
    expect(overdueHtml).not.toContain('aria-label="Marcar préstamo 42 como incobrable"');
    controller.setActiveTab('UNCOLLECTIBLE'); await tick();
    const uncollectibleHtml = view(controller, { permissions: ['loans.view'] });
    expect(uncollectibleHtml).toContain('role="tabpanel" aria-labelledby="loan-management-uncollectible-tab"');
    expect(uncollectibleHtml).not.toContain('aria-label="Reactivar préstamo 42"');
  });

  it('uses only backend summary for four cards, and shows every overdue field with seven server-sortable columns', async () => {
    const { controller } = setup(); await loadOverdue(controller);
    const html = view(controller, { permissions: ['loans.status.uncollectible'] });
    expect(html).toMatch(/TOTAL<\/span><strong>31<\/strong>/);
    expect(html).toContain('PRESTADO</span><strong>₡99.999.999.999.999.999,01</strong>');
    expect(html).toContain('RECUPERADO</span><strong>₡700,02</strong>');
    expect(html).toContain('PENDIENTE</span><strong>₡999,03</strong>');
    expect([...html.matchAll(/aria-sort=/g)]).toHaveLength(7);
    for (const value of ['#42', 'Ana López', '101', '02/01/2026', '03/02/2026', '₡20,50', '₡1.000', '₡10', '₡990']) expect(html).toContain(value);
    expect(html).toContain('Página 1 de 2 · 31 préstamos');
    expect(html).toContain('loan-list__table-wrap');
    expect(html).toContain('title="Marcar como incobrable" aria-label="Marcar préstamo 42 como incobrable"');
    expect(html).not.toContain('Incobrable desde');
    expect(html).not.toContain('role="dialog"');
  });

  it('gates compact mutation actions through central permissions including superadmin, without removing either capability', async () => {
    const { controller } = setup(); await loadOverdue(controller);
    expect(view(controller)).not.toContain('aria-label="Marcar préstamo 42 como incobrable"');
    expect(view(controller, { superAdmin: true })).toContain('aria-label="Marcar préstamo 42 como incobrable"');
    expect(view(controller, { permissions: ['loans.status.reactivate'] })).not.toContain('aria-label="Marcar préstamo 42 como incobrable"');
    const mark = vi.fn();
    const markAction = tree(controller, { superAdmin: true, onBegin: mark }).find((element) => element.type === TableActions)!;
    click(elements(TableActions(markAction.props as Parameters<typeof TableActions>[0])).find((element) => element.type === 'button')!);
    expect(mark).toHaveBeenCalledWith('MARK', overdue);
    controller.setActiveTab('UNCOLLECTIBLE'); await tick();
    expect(view(controller)).not.toContain('aria-label="Reactivar préstamo 42"');
    expect(view(controller, { permissions: ['loans.status.reactivate'] })).toContain('title="Reactivar préstamo" aria-label="Reactivar préstamo 42"');
    expect(view(controller, { superAdmin: true })).toContain('aria-label="Reactivar préstamo 42"');
    const onBegin = vi.fn();
    const actions = tree(controller, { superAdmin: true, onBegin }).find((element) => element.type === TableActions)!;
    click(elements(TableActions(actions.props as Parameters<typeof TableActions>[0])).find((element) => element.type === 'button')!);
    expect(onBegin).toHaveBeenCalledWith('REACTIVATE', uncollectible);
  });

  it('changes only the active tab, preserves controller filters, shows backend business date, and handles null or long reasons', async () => {
    const { controller, api } = setup(); await loadOverdue(controller); controller.setSearch('Ana'); await tick();
    click(button(tree(controller), 'Incobrables'));
    expect(controller.getSnapshot()).toMatchObject({ activeTab: 'UNCOLLECTIBLE', search: 'Ana', page: 1, items: [], dataPage: null });
    expect(view(controller)).not.toContain('#42</td>');
    await tick();
    const html = view(controller, { permissions: ['loans.status.reactivate'] });
    expect(html).toContain('28/02/2026');
    expect(html).not.toContain('01/03/2026');
    expect(html).toContain('title="Revisión extensa de situación financiera"');
    expect(html).not.toContain('Cuota vencida');
    expect(html).toContain('role="tabpanel" aria-labelledby="loan-management-uncollectible-tab"');
    expect(api.getUncollectibleLoans).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Ana', sortBy: 'uncollectibleDate' }));
    api.getUncollectibleLoans.mockResolvedValueOnce(result([{ ...uncollectible, uncollectibleReason: null }]));
    await controller.refresh(); expect(view(controller)).toContain('loan-management__reason">—</td>');
  });

  it('wires exactly seven supported sort keys per tab to the controller, never sorting amount, reason, or action', async () => {
    const { controller } = setup(); await loadOverdue(controller);
    const overdueSort = vi.spyOn(controller, 'sortOverdue');
    const headers = tree(controller).filter((element) => typeof element.type === 'function' && element.type.name === 'SortHeader');
    expect(headers).toHaveLength(7);
    headers.forEach((header) => (header.props as { onSort: () => void }).onSort());
    expect(overdueSort.mock.calls.map(([key]) => key)).toEqual(['loanNumber', 'customer', 'startDate', 'firstOverdueDueDate', 'principal', 'recoveredAmount', 'financialBalance']);
    await tick(); controller.setActiveTab('UNCOLLECTIBLE'); await tick();
    const uncollectibleSort = vi.spyOn(controller, 'sortUncollectible');
    tree(controller).filter((element) => typeof element.type === 'function' && element.type.name === 'SortHeader')
      .forEach((header) => (header.props as { onSort: () => void }).onSort());
    expect(uncollectibleSort.mock.calls.map(([key]) => key)).toEqual(['loanNumber', 'customer', 'startDate', 'uncollectibleDate', 'principal', 'recoveredAmount', 'financialBalance']);
    expect(view(controller)).toContain('aria-sort="ascending"');
  });

  it('wires search, date-only inputs, paging, size, and manual refresh without local query or calculation', async () => {
    const { controller, api } = setup(); await loadOverdue(controller);
    const nodes = tree(controller);
    const inputs = nodes.filter((element) => element.type === 'input');
    expect(inputs.map((element) => (element.props as { id: string }).id)).toEqual(['loan-management-search', 'loan-management-start', 'loan-management-end']);
    for (const [input, value] of inputs.map((element, index) => [element, ['Ana', '2026-01-01', '2026-03-31'][index]] as const)) {
      (input.props as { onChange: (event: ChangeEvent<HTMLInputElement>) => void }).onChange({ target: { value } } as ChangeEvent<HTMLInputElement>);
    }
    await tick(); click(button(tree(controller), 'Siguiente')); await tick();
    expect(api.getOverdueLoans).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Ana', startDate: '2026-01-01', endDate: '2026-03-31', page: 2 }));
    const select = tree(controller).find((element) => element.type === 'select')!;
    (select.props as { onChange: (event: ChangeEvent<HTMLSelectElement>) => void }).onChange({ target: { value: '50' } } as ChangeEvent<HTMLSelectElement>);
    await tick(); expect(api.getOverdueLoans).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50, page: 1 }));
    const refresh = tree(controller).find((element) => element.type === 'button' && (element.props as { 'aria-label'?: string })['aria-label'] === 'Refrescar préstamos')!;
    click(refresh); await tick(); expect(api.getOverdueLoans).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50, search: 'Ana' }));
  });

  it('keeps previous rows/cards on refresh failure, clearly labels stale filter data, and only reports valid empty responses', async () => {
    const { controller, api } = setup(); await loadOverdue(controller);
    let reject!: (error: Error) => void;
    api.getOverdueLoans.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    const refreshing = controller.refresh();
    expect(view(controller)).toContain('loan-management__spinning');
    expect(view(controller)).toMatch(/aria-label="Refrescar préstamos"[^>]*aria-busy="true" disabled=""/);
    expect(view(controller)).toContain('₡99.999.999.999.999.999,01');
    reject(new Error('Refresh unavailable')); await refreshing;
    expect(view(controller)).toContain('Refresh unavailable');
    expect(view(controller)).toContain('Se muestran datos anteriores; pueden no coincidir con los filtros actuales.');
    expect(view(controller)).toContain('#42</td>');
    api.getOverdueLoans.mockRejectedValueOnce(new Error('Filter unavailable'));
    controller.setSearch('Other');
    expect(view(controller)).toContain('Datos anteriores; la consulta actual aún no está confirmada.');
    await tick(); expect(view(controller)).toContain('Filter unavailable');
    expect(view(controller)).not.toContain('No se encontraron préstamos');
    api.getOverdueLoans.mockResolvedValueOnce(result([], 0)); controller.setSearch('No match'); await tick();
    expect(view(controller)).toContain('No se encontraron préstamos con los filtros seleccionados.');
    controller.setActiveTab('UNCOLLECTIBLE'); await tick();
    api.getUncollectibleLoans.mockResolvedValueOnce(result([], 0)); await controller.refresh();
    expect(view(controller)).toContain('No se encontraron préstamos con los filtros seleccionados.');
    controller.setSearch(''); await tick();
    api.getUncollectibleLoans.mockResolvedValueOnce(result([], 0)); await controller.refresh();
    expect(view(controller)).toContain('No hay préstamos incobrables.');
    controller.setActiveTab('OVERDUE'); await tick();
    api.getOverdueLoans.mockResolvedValueOnce(result([], 0)); await controller.refresh();
    expect(view(controller)).toContain('No hay préstamos vencidos.');
  });

  it('reuses a single accessible dialog for both operations; failed attempt stays open and success follows controller refetch', async () => {
    const { controller, api } = setup(); await loadOverdue(controller);
    controller.beginAttempt('MARK', overdue);
    let html = view(controller, { permissions: ['loans.status.uncollectible'], row: overdue });
    expect(html).toContain('role="dialog" aria-modal="true" aria-labelledby="loan-management-dialog-title"');
    expect(html).toContain('Marcar préstamo #42 como incobrable');
    expect(html).toContain('Ana López'); expect(html).toContain('Saldo pendiente: ₡990');
    expect(html).toContain('Primer vencimiento: 03/02/2026'); expect(html).toContain('Cuota vencida: ₡20,50');
    expect(html).toContain('no condona la deuda');
    expect(html).toMatch(/type="submit" disabled=""/);
    const dialog = tree(controller, { permissions: ['loans.status.uncollectible'], row: overdue }).find((element) => element.type === LoanManagementStatusDialog)!;
    (dialog.props as { onReason: (reason: string) => void }).onReason('   ');
    expect(view(controller, { permissions: ['loans.status.uncollectible'], row: overdue })).toMatch(/type="submit" disabled=""/);
    (dialog.props as { onReason: (reason: string) => void }).onReason('  Revisión  ');
    expect(view(controller, { permissions: ['loans.status.uncollectible'], row: overdue })).not.toMatch(/type="submit" disabled=""/);
    api.markLoanUncollectible.mockRejectedValueOnce(new Error('Service unavailable'));
    (dialog.props as { onSubmit: () => void }).onSubmit(); await tick();
    html = view(controller, { permissions: ['loans.status.uncollectible'], row: overdue });
    expect(html).toContain('role="alert">Service unavailable');
    expect(html).toContain('role="dialog"');
    expect(controller.getSnapshot().actionAttempt?.key).toBe('key-1');
    await controller.submit();
    expect(api.markLoanUncollectible.mock.calls.map(([, body]) => body.idempotencyKey)).toEqual(['key-1', 'key-1']);
    expect(view(controller)).toContain('Préstamo marcado como incobrable.');
    expect(view(controller)).not.toContain('role="dialog"');
    controller.setActiveTab('UNCOLLECTIBLE'); await tick(); controller.beginAttempt('REACTIVATE', uncollectible);
    html = view(controller, { permissions: ['loans.status.reactivate'], row: uncollectible });
    expect(html).toContain('Reactivar préstamo #42');
    expect(html).toContain('Incobrable desde: 28/02/2026');
    expect(html).toContain('plan de pagos no cambiará automáticamente');
    expect(html).not.toContain('Primer vencimiento:');
    const reactivate = tree(controller, { permissions: ['loans.status.reactivate'], row: uncollectible }).find((element) => element.type === LoanManagementStatusDialog)!;
    (reactivate.props as { onReason: (reason: string) => void }).onReason('Resolved');
    (reactivate.props as { onSubmit: () => void }).onSubmit(); await tick();
    expect(api.reactivateLoan).toHaveBeenCalledWith('loan-1', { reason: 'Resolved', idempotencyKey: 'key-1' });
    expect(view(controller)).toContain('Préstamo reactivado.');
    controller.beginAttempt('REACTIVATE', uncollectible);
    const cancel = tree(controller, { permissions: ['loans.status.reactivate'], row: uncollectible }).find((element) => element.type === LoanManagementStatusDialog)!;
    (cancel.props as { onClose: () => void }).onClose();
    expect(controller.getSnapshot().actionAttempt).toBeNull();
  });

  it('disables cancel and confirmation during submission, and exposes scoped table/refresh hooks', async () => {
    const { controller, api } = setup(); await loadOverdue(controller); controller.beginAttempt('MARK', overdue); controller.setReason('Review');
    let resolve!: (reply: Awaited<ReturnType<LoanManagementPort['markLoanUncollectible']>>) => void;
    api.markLoanUncollectible.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    const submit = controller.submit();
    const html = view(controller, { permissions: ['loans.status.uncollectible'], row: overdue });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Guardando…');
    expect(html).toMatch(/>Cancelar<\/button>/);
    expect([...html.matchAll(/disabled=""/g)].length).toBeGreaterThanOrEqual(3);
    expect(await controller.submit()).toBe(false);
    resolve({ loanId: 'loan-1', status: 'UNCOLLECTIBLE', event: { id: 'event', sequence: 1, changedAt: 'now' } }); await submit;
    expect(html).toContain('loan-management__summary');
    expect(html).toContain('loan-list__table-wrap');
    expect(html).toContain('loan-management__refresh');
    controller.setActiveTab('UNCOLLECTIBLE'); await tick();
    expect(view(controller)).toContain('loan-management__reason');
  });

  it('allows arrow/Home/End tab keyboard handlers and localizes Unit1 fallback messages without altering controller state', async () => {
    const { controller } = setup(); await controller.load();
    const tabs = tree(controller).find((element) => (element.props as { role?: string }).role === 'tablist')!;
    const keyDown = (tabs.props as { onKeyDown: (event: { key: string; preventDefault(): void }) => void }).onKeyDown;
    const preventDefault = vi.fn();
    keyDown({ key: 'ArrowRight', preventDefault });
    expect(controller.getSnapshot().activeTab).toBe('OVERDUE'); expect(preventDefault).toHaveBeenCalledOnce();
    keyDown({ key: 'Home', preventDefault }); expect(controller.getSnapshot().activeTab).toBe('UNCOLLECTIBLE');
    await tick();
    const html = view(controller, { state: { error: 'Loan page changed during refresh. Try again.' } });
    expect(html).toContain('La página cambió durante la actualización. Intente nuevamente.');
    expect(controller.getSnapshot().error).toBeNull();
    await loadOverdue(controller); controller.beginAttempt('MARK', overdue);
    expect(view(controller, { permissions: ['loans.status.uncollectible'], state: { actionAttempt: { ...controller.getSnapshot().actionAttempt!, error: 'A reason is required.' } } })).toContain('Indique el motivo.');
  });
});
