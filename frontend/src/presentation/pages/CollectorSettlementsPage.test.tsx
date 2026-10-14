import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CollectorSettlementDetail, EligibleCollectorPrecollectionPage } from '../../domain/entities/collector-settlement';
import { CollectorSettlementDetail as CollectorSettlementDetailView, EligiblePrecollectionsPanel } from './CollectorSettlementsPage';

const result: EligibleCollectorPrecollectionPage = {
  items: [{ id: 'pre-1', receiptNumber: 'CP-000000000001', customerName: 'Ana Mora', loanNumber: '4764',
    paymentMethodName: 'Efectivo', amount: '50000.00', effectiveDate: '2026-10-12' }],
  total: 101,
  page: 1,
  pageSize: 20,
  totalPages: 6,
  summary: { availableCount: 101, availableAmount: '110000.00', draftReservedCount: 2,
    draftReservedAmount: '70000.00', submittedOrUnderReviewCount: 3, submittedOrUnderReviewAmount: '90000.00' },
};

const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('')
  : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : '';

const settlement = (status: CollectorSettlementDetail['status'] = 'DRAFT'): CollectorSettlementDetail => ({
  id: 'technical-settlement-id', collectorId: 'technical-collector-id', collectorUserId: 'technical-user-id', status,
  totalDeclared: '180000.00', totalConfirmed: status === 'CONFIRMED' ? '180000.00' : '0.00',
  amountDelivered: status === 'CONFIRMED' ? '120000.00' : '0.00', retainedAmount: status === 'CONFIRMED' ? '60000.00' : '0.00',
  differenceAmount: '0.00', deliveryDate: status === 'CONFIRMED' ? '2026-10-14' : null,
  deliveryPaymentMethodId: null, deliveryReference: status === 'CONFIRMED' ? 'ENT-18' : null, deliveryNotes: null,
  reason: null, createdByUserId: 'technical-user-id', createdAt: '2026-10-14T15:00:00.000Z',
  submittedByUserId: null, submittedAt: null, reviewedByUserId: null, reviewedAt: null,
  confirmedByUserId: null, confirmedAt: null, rejectedByUserId: null, rejectedAt: null,
  cancelledByUserId: null, cancelledAt: null,
  items: [
    ['ALVARO EMILIO VEGA FONSECA', '4735', '2026-10-13', '10000.00'],
    ['CECILIA ZUNIGA ZUNIGA', '4751', '2026-10-14', '10000.00'],
    ['ROLANDO ANTONIO DURAN ROMERO', '4764', '2026-10-12', '50000.00'],
    ['CECILIA ZUNIGA ZUNIGA', '4751', '2026-10-14', '60000.00'],
    ['ROLANDO ANTONIO DURAN ROMERO', '4764', '2026-10-13', '50000.00'],
  ].map(([customerName, loanNumber, effectiveDate, declaredAmount], index) => ({ id: `technical-item-${index}`,
    settlementId: 'technical-settlement-id', precollectionId: `technical-precollection-${index}`, customerName,
    loanNumber, effectiveDate, declaredAmount, confirmedAmount: status === 'CONFIRMED' ? declaredAmount : null, paymentId: null })),
  actions: [],
});

describe('collector settlement eligibility presentation', () => {
  it('shows backend totals, an explicit page and selection without a today-only message', () => {
    const onSelection = vi.fn(); const onPage = vi.fn();
    const view = EligiblePrecollectionsPanel({ result, selectedIds: [], busy: false, canCreate: true,
      onSelection, onCreate: vi.fn(), onPage });
    const html = renderToStaticMarkup(view);
    expect(html).toContain('Todos tus cobros registrados y libres, sin limitarse a la fecha de hoy.');
    expect(html).toContain('Libres para liquidar'); expect(html).toContain('₡110.000');
    expect(html).toContain('Reservados en borradores'); expect(html).toContain('₡70.000');
    expect(html).toContain('Enviados o en revisión'); expect(html).toContain('₡90.000');
    expect(html).toContain('CP-000000000001');
    expect(html).toContain('Página 1 de 6 · 101 cobros libres');
    const tree = elements(view);
    (tree.find((element) => element.type === 'input')?.props as { onChange?: (event: { target: { checked: boolean } }) => void })
      .onChange?.({ target: { checked: true } });
    (tree.find((element) => element.type === 'button' && (element.props as { children?: ReactNode }).children === 'Siguiente')?.props as { onClick?: () => void }).onClick?.();
    expect(onSelection).toHaveBeenCalledWith(['pre-1']);
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('does not render the create action without the centralized permission result', () => {
    const html = renderToStaticMarkup(<EligiblePrecollectionsPanel result={result} selectedIds={[]} busy={false}
      canCreate={false} onSelection={vi.fn()} onCreate={vi.fn()} onPage={vi.fn()} />);
    expect(html).not.toContain('Crear borrador');
  });
});

describe('collector settlement detail presentation', () => {
  it('renders five identifiable collections totaling CRC 180,000 without technical ids and preserves actions', () => {
    const close = vi.fn(); const act = vi.fn();
    const view = CollectorSettlementDetailView({ item: settlement(), actions: ['submit', 'cancel'], close, act });
    const html = renderToStaticMarkup(view);
    expect(html).toContain('Total declarado'); expect(html).toContain('₡180.000'); expect(html).toContain('5 cobros incluidos');
    expect(html).toContain('ALVARO EMILIO VEGA FONSECA'); expect(html).toContain('CECILIA ZUNIGA ZUNIGA');
    expect(html).toContain('ROLANDO ANTONIO DURAN ROMERO');
    expect(html).toContain('Préstamo 4735'); expect(html).toContain('Préstamo 4751'); expect(html).toContain('Préstamo 4764');
    expect(html).toContain('12/10/2026'); expect(html).toContain('13/10/2026'); expect(html).toContain('14/10/2026');
    expect(html).not.toContain('technical-item'); expect(html).not.toContain('technical-precollection');
    expect(html).not.toContain('<span>Confirmado</span>'); expect(html).not.toContain('<span>Entregado</span>');
    const buttons = elements(view).filter((element) => element.type === 'button');
    const click = (label: string) => (buttons.find((button) => text((button.props as { children?: ReactNode }).children) === label)?.props as { onClick?: () => void }).onClick?.();
    click('Cerrar'); click('Enviar'); click('Cancelar');
    expect(close).toHaveBeenCalledOnce(); expect(act.mock.calls).toEqual([['submit'], ['cancel']]);
  });

  it('shows confirmed, delivered, retained and difference only after confirmation', () => {
    const html = renderToStaticMarkup(<CollectorSettlementDetailView item={settlement('CONFIRMED')} actions={[]}
      close={vi.fn()} act={vi.fn()} />);
    expect(html).toContain('Resultado confirmado'); expect(html).toContain('<span>Confirmado</span>');
    expect(html).toContain('<span>Entregado</span>'); expect(html).toContain('<span>Retenido</span>');
    expect(html).toContain('<span>Diferencia</span>'); expect(html).toContain('referencia ENT-18');
  });
});
