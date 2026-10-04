import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PaymentHistoryController, type PaymentHistoryPort } from '../../application/use-cases/payment-history-controller';
import type { PaymentHistoryItem } from '../../domain/entities/payment-history';
import { costaRicaDateOnly } from '../../shared/utils/date';
import { TableActions } from '../components/TableActions';
import { exportPaymentHistory } from '../helpers/payment-history-export';
import { PaymentHistoryView } from './PaymentHistoryPage';

const payment: PaymentHistoryItem = { paymentId: 'payment-1', paymentDate: '2026-10-02', amount: '500000.00',
  principalApplied: '420000.00', interestApplied: '80000.00', status: 'VALID', installments: [1, 2],
  loan: { id: 'loan-1', loanNumber: '4548' }, customer: { id: 'customer-1', identification: '503520108',
    fullName: 'Ana Pérez', primaryPhone: '8888' }, paymentMethod: { id: 'method-1', name: 'Transferencia' },
  collector: { id: 'collector-1', name: 'Bea Solís' } };
const summary = { validPaymentsCount: 8, receivedAmount: '500000.00', principalAppliedAmount: '420000.00', interestAppliedAmount: '80000.00' };
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];

function setup() {
  const port: PaymentHistoryPort = { list: vi.fn(async (query) => ({ items: [payment, { ...payment, paymentId: 'payment-2',
    status: 'ANNULLED' as const, installments: [], collector: null }], total: 25, page: query.page,
    pageSize: query.pageSize, summary })), options: vi.fn(async () => ({ paymentMethods: [
      { id: 'method-1', name: 'Transferencia', active: false }], collectors: [
      { id: 'collector-1', name: 'Bea Solís', active: false }] })) };
  const controller = new PaymentHistoryController(port, () => '2026-10-02');
  const onSelect = vi.fn(), onClose = vi.fn(), onExport = vi.fn();
  const props = (selected: PaymentHistoryItem | null = null) => ({ state: controller.getSnapshot(), controller,
    selected, onSelect, onClose, exporting: false, exportError: '', onExport });
  const view = (selected: PaymentHistoryItem | null = null) => renderToStaticMarkup(<MemoryRouter><PaymentHistoryView {...props(selected)} /></MemoryRouter>);
  return { port, controller, props, view, onSelect };
}

describe('payment history page', () => {
  it('opens with a Costa Rica date-only month range and sends filters and server paging', async () => {
    const { port, controller } = setup();
    expect(controller.getSnapshot().filters).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-02',
      search: '', loanNumber: '', status: '', paymentMethodId: '', collectorId: '' });
    expect(costaRicaDateOnly(new Date('2026-10-01T03:00:00Z'))).toBe('2026-09-30');
    await controller.load(); await controller.loadOptions();
    expect(port.list).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-10-01', endDate: '2026-10-02',
      sortBy: 'paymentDate', sortDir: 'desc', page: 1, pageSize: 20 }));
    controller.setPage(2); expect(controller.getSnapshot().page).toBe(2);
    controller.setFilter('search', 'Ana'); controller.setFilter('loanNumber', '4548');
    controller.setFilter('status', 'ANNULLED'); controller.setFilter('paymentMethodId', 'method-1');
    controller.setFilter('collectorId', 'collector-1');
    expect(port.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Ana', loanNumber: '4548',
      status: 'ANNULLED', paymentMethodId: 'method-1', collectorId: 'collector-1', page: 1 }));
    controller.setPage(2); controller.clear();
    expect(controller.getSnapshot()).toMatchObject({ page: 1, filters: { search: '', loanNumber: '', status: '',
      paymentMethodId: '', collectorId: '', startDate: '2026-10-01', endDate: '2026-10-02' } });
  });

  it('uses backend summary, date-only, installments, compact action and annulled badge', async () => {
    const { controller, props, view, onSelect } = setup(); await controller.load(); await controller.loadOptions();
    const html = view();
    for (const fragment of ['Historial de pagos', 'Consulta operativa y auditable de pagos históricos.',
      'PAGOS VÁLIDOS</span><strong>8', 'TOTAL RECIBIDO</span><strong>₡500.000,00',
      'CAPITAL APLICADO</span><strong>₡420.000,00', 'INTERÉS APLICADO</span><strong>₡80.000,00',
      '02/10/2026', 'Ana Pérez', '503520108 · 8888', '#4548', '<td>1, 2</td>', '<td>—</td>',
      'Anulado', 'Transferencia', 'Página 1 de 2 · 25 registros']) expect(html).toContain(fragment);
    const action = elements(PaymentHistoryView(props())).find((element) => element.type === TableActions)!;
    const actions = (action.props as Parameters<typeof TableActions>[0]).actions;
    expect(actions.map((item) => item.key)).toEqual(['view']); actions[0].onClick?.();
    expect(onSelect).toHaveBeenCalledWith(payment);
    expect(view(payment)).toContain('Detalle del pago');
    for (const value of ['₡500.000,00', '₡420.000,00', '₡80.000,00', 'Transferencia', 'Bea Solís', 'Válido'])
      expect(view(payment)).toContain(value);
    expect(view({ ...payment, status: 'ANNULLED', collector: null })).toContain('<dd>—</dd>');
    expect(view({ ...payment, status: 'ANNULLED', collector: null })).toContain('<dd>Anulado</dd>');
  });

  it('sorts and pages only through the backend and reports options and history errors', async () => {
    const { controller, port, view } = setup(); await controller.load();
    controller.setSort('customer'); expect(port.list).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'customer', sortDir: 'asc', page: 1 }));
    controller.setPage(2); expect(port.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    controller.setPageSize(10); expect(port.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
    vi.mocked(port.options).mockRejectedValueOnce(new Error('Opciones caídas')); await controller.loadOptions();
    expect(view()).toContain('Opciones: Opciones caídas');
    vi.mocked(port.list).mockRejectedValueOnce(new Error('Historial caído')); await controller.load();
    expect(view()).toContain('Historial caído');
    vi.mocked(port.list).mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10, summary });
    await controller.load(); expect(view()).toContain('No hay pagos para los filtros seleccionados.');
  });

  it('keeps the export button busy and shows a visible error when an export fails', async () => {
    const { controller, props } = setup(); await controller.load();
    const html = renderToStaticMarkup(<MemoryRouter><PaymentHistoryView {...props()} exporting
      exportError="No se pudo exportar el historial de pagos." /></MemoryRouter>);
    expect(html).toContain('disabled="" aria-busy="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('No se pudo exportar el historial de pagos.');
  });
});

describe('payment history PDF collection', () => {
  it('fetches all filtered pages before generating the PDF, regardless of the visible page', async () => {
    const { port, controller } = setup();
    vi.mocked(port.list).mockImplementation(async (query) => ({ items: Array.from({ length: query.page === 3 ? 1 : 100 },
      (_, index) => ({ ...payment, paymentId: `payment-${query.page}-${index}`, status: query.page === 3 ? 'ANNULLED' : 'VALID' })),
    total: 201, page: query.page, pageSize: query.pageSize, summary }));
    controller.setFilter('status', 'ANNULLED'); controller.setFilter('loanNumber', '4548');
    controller.setPage(2); const snapshot = controller.getSnapshot();
    const report = vi.fn(async (items: PaymentHistoryItem[]) => { expect(items).toHaveLength(201); });
    await exportPaymentHistory(controller, snapshot, report);
    const items = report.mock.calls[0][0] as PaymentHistoryItem[];
    expect(items).toHaveLength(201); expect(items[200].status).toBe('ANNULLED');
    expect(vi.mocked(port.list).mock.calls.slice(-3).map(([query]) => ({ status: query.status, loanNumber: query.loanNumber,
      page: query.page, pageSize: query.pageSize }))).toEqual([1, 2, 3].map((page) =>
      ({ status: 'ANNULLED', loanNumber: '4548', page, pageSize: 100 })));
  });

  it('does not generate a partial PDF when any page fails', async () => {
    const { port, controller } = setup(); const report = vi.fn(async () => {});
    vi.mocked(port.list).mockResolvedValueOnce({ items: [payment], total: 101, page: 1, pageSize: 100, summary })
      .mockRejectedValueOnce(new Error('Página fallida'));
    await expect(exportPaymentHistory(controller, controller.getSnapshot(), report)).rejects.toThrow('Página fallida');
    expect(report).not.toHaveBeenCalled();
  });
});
