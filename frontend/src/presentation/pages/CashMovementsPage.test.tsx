import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListCashMovements } from '../../application/use-cases/cash-movement.use-cases';
import { cashMovementUseCases } from '../../app/cash-movements';
import { apiClient } from '../../infrastructure/api/api-client';
import type { CashMovement } from '../../domain/entities/cash-movement';
import type { AuthIdentity } from '../../domain/entities/auth';
import { TableActions, type TableAction } from '../components/TableActions';
import { canAccess } from '../hooks/auth-permissions';
import { CashMovementsPage } from './CashMovementsPage';

const harness = vi.hoisted(() => ({
  values: [] as unknown[], refs: [] as { current: boolean }[], index: 0, refIndex: 0,
  identity: undefined as AuthIdentity | undefined,
  pdfFiles: [] as { filename: string; contents: string }[],
  excelFiles: [] as { filename: string; signature: string; workbook: import('xlsx').WorkBook }[],
  failPdf: false, failExcel: false,
}));

vi.mock('react', async (importOriginal) => ({ ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.values)) harness.values[index] = initial;
    return [harness.values[index], (next: unknown) => { harness.values[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(harness.values[index]) : next; }];
  },
  useRef: (initial: boolean) => {
    const index = harness.refIndex++;
    return harness.refs[index] ??= { current: initial };
  },
}));
vi.mock('../hooks/auth-context', () => ({ useAuth: () => ({ can: (code: string) => canAccess(harness.identity, code) }) }));
vi.mock('jspdf', async (importOriginal) => {
  const original = await importOriginal<typeof import('jspdf')>();
  return { ...original, jsPDF: class extends original.jsPDF {
    constructor() { super(); this.save = ((filename: string) => {
      if (harness.failPdf) throw new Error('PDF save failed');
      harness.pdfFiles.push({ filename, contents: this.output() }); return this;
    }) as unknown as typeof this.save; }
  } };
});
vi.mock('xlsx', async (importOriginal) => {
  const original = await importOriginal<typeof import('xlsx')>();
  return { ...original, writeFile: (workbook: import('xlsx').WorkBook, filename: string) => {
    if (harness.failExcel) throw new Error('Excel write failed');
    harness.excelFiles.push({ filename, workbook, signature: original.write(workbook, { bookType: 'xlsx', type: 'binary' }).slice(0, 4) });
  } };
});

const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
const renderPage = () => { harness.index = 0; harness.refIndex = 0; return CashMovementsPage(); };
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('')
  : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : '';
const exportButton = (name: 'PDF' | 'Excel') => {
  const button = elements(renderPage()).filter((item) => item.type === 'button' && 'aria-busy' in (item.props as object))[name === 'PDF' ? 0 : 1];
  if (!button) throw new Error(`Missing ${name} export button`);
  return button;
};
const click = (name: 'PDF' | 'Excel') => (exportButton(name).props as { onClick: () => void }).onClick();
const alert = () => elements(renderPage()).find((item) => (item.props as { role?: string }).role === 'alert');
const movement = (index: number): CashMovement => ({ id: `movement-${index}`, direction: 'OUTFLOW', concept: 'LOAN_DISBURSEMENT', amount: '125.50',
  movementDate: '2026-09-12', loanNumber: '42', reversedConcept: null,
  paymentMethod: { id: 'cash', name: 'Efectivo', isActive: true }, observations: null, reversedMovementId: null,
  createdBy: { id: 'user', fullName: `Person ${index}` }, createdAt: '2026-09-12T12:00:00Z' });
const formats = ['PDF', 'Excel'] as const;

describe('cash movement export actions', () => {
  beforeEach(() => {
    harness.values = []; harness.refs = []; harness.pdfFiles = []; harness.excelFiles = []; harness.failPdf = false; harness.failExcel = false;
    harness.identity = { id: 'user', username: 'user', fullName: 'User', role: { id: 'role', code: 'STAFF', name: 'Staff', isSuperAdmin: false }, permissions: ['cash-movements.export'] };
    vi.restoreAllMocks();
  });

  it('uses the real ListCashMovements receiver when Excel is clicked', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    expect(cashMovementUseCases.list).toBeInstanceOf(ListCashMovements);
    click('Excel');
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.calls[0][0]).toBe('/cash-movements?page=1&pageSize=100');
    await vi.waitFor(() => expect(harness.excelFiles).toHaveLength(1));
  });

  it.each(formats)('exports %s with the current filters, real report writer, and one authenticated list GET', async (format) => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ items: [movement(0)], total: 1, page: 1, pageSize: 100 });
    renderPage();
    harness.values[4] = { fromDate: '2026-09-01', toDate: '2026-09-30', direction: 'OUTFLOW', concept: 'LOAN_DISBURSEMENT', paymentMethodId: 'cash', search: 'Ana' };
    harness.values[1] = { inflows: '100.00', outflows: '125.50', net: '-25.50', currentAvailable: '74.50', openingDate: '2026-09-01' };
    const button = exportButton(format);
    expect((button.props as { type: string }).type).toBe('button');
    expect(text((button.props as { children: ReactNode }).children)).toContain(`Exportar ${format}`);
    click(format);
    await vi.waitFor(() => expect(format === 'PDF' ? harness.pdfFiles : harness.excelFiles).toHaveLength(1));
    expect(request).toHaveBeenCalledOnce();
    const [path, options] = request.mock.calls[0];
    expect(options).toBeUndefined();
    expect(path.split('?')[0]).toBe('/cash-movements');
    expect(Object.fromEntries(new URLSearchParams(path.split('?')[1]))).toEqual({
      fromDate: '2026-09-01', toDate: '2026-09-30', direction: 'OUTFLOW', concept: 'LOAN_DISBURSEMENT', paymentMethodId: 'cash', search: 'Ana', page: '1', pageSize: '100',
    });
    const filename = `movimientos-caja-${new Date().toISOString().slice(0, 10)}.${format === 'PDF' ? 'pdf' : 'xlsx'}`;
    if (format === 'PDF') {
      expect(harness.pdfFiles[0].filename).toBe(filename);
      expect(harness.pdfFiles[0].contents.slice(0, 5)).toBe('%PDF-');
      expect(harness.pdfFiles[0].contents).toContain('Person 0');
    } else {
      const file = harness.excelFiles[0];
      expect(file.filename).toBe(filename);
      expect(file.signature.slice(0, 2)).toBe('PK');
      const sheet = file.workbook.Sheets['Movimientos de caja'];
      expect(sheet.D11.v).toBe('Préstamo #42');
      expect(sheet.F11.v).toBe(-125.5);
      expect(sheet.B7.v).toBe(125.5);
    }
    expect((exportButton(format).props as { 'aria-busy': boolean; disabled: boolean })['aria-busy']).toBe(false);
    expect(alert()).toBeUndefined();
  });

  it.each(formats)('collects all filtered pages before writing %s', async (format) => {
    const request = vi.spyOn(apiClient, 'request').mockImplementation(async (path) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      return { items: page === 1 ? Array.from({ length: 100 }, (_, index) => movement(index)) : [movement(100)], total: 101, page, pageSize: 100 } as never;
    });
    click(format);
    await vi.waitFor(() => expect(format === 'PDF' ? harness.pdfFiles : harness.excelFiles).toHaveLength(1));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([path]) => new URLSearchParams(path.split('?')[1]).get('page'))).toEqual(['1', '2']);
    expect(request.mock.calls.every(([path]) => new URLSearchParams(path.split('?')[1]).get('pageSize') === '100')).toBe(true);
    if (format === 'PDF') expect(harness.pdfFiles[0].contents).toContain('Person 100');
    else expect(harness.excelFiles[0].workbook.Sheets['Movimientos de caja'].G111.v).toBe('Person 100');
  });

  it.each(formats)('shows and clears %s errors while preventing duplicate clicks before rerender', async (format) => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<never>((_, fail) => { reject = fail; });
    const request = vi.spyOn(apiClient, 'request').mockReturnValueOnce(pending).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    const first = exportButton(format);
    (first.props as { onClick: () => void }).onClick();
    (first.props as { onClick: () => void }).onClick();
    click(format);
    expect(request).toHaveBeenCalledOnce();
    const busy = exportButton(format).props as { 'aria-busy': boolean; disabled: boolean; children: ReactNode };
    expect(busy['aria-busy']).toBe(true);
    expect(busy.disabled).toBe(true);
    expect(text(busy.children)).toContain('Exportando…');
    expect((exportButton(format === 'PDF' ? 'Excel' : 'PDF').props as { disabled: boolean }).disabled).toBe(false);
    expect(elements(renderPage()).find((element) => element.type === 'select')).toBeDefined();
    reject(new Error('Network unavailable'));
    await vi.waitFor(() => expect(text(alert())).toBe(`No fue posible exportar los movimientos a ${format}.`));
    expect((exportButton(format).props as { 'aria-busy': boolean; disabled: boolean })['aria-busy']).toBe(false);
    expect((exportButton(format).props as { disabled: boolean }).disabled).toBe(false);
    click(format);
    expect(alert()).toBeUndefined();
    await vi.waitFor(() => expect(format === 'PDF' ? harness.pdfFiles : harness.excelFiles).toHaveLength(1));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(formats)('recovers from %s writer errors without leaving the button busy', async (format) => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    if (format === 'PDF') harness.failPdf = true;
    else harness.failExcel = true;
    click(format);
    await vi.waitFor(() => expect(text(alert())).toBe(`No fue posible exportar los movimientos a ${format}.`));
    expect((exportButton(format).props as { 'aria-busy': boolean })['aria-busy']).toBe(false);
    if (format === 'PDF') harness.failPdf = false;
    else harness.failExcel = false;
    click(format);
    expect(alert()).toBeUndefined();
    await vi.waitFor(() => expect(format === 'PDF' ? harness.pdfFiles : harness.excelFiles).toHaveLength(1));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('hides exports without permission, retains create and reverse gates, and allows superadmin centrally', () => {
    harness.identity = { ...harness.identity!, permissions: ['cash-movements.view', 'cash-movements.create', 'cash-movements.reverse'] };
    const denied = elements(renderPage());
    expect(denied.filter((item) => item.type === 'button' && 'aria-busy' in (item.props as object))).toHaveLength(0);
    expect(canAccess(harness.identity, 'cash-movements.export')).toBe(false);
    harness.values[2] = true;
    expect(elements(renderPage()).some((item) => item.type === 'button' && text((item.props as { children?: ReactNode }).children) === 'Nuevo movimiento')).toBe(true);
    harness.values[0] = [{ ...movement(0), concept: 'OPERATING_EXPENSE' }];
    const rowActions = elements(renderPage()).find((item) => item.type === TableActions)!;
    expect((rowActions.props as { actions: TableAction[] }).actions.map((action) => action.key)).toEqual(['reverse']);
    expect(elements(renderPage()).some((item) => item.type === 'span' && text((item.props as { children?: ReactNode }).children) === 'Gasto operativo')).toBe(true);
    harness.identity = { ...harness.identity, permissions: ['cash-movements.export', 'cash-movements.view'] };
    expect(elements(renderPage()).filter((item) => item.type === 'button' && 'aria-busy' in (item.props as object))).toHaveLength(2);
    harness.identity = { ...harness.identity, permissions: [], role: { ...harness.identity.role, isSuperAdmin: true } };
    expect(canAccess(harness.identity, 'cash-movements.view')).toBe(true);
    expect(elements(renderPage()).filter((item) => item.type === 'button' && 'aria-busy' in (item.props as object))).toHaveLength(2);
  });
});
