import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CollectorCustodyEntry, CollectorCustodySummary } from '../../domain/entities/collector-custody';
import { CollectorTopUpDialog, CollectorWalletContent } from './CollectorCustodyPage';
import { MoneyInput } from '../components/MoneyInput';

const summary: CollectorCustodySummary = {
  collectorId: 'collector-private-id',
  declaredBalance: '25000.00',
  companyContributionAmount: '9000.00',
  confirmedBalance: '91000.00',
  pendingAmount: '82000.00',
  differenceAmount: '73000.00',
};

const movement = (overrides: Partial<CollectorCustodyEntry>): CollectorCustodyEntry => ({
  id: 'entry-private-id',
  collectorId: 'collector-private-id',
  direction: 'CREDIT',
  entryType: 'CUSTOMER_COLLECTION',
  amount: '15000.00',
  effectiveDate: '2026-10-12',
  paymentMethodId: 'method-private-id',
  reference: null,
  reason: null,
  notes: null,
  precollectionId: null,
  settlementId: null,
  reversedEntryId: null,
  createdByUserId: 'user-private-id',
  createdAt: '2026-10-12T15:00:00.000Z',
  ...overrides,
});

const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('')
  : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : '';

describe('collector wallet presentation', () => {
  it('renders loading and recoverable error states', () => {
    expect(renderToStaticMarkup(<CollectorWalletContent entries={[]} loading error="" onRetry={() => undefined} />))
      .toContain('Cargando Mi billetera');
    const retry = vi.fn();
    const errorView = CollectorWalletContent({ entries: [], loading: false, error: 'Servicio no disponible.', onRetry: retry });
    const button = elements(errorView).find((element) => element.type === 'button');
    expect(renderToStaticMarkup(errorView)).toContain('No pudimos cargar Mi billetera');
    expect(renderToStaticMarkup(errorView)).toContain('Servicio no disponible.');
    (button?.props as { onClick?: () => void }).onClick?.();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows reconciled custody components, entries, exits and faithful movement details without internal ids', () => {
    const entries = [movement({ reason: 'Cobro de cuota semanal' }), movement({
      id: 'exit-private-id', direction: 'DEBIT', entryType: 'REMITTANCE_TO_COMPANY', amount: '5000.00',
      effectiveDate: '2026-10-13', reference: 'REC-204',
    })];
    const html = renderToStaticMarkup(<CollectorWalletContent summary={summary} entries={entries} loading={false} error="" onRetry={() => undefined} />);
    expect(html).toContain('Saldo registrado bajo tu responsabilidad');
    expect(html).toContain('No confirma efectivo físico, conciliación administrativa ni saldo bancario disponible.');
    expect(html).toContain('Aportes de la empresa');
    expect(html).toContain('Cobros pendientes');
    expect(html).toContain('Saldo disponible');
    expect(html).toContain('₡9.000');
    expect(html).toContain('₡82.000');
    expect(html).toContain('₡91.000');
    expect(html).toContain('Entradas registradas');
    expect(html).toContain('Salidas registradas');
    expect(html).toContain('Cobro recibido y bajo custodia');
    expect(html).toContain('Cobro de cuota semanal');
    expect(html).toContain('Remesa entregada a la empresa');
    expect(html).toContain('Referencia: REC-204');
    expect(html).toContain('Entrada');
    expect(html).toContain('Salida');
    expect(html).not.toContain('Diferencia');
    expect(html).not.toContain('collector-private-id');
    expect(html).not.toContain('method-private-id');
    expect(html).not.toContain('user-private-id');
  });

  it('explains the empty history without inventing movements', () => {
    const html = renderToStaticMarkup(<CollectorWalletContent summary={summary} entries={[]} loading={false} error="" onRetry={() => undefined} />);
    expect(html).toContain('Todavía no hay entradas ni salidas registradas en tu custodia.');
    expect(html).toContain('0 movimientos');
  });
});

describe('collector company top-up dialog', () => {
  const form = { amount: '1234567.89', date: '2026-10-12', paymentMethodId: 'method-2', reference: 'REF-20', reason: 'Capital de trabajo', notes: 'Entrega inicial', direction: 'CREDIT' as const };
  const methods = [{ id: 'method-1', name: 'Efectivo', order: 1, isActive: true }, { id: 'method-2', name: 'Transferencia', order: 2, isActive: true }];

  it('renders active catalog names, CRC money input and the dedicated submit label', () => {
    const view = CollectorTopUpDialog({ form, methods, loadingMethods: false, busy: false, error: '', fieldErrors: {}, update: vi.fn(), close: vi.fn(), save: vi.fn() });
    const tree = elements(view);
    const method = tree.find((element) => element.type === 'select')!;
    const options = elements(method).filter((element) => element.type === 'option');
    expect(options.map((option) => text((option.props as { children?: ReactNode }).children))).toEqual(['Seleccionar', 'Efectivo', 'Transferencia']);
    expect(options.map((option) => (option.props as { value?: string }).value)).toEqual(['', 'method-1', 'method-2']);
    expect(tree.some((element) => element.type === MoneyInput && (element.props as { value?: string }).value === '1234567.89')).toBe(true);
    const html = renderToStaticMarkup(view);
    expect(html).toContain('Monto en colones'); expect(html).toContain('Forma de entrega'); expect(html).toContain('Registrar aporte');
    expect(html).not.toContain('ID de forma de pago'); expect(html).not.toContain('Registrar movimiento');
  });

  it('shows field-level errors and blocks controls during submission', () => {
    const view = CollectorTopUpDialog({ form, methods, loadingMethods: false, busy: true, error: 'Revisá los campos indicados.', fieldErrors: { amount: 'Ingresá un monto mayor que cero.', paymentMethodId: 'Seleccioná una forma de entrega.' }, update: vi.fn(), close: vi.fn(), save: vi.fn() });
    const tree = elements(view); const buttons = tree.filter((element) => element.type === 'button');
    expect(tree.find((element) => element.type === MoneyInput)?.props).toMatchObject({ disabled: true, 'aria-invalid': true });
    expect(tree.find((element) => element.type === 'select')?.props).toMatchObject({ disabled: true, 'aria-invalid': true });
    expect(buttons.every((button) => (button.props as { disabled?: boolean }).disabled)).toBe(true);
    expect(renderToStaticMarkup(view)).toContain('Registrando…');
  });
});
