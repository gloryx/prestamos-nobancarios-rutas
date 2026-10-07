import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CollectorFinancialSummaryView } from './CollectorFinancialSummaryPage';

const summary = { totalPlaced: '6250000.00', totalOutstanding: '4850000.00', realizedGain: '425000.00', activeLoansCount: 31 };
const view = (props: Partial<Parameters<typeof CollectorFinancialSummaryView>[0]> = {}) => renderToStaticMarkup(<MemoryRouter><CollectorFinancialSummaryView
  summary={summary} loading={false} error="" can={() => true} {...props} /></MemoryRouter>);

describe('Mi resumen financiero', () => {
  it('renders exactly four backend indicators with the centralized CRC formatter', () => {
    const html = view();
    for (const value of ['TOTAL COLOCADO', '₡6.250.000', 'TOTAL PENDIENTE', '₡4.850.000',
      'GANANCIA REALIZADA', '₡425.000', 'PRÉSTAMOS ACTIVOS', '>31<']) expect(html).toContain(value);
    expect(html.match(/<article/g)).toHaveLength(4);
    for (const hidden of ['Rentabilidad', 'Capital promedio', 'Caja', 'Utilidad global', 'Ingresos externos', 'Gastos', 'Cierres']) expect(html).not.toContain(hidden);
    expect(html).toContain('collector-summary__metrics');
  });

  it('renders zero values as a valid empty portfolio instead of an empty-state error', () => {
    const zero = { totalPlaced: '0.00', totalOutstanding: '0.00', realizedGain: '0.00', activeLoansCount: 0 };
    const html = view({ summary: zero });
    expect(html.match(/₡0/g)).toHaveLength(3);
    expect(html).toContain('PRÉSTAMOS ACTIVOS</span></article>');
    expect(html).not.toContain('role="alert"');
  });

  it('has controlled loading and error states without stale indicators', () => {
    expect(view({ summary: undefined, loading: true })).toContain('Cargando resumen financiero');
    const error = view({ summary: undefined, error: 'No disponible' });
    expect(error).toContain('role="alert"'); expect(error).toContain('No disponible'); expect(error).not.toContain('TOTAL COLOCADO');
  });

  it('shows only authorized links to the existing daily collections and agenda routes', () => {
    const html = view();
    expect(html).toContain('href="/collector/daily-collections"');
    expect(html).toContain('href="/collectors/collection-agenda"');
    const denied = view({ can: () => false });
    expect(denied).not.toContain('Ver cobros del día'); expect(denied).not.toContain('Ver agenda de cobros');
  });
});
