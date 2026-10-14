import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CollectorPrecollectionDetail } from '../../domain/entities/collector-precollection';
import { collectorPrecollectionEmptyMessage } from '../helpers/stage3b';
import { CollectorDateNavigation, PrecollectionDetail } from './CollectorPrecollectionsPage';

const elements = (node: ReactNode): ReactElement[] => Children.toArray(node).flatMap((child) =>
  isValidElement(child) ? [child, ...elements((child.props as { children?: ReactNode }).children)] : []);

describe('collector precollection date navigation', () => {
  it('shows the selected date and navigates across month and year boundaries', () => {
    const onChange = vi.fn();
    const view = CollectorDateNavigation({ date: '2026-01-01', today: '2027-01-02', onChange });
    const buttons = elements(view).filter((element) => element.type === 'button');
    const button = (label: string) => buttons.find((element) => (element.props as { children?: ReactNode }).children === label);

    expect(renderToStaticMarkup(view)).toContain('Fecha seleccionada:</strong> 01/01/2026');
    (button('Anterior')?.props as { onClick?: () => void }).onClick?.();
    (button('Siguiente')?.props as { onClick?: () => void }).onClick?.();
    (button('Hoy')?.props as { onClick?: () => void }).onClick?.();

    expect(onChange.mock.calls.map(([date]) => date)).toEqual(['2025-12-31', '2026-01-02', '2027-01-02']);
  });

  it('identifies today, prevents future navigation and explains an empty selected day', () => {
    const onChange = vi.fn();
    const view = CollectorDateNavigation({ date: '2026-10-12', today: '2026-10-12', onChange });
    const html = renderToStaticMarkup(view);
    const next = elements(view).find((element) => element.type === 'button' &&
      (element.props as { children?: ReactNode }).children === 'Siguiente');

    expect(html).toContain('Fecha seleccionada:</strong> Hoy · 12/10/2026');
    expect((next?.props as { disabled?: boolean }).disabled).toBe(true);
    expect(collectorPrecollectionEmptyMessage('2026-10-12')).toBe('No hay cobros registrados para el 12/10/2026.');
  });
});

const detail = (status: CollectorPrecollectionDetail['status'] = 'RECORDED'): CollectorPrecollectionDetail => ({
  id: 'pre-1', receiptNumber: 'CP-000000000001', collectorId: 'collector', collectorUserId: 'user',
  customerId: 'customer', loanId: 'loan', routeId: 'route',
  customerRouteAssignmentId: 'customer-route', collectorRouteAssignmentId: 'collector-route', paymentMethodId: 'method',
  custodyTreatment: 'COLLECTOR_HELD', amount: '25.00', customerBalanceBefore: '70.00', customerBalanceAfter: '45.00',
  effectiveDate: '2026-10-10', reference: 'REC-1', notes: null,
  status, recordedByUserId: 'user', recordedAt: '2026-10-10T12:00:00Z', cancelledByUserId: null, cancelledAt: null,
  cancellationReason: status === 'CANCELLED' ? 'Duplicado' : null, collectorName: 'Carlos', customerName: 'Ana',
  customerIdentification: '1', customerPhone: '88887777', customerSecondaryPhone: null, loanNumber: '42', routeName: 'Centro', paymentMethodName: 'SINPE',
  recordedByName: 'Carlos', cancelledByName: null, financialBalance: '80.00', reservedPrecollections: '35.00', operationalBalance: '45.00',
});

describe('collector precollection detail', () => {
  it('shows live balance projections and receipt actions without presenting a definitive payment', () => {
    const html = renderToStaticMarkup(<PrecollectionDetail item={detail()} close={vi.fn()} />);
    expect(html).toContain('Saldo financiero confirmado'); expect(html).toContain('₡80');
    expect(html).toContain('Precolecciones pendientes'); expect(html).toContain('₡35');
    expect(html).toContain('Saldo estimado'); expect(html).toContain('₡45');
    expect(html).toContain('Descargar comprobante'); expect(html).toContain('Compartir comprobante');
    expect(html).toContain('no acredita por sí solo un pago financiero definitivamente aplicado');
  });

  it('shows cancelled records as cancelled with their reason', () => {
    const html = renderToStaticMarkup(<PrecollectionDetail item={detail('CANCELLED')} close={vi.fn()} />);
    expect(html).toContain('Cancelado'); expect(html).toContain('Duplicado');
  });
});
