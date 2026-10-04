import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DailyCollectionsController, type DailyCollectionsPort } from '../../application/use-cases/daily-collections-controller';
import { costaRicaDateOnly, shiftDateOnly } from '../../shared/utils/date';
import { AuthContext } from '../hooks/auth-context';
import { TableActions } from '../components/TableActions';
import { downloadDailyPlan, saveDailyPlan } from '../helpers/daily-collections-operations';
import { DailyCollectionsPage, DailyCollectionsView } from './DailyCollectionsPage';

const date = '2026-10-01';
const summary = { date, dueCount: 14, paidLoansCount: 3, dueAmount: '3418000.00', receivedAmount: '450000.00' };
const due = { planEntryId: 'entry-1', sequence: 1, dueDate: date, pendingAmount: '950000.00',
  loan: { id: 'loan-1', loanNumber: '4548' }, customer: { id: 'customer-1', identification: '503520108', fullName: 'Juan Pérez', primaryPhone: '8888 8888' } };
const received = { paymentId: 'payment-1', paymentDate: date, amount: '5000.00', loan: due.loan,
  customer: { id: 'customer-1', identification: '503520108', fullName: 'Juan Pérez' },
  paymentMethod: { id: 'method-1', name: 'Efectivo' }, collector: null };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];

function setup() {
  const api = {
    summary: vi.fn<DailyCollectionsPort['summary']>(async (selected) => ({ ...summary, date: selected })),
    due: vi.fn<DailyCollectionsPort['due']>(async (query) => ({ items: [due], total: 32, page: query.page, pageSize: query.pageSize })),
    received: vi.fn<DailyCollectionsPort['received']>(async (query) => ({ items: [received], total: 21, page: query.page, pageSize: query.pageSize })),
  };
  const controller = new DailyCollectionsController(api, () => date);
  const customize = vi.fn(); const print = vi.fn();
  const props = (permissions: string[] = ['payments.view']) => ({ state: controller.getSnapshot(), controller,
    can: (permission: string) => permissions.includes(permission), onCustomize: customize, onPrint: print, today: date });
  const view = (permissions?: string[]) => renderToStaticMarkup(<MemoryRouter><DailyCollectionsView {...props(permissions)} /></MemoryRouter>);
  const tree = (permissions?: string[]) => elements(DailyCollectionsView(props(permissions)));
  return { api, controller, view, tree, customize, print };
}

describe('Cobros del día', () => {
  it('opens with Costa Rica today and queries all three endpoints for the same date', async () => {
    const { api, controller } = setup();
    const html = renderToStaticMarkup(<MemoryRouter><AuthContext.Provider value={{ loading: false, can: () => true, canAll: () => true,
      login: async () => {}, logout: async () => {}, changePassword: async () => {} }}><DailyCollectionsPage controller={controller} /></AuthContext.Provider></MemoryRouter>);
    expect(html).toContain('Cobros del día'); expect(html).toContain('PAGOS');
    await controller.load();
    expect(api.summary).toHaveBeenCalledWith(date);
    expect(api.due).toHaveBeenCalledWith({ date, page: 1, pageSize: 20 });
    expect(api.received).toHaveBeenCalledWith({ date, page: 1, pageSize: 20 });
    expect(costaRicaDateOnly(new Date('2026-10-01T03:00:00Z'))).toBe('2026-09-30');
  });

  it('navigates month/year/leap boundaries, restores Hoy, and resets both independent pages on manual selection', async () => {
    const { api, controller } = setup(); await controller.load();
    controller.previous(); await tick(); expect(controller.getSnapshot().date).toBe('2026-09-30');
    controller.next(); await tick(); expect(controller.getSnapshot().date).toBe(date);
    controller.setPage('due', 2); await tick(); controller.setPage('received', 2); await tick();
    expect(controller.getSnapshot()).toMatchObject({ duePage: 2, receivedPage: 2 });
    controller.setDate('2024-02-29');
    expect(controller.getSnapshot()).toMatchObject({ summary: null, due: null, received: null });
    await tick();
    expect(controller.getSnapshot()).toMatchObject({ date: '2024-02-29', duePage: 1, receivedPage: 1 });
    expect(api.summary).toHaveBeenLastCalledWith('2024-02-29');
    expect(api.due).toHaveBeenLastCalledWith({ date: '2024-02-29', page: 1, pageSize: 20 });
    expect(api.received).toHaveBeenLastCalledWith({ date: '2024-02-29', page: 1, pageSize: 20 });
    expect(shiftDateOnly('2024-02-29', 1)).toBe('2024-03-01');
    expect(shiftDateOnly('2026-12-31', 1)).toBe('2027-01-01');
    controller.resetToday(); await tick(); expect(controller.getSnapshot().date).toBe(date);
  });

  it('renders four backend summary cards and both operational tables without computing from rows', async () => {
    const { controller, view } = setup(); await controller.load();
    const html = view();
    for (const fragment of ['POR COBRAR</span><strong>14', 'PAGARON</span><strong>3',
      'MONTO POR COBRAR</span><strong>₡3.418.000,00', 'MONTO RECIBIDO</span><strong>₡450.000,00',
      'Juan Pérez', '503520108 · 8888 8888', '#4548', '01/10/2026', '₡950.000,00',
      'PAGOS RECIBIDOS', '₡5.000,00', 'Efectivo', 'Página 1 de 2 · 32 registros']) expect(html).toContain(fragment);
    expect(html).toContain('<td>—</td>');
  });

  it('uses compact actions and centralized permissions for view, register, personalize and print', async () => {
    const { controller, tree, view, customize, print } = setup(); await controller.load();
    const permissions = ['payments.view', 'payments.create', 'payments.plan.customize', 'loans.view', 'loans.export'];
    const html = view(permissions);
    expect(html).toContain('href="/loans/loan-1"');
    expect(html).toContain('href="/payments/new?loanId=loan-1"');
    const actions = tree(permissions).find((element) => element.type === TableActions)!;
    const list = (actions.props as Parameters<typeof TableActions>[0]).actions;
    expect(list.map((action) => action.key)).toEqual(['view', 'pay', 'plan', 'print']);
    list[2].onClick?.(); list[3].onClick?.();
    expect(customize).toHaveBeenCalledOnce(); expect(customize).toHaveBeenCalledWith('loan-1');
    expect(print).toHaveBeenCalledOnce(); expect(print).toHaveBeenCalledWith('loan-1');
    expect(view(['payments.view', 'loans.view'])).not.toContain('Registrar pago del préstamo');
    expect(view(['payments.view', 'loans.view'])).not.toContain('Personalizar plan del préstamo');
    expect(view(['payments.view', 'loans.export'])).not.toContain('Imprimir plan del préstamo');
  });

  it('reuses plan save and PDF services, then refetches all data for the selected date', async () => {
    const { api, controller } = setup(); await controller.load();
    const baseline = { financialBalance: '950000.00', entries: [{ id: 'entry-1', dueDate: date, pendingAmount: '950000.00' }] };
    const draft = [{ key: 'entry-1', id: 'entry-1', dueDate: date, pendingAmount: '950000.00' }];
    const payment = { customizePlan: vi.fn(async () => ({})), context: vi.fn(async () => ({ summary: { loanId: 'loan-1' } })) };
    await saveDailyPlan('loan-1', baseline, draft, 'key-1', controller, payment as never);
    expect(payment.customizePlan).toHaveBeenCalledWith('loan-1', baseline, [{ id: 'entry-1', dueDate: date, pendingAmount: '950000.00' }], 'key-1');
    expect(api.summary).toHaveBeenCalledTimes(2);
    expect(api.due).toHaveBeenCalledTimes(2); expect(api.received).toHaveBeenCalledTimes(2);
    const detail = { id: 'loan-1' }; const loan = { detail: vi.fn(async () => detail) };
    const report = vi.fn(async () => new Blob());
    await downloadDailyPlan('loan-1', loan as never, report as never);
    expect(loan.detail).toHaveBeenCalledExactlyOnceWith('loan-1');
    expect(report).toHaveBeenCalledExactlyOnceWith(detail);
  });

  it('keeps healthy sections on individual failures and shows correct empty states', async () => {
    const { api, controller, view } = setup();
    api.due.mockRejectedValueOnce(new Error('Fallo de cuotas'));
    await controller.load();
    expect(view()).toContain('Por cobrar: Fallo de cuotas');
    expect(view()).toContain('PAGOS RECIBIDOS'); expect(view()).toContain('Efectivo');
    api.due.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    api.received.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    await controller.load();
    expect(view()).toContain('No hay obligaciones por cobrar para esta fecha.');
    expect(view()).toContain('No hay pagos recibidos para esta fecha.');
    controller.setSearch('Ana'); await tick();
    expect(api.due).toHaveBeenLastCalledWith({ date, search: 'Ana', page: 1, pageSize: 20 });
    expect(api.received).toHaveBeenLastCalledWith({ date, search: 'Ana', page: 1, pageSize: 20 });
  });
});
