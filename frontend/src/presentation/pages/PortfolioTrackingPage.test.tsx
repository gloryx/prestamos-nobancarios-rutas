import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PortfolioTrackingController, type PortfolioTrackingState } from '../../application/use-cases/portfolio-tracking-controller';
import type { PortfolioTrackingResult } from '../../domain/entities/portfolio-tracking';
import { PortfolioTrackingView } from './PortfolioTrackingPage';

const data: PortfolioTrackingResult = {
  position: 3, total: 7, hasPrevious: true, hasNext: true,
  loan: { id: 'loan-1', status: 'ACTIVE', collectionStatus: 'OVERDUE', startDate: '2026-01-02', contractualDueDate: '2026-12-20',
    context: { summary: { loanId: 'loan-1', loanNumber: '9', status: 'ACTIVE', identification: '101', customerName: 'Ana Mora',
      principal: '70.00', interestAmount: '30.00', totalAmount: '100.00' },
    balances: { outstandingPrincipal: '40.00', outstandingInterest: '20.00', financialBalance: '60.00' },
    combinedPlan: [{ id: 'entry-0', sequence: 1, dueDate: '2000-01-01', pendingAmount: '10.00' },
      { id: 'entry-1', sequence: 2, dueDate: '2099-12-20', pendingAmount: '50.00' }],
    protectedPlanEntryIds: [],
    validPayments: [{ id: 'payment-1', paymentDate: '2026-01-20', amount: '40.00', status: 'VALID' }],
    firstOperationalRow: { id: 'entry-1', sequence: 2, dueDate: '2099-12-20', pendingAmount: '60.00' },
    lastValidPayment: { id: 'payment-1', paymentDate: '2026-01-20', amount: '40.00', status: 'VALID' }, refinanceEligibility: true,
    preferredMethod: { id: null, activeMethods: [], collectors: [] }, paymentFrequency: { intervalUnit: 'WEEK', intervalValue: 1 } } },
};
const state = (changes: Partial<PortfolioTrackingState> = {}): PortfolioTrackingState => ({
  filters: { search: '', status: 'ALL', collectionStatus: 'ALL' }, position: 3, data, loading: false, error: null, ...changes,
});
const controller = (): PortfolioTrackingController => ({ setFilter: vi.fn(), setPosition: vi.fn() } as unknown as PortfolioTrackingController);
const elements = (node: ReactNode): ReactElement[] => Children.toArray(node).flatMap((child) =>
  isValidElement(child) ? [child, ...elements((child.props as { children?: ReactNode }).children)] : []);

describe('PortfolioTrackingView', () => {
  it('shows filters, exact positional navigation and canonical financial context and plan', () => {
    const html = renderToStaticMarkup(<PortfolioTrackingView state={state()} controller={controller()} />);
    expect(html).toContain('Buscar cliente');
    expect(html).toContain('Estado');
    expect(html).toContain('Cobranza');
    for (const option of ['Todos', 'Activos', 'Incobrables', 'Al día', 'Vence hoy', 'Con cuota vencida', 'Plazo cumplido'])
      expect(html).toContain(`>${option}<`);
    for (const excluded of ['Cancelados', 'Refinanciados', 'Anulados']) expect(html).not.toContain(`>${excluded}<`);
    expect(html).toContain('<option value="PENDING">Vence hoy</option>');
    expect(html).not.toContain('Con cuota pendiente');
    expect(html).toContain('« Primero');
    expect(html).toContain('‹ Anterior');
    expect(html).toContain('Préstamo 3 de 7');
    expect(html).toContain('Siguiente ›');
    expect(html).toContain('Último »');
    expect(html).toContain('Ana Mora');
    expect(html).toContain('Préstamo #9');
    expect(html).toContain('Con cuota vencida');
    expect(html).toContain('₡70');
    expect(html).toContain('₡30');
    expect(html).toContain('₡40');
    expect(html).toContain('₡20');
    expect(html).toContain('₡60');
    expect(html).toContain('Fecha límite contractual');
    expect(html).toContain('Plan de pagos');
    expect(html).toContain('PAGADA');
    expect(html).toContain('VENCIDA');
    expect(html).toContain('PENDIENTE');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Plan de pagos"');
    expect(html).toContain('tabindex="0"');
    expect((html.match(/scope="col"/g) ?? [])).toHaveLength(6);
    expect(html).not.toMatch(/Registrar pago|Anular pago|Personalizar plan/);
  });

  it('wires first, previous, next and last to positions within the filtered result', () => {
    const supplied = controller();
    const tree = PortfolioTrackingView({ state: state(), controller: supplied });
    const buttons = elements(tree).filter((element) => element.type === 'button');
    for (const button of buttons) {
      const label = String((button.props as { children?: ReactNode }).children);
      if (label.includes('Primero') || label.includes('Anterior') || label.includes('Siguiente') || label.includes('Último'))
        (button.props as { onClick: () => void }).onClick();
    }
    expect(supplied.setPosition).toHaveBeenNthCalledWith(1, 1);
    expect(supplied.setPosition).toHaveBeenNthCalledWith(2, 2);
    expect(supplied.setPosition).toHaveBeenNthCalledWith(3, 4);
    expect(supplied.setPosition).toHaveBeenNthCalledWith(4, 7);
  });

  it('clears previous details and disables navigation when no criteria match', () => {
    const empty = { position: 0, total: 0, hasPrevious: false, hasNext: false, loan: null };
    const html = renderToStaticMarkup(<PortfolioTrackingView state={state({ position: 1, data: empty })} controller={controller()} />);
    expect(html).toContain('No se encontraron préstamos para los criterios seleccionados.');
    expect(html).toContain('Préstamo 0 de 0');
    expect(html).not.toContain('Ana Mora');
    expect(html).not.toContain('Plan de pagos');
    expect((html.match(/disabled=""/g) ?? [])).toHaveLength(4);
  });

  it('disables backward controls on the first result and forward controls on the last result', () => {
    const first = renderToStaticMarkup(<PortfolioTrackingView state={state({ position: 1,
      data: { ...data, position: 1, hasPrevious: false } })} controller={controller()} />);
    const last = renderToStaticMarkup(<PortfolioTrackingView state={state({ position: 7,
      data: { ...data, position: 7, hasNext: false } })} controller={controller()} />);
    expect((first.match(/disabled=""/g) ?? [])).toHaveLength(2);
    expect((last.match(/disabled=""/g) ?? [])).toHaveLength(2);
    expect(first).toContain('Préstamo 1 de 7');
    expect(last).toContain('Préstamo 7 de 7');
  });

  it('shows loading and retryable errors without retaining loan details', () => {
    const loading = renderToStaticMarkup(<PortfolioTrackingView state={state({ data: null, loading: true })} controller={controller()} />);
    const failed = renderToStaticMarkup(<PortfolioTrackingView state={state({ data: null, error: new Error('No disponible') })} controller={controller()} />);
    expect(loading).toContain('role="status"');
    expect(loading).not.toContain('Ana Mora');
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Reintentar');
    expect(failed).not.toContain('Ana Mora');
  });
});
