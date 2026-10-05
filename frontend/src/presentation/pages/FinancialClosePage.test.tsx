import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FinancialCloseController, type FinancialClosePort, type FinancialCloseState } from '../../application/use-cases/financial-close-controller';
import type { FinancialClosePreview } from '../../domain/entities/financial-close';
import { FinancialCloseView } from './FinancialClosePage';

const section = (values: Record<string, string>, status: 'OK' | 'WARNING' | 'ERROR' = 'OK') => ({ values, status });
const preview: FinancialClosePreview = { period: '2026-10', errors: [], warnings: [{ message: 'Revisar diferencia menor.', section: 'reconciliations' }],
  sections: { liquidity: section({ saldoFinal: '1000.00' }), contractualPortfolio: section({ principal: '800.00' }),
    economicCapital: section({ capital: '700.00' }), refinancings: section({ cadenas: '2' }),
    profitability: section({ ganancia: '50.00' }), reconciliations: section({ coincide: 'Sí' }, 'WARNING') } };
const api: FinancialClosePort = { preview: async () => preview, confirm: vi.fn(async () => ({ ...preview, id: 'close-1', confirmedAt: '2026-11-01' })),
  list: async () => [], detail: async () => ({ ...preview, id: 'close-1', confirmedAt: '2026-11-01' }) };
const controller = () => new FinancialCloseController(api, '2026-10');
const state = (changes: Partial<FinancialCloseState> = {}): FinancialCloseState => ({ period: '2026-10', preview,
  history: [{ id: 'close-1', period: '2026-09', confirmedAt: '2026-10-01T12:00:00Z', confirmedBy: 'Ana' }],
  detail: null, loading: false, confirming: false, detailLoading: false, confirmationOpen: false,
  error: '', detailError: '', success: '', ...changes });
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
const render = (value: FinancialCloseState, canConfirm = true) => renderToStaticMarkup(
  <FinancialCloseView state={value} controller={controller()} canConfirm={canConfirm} />);

describe('monthly financial close page', () => {
  it('renders every preview section, warnings and immutable history without replacing profitability', () => {
    const html = render(state());
    for (const text of ['Cierre financiero mensual', 'Liquidez', 'Cartera contractual', 'Capital económico',
      'Refinanciaciones', 'Rentabilidad', 'Conciliaciones', 'Advertencias para revisar', 'Revisar diferencia menor.',
      'Historial de cierres', 'Ver cierre inmutable de 2026-09']) expect(html).toContain(text);
  });

  it('hides confirmation without permission and disables it when errors exist', () => {
    expect(render(state(), false)).not.toContain('Confirmar cierre</button>');
    const blocked = { ...preview, errors: [{ message: 'Falta conciliación.' }] };
    const html = render(state({ preview: blocked }));
    expect(html).toContain('Errores que impiden confirmar'); expect(html).toContain('disabled=""');
  });

  it('uses an explicit second action before confirmation', () => {
    const current = controller(); const request = vi.spyOn(current, 'requestConfirmation');
    const tree = elements(FinancialCloseView({ state: state(), controller: current, canConfirm: true }));
    const first = tree.find((element) => element.type === 'button' &&
      (element.props as { children?: ReactNode }).children === 'Confirmar cierre');
    (first?.props as { onClick?: () => void }).onClick?.(); expect(request).toHaveBeenCalledOnce();
    const dialog = render(state({ confirmationOpen: true }));
    expect(dialog).toContain('Sí, confirmar cierre'); expect(dialog).toContain('no podrá editarse');
  });
});
