import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CollectorCustodyEntry, CollectorCustodySummary } from '../../domain/entities/collector-custody';
import { CollectorWalletContent } from './CollectorCustodyPage';

const summary: CollectorCustodySummary = {
  collectorId: 'collector-private-id',
  declaredBalance: '25000.00',
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

  it('shows the registered balance, entries, exits and faithful movement details without administrative metrics or internal ids', () => {
    const entries = [movement({ reason: 'Cobro de cuota semanal' }), movement({
      id: 'exit-private-id', direction: 'DEBIT', entryType: 'REMITTANCE_TO_COMPANY', amount: '5000.00',
      effectiveDate: '2026-10-13', reference: 'REC-204',
    })];
    const html = renderToStaticMarkup(<CollectorWalletContent summary={summary} entries={entries} loading={false} error="" onRetry={() => undefined} />);
    expect(html).toContain('Saldo registrado bajo tu responsabilidad');
    expect(html).toContain('No confirma efectivo físico, conciliación administrativa ni saldo bancario disponible.');
    expect(html).toContain('Entradas registradas');
    expect(html).toContain('Salidas registradas');
    expect(html).toContain('Cobro recibido y bajo custodia');
    expect(html).toContain('Cobro de cuota semanal');
    expect(html).toContain('Remesa entregada a la empresa');
    expect(html).toContain('Referencia: REC-204');
    expect(html).toContain('Entrada');
    expect(html).toContain('Salida');
    expect(html).not.toContain('Saldo confirmado');
    expect(html).not.toContain('Pendiente');
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
