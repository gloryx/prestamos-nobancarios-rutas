import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CustomerStatisticsController, type CustomerStatisticsPort, type CustomerStatisticsState } from '../../application/use-cases/customer-statistics-controller';
import type { CustomerStatistics } from '../../domain/entities/customer-statistics';
import { CustomerStatisticsView } from './CustomerStatisticsPage';

const report = (historical = false): CustomerStatistics => ({
  year: historical ? 2025 : 2026,
  summary: { totalCustomers: 120, customersWithActiveDebt: 40, customersWithoutCurrentDebt: 75,
    customersWithUncollectibleDebt: 14, customersWithRefinancingHistory: 19,
    customersWithCancelledLoans: 63, customersWithAnnulledLoans: 7,
    customersWithMultipleLoans: 28, averageLoansPerCustomer: 3.4,
    newCustomersInYear: 24, newCustomersCurrentMonth: historical ? null : 2 },
  currentSituation: { activeDebt: 40, uncollectibleOnly: 5, noCurrentDebt: 75 },
  monthlyNewCustomers: [2, 0, 3, 1, 4, 2, 0, 5, 1, 2, 2, 2]
    .map((newCustomers, index) => ({ month: index + 1, newCustomers })),
});
const api: CustomerStatisticsPort = { load: async (year) => report(year !== 2026) };
const controller = new CustomerStatisticsController(api, 2026, 2026);
const render = (state: CustomerStatisticsState) => renderToStaticMarkup(
  <CustomerStatisticsView state={state} controller={controller} years={[2026, 2025, 2024]} />,
);

describe('CustomerStatisticsView', () => {
  it('renders the independent heading, year selector and literal overview metrics', () => {
    const html = render({ year: 2026, statistics: report(), loading: false, error: '' });
    for (const fragment of ['Estadísticas de clientes', 'Panorama general y comportamiento de la base de clientes.',
      'value="2026" selected=""', 'TOTAL DE CLIENTES', '>120<', 'CON DEUDA ACTIVA', '>40<',
      'SIN DEUDA VIGENTE', '>75<', 'CLIENTES CON INCOBRABLES', '>14<']) expect(html).toContain(fragment);
    expect(html).toContain('también pueden tener deuda activa');
  });

  it('keeps general uncollectibles distinct from mutually exclusive uncollectible-only situation', () => {
    const html = render({ year: 2026, statistics: report(), loading: false, error: '' });
    expect(html).toContain('CLIENTES CON INCOBRABLES');
    expect(html).toContain('Incobrable sin deuda activa');
    expect(html).toContain('sólo clientes sin préstamos activos');
    expect(html).toContain('customer-statistics__donut');
    expect(html).toContain('Distribución de la situación actual');
  });

  it('renders annual/current growth and all twelve backend months including zeroes', () => {
    const html = render({ year: 2026, statistics: report(), loading: false, error: '' });
    expect(html).toContain('NUEVOS CLIENTES EN 2026'); expect(html).toContain('>24<');
    expect(html).toContain('NUEVOS ESTE MES'); expect(html).toContain('>2<');
    for (const month of ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'])
      expect(html).toContain(month);
    expect((html.match(/customer-statistics__bar-column/g) ?? []).length).toBe(12);
    expect(html).toContain('height:0%');
  });

  it('shows No aplica rather than zero for the contextual month of a historical year', () => {
    const html = render({ year: 2025, statistics: report(true), loading: false, error: '' });
    expect(html).toContain('NUEVOS CLIENTES EN 2025');
    expect(html).toContain('No aplica');
  });

  it('renders overlapping history as independent metrics and formats average without money or percent', () => {
    const html = render({ year: 2026, statistics: report(), loading: false, error: '' });
    for (const fragment of ['CON PRÉSTAMOS CANCELADOS', '>63<', 'HAN REFINANCIADO', '>19<',
      'CON PRÉSTAMOS ANULADOS', '>7<', 'CON MÚLTIPLES PRÉSTAMOS', '>28<',
      'PROMEDIO DE PRÉSTAMOS POR CLIENTE', '>3,4<', 'Las categorías históricas pueden superponerse',
      'Los préstamos anulados no forman parte del cálculo']) expect(html).toContain(fragment);
    expect(html).not.toContain('₡3,4');
    expect(html).not.toContain('3,4 %');
  });

  it('renders loading and retryable error without stale report values', () => {
    const loading = render({ year: 2025, statistics: null, loading: true, error: '' });
    expect(loading).toContain('Cargando estadísticas de clientes');
    expect(loading).not.toContain('TOTAL DE CLIENTES');
    const failed = render({ year: 2025, statistics: null, loading: false, error: 'No se pudo conectar.' });
    expect(failed).toContain('role="alert"'); expect(failed).toContain('Reintentar');
    expect(failed).not.toContain('TOTAL DE CLIENTES');
  });

  it('treats an empty customer base as valid and keeps responsive charts finite', () => {
    const empty: CustomerStatistics = { ...report(), summary: { ...report().summary, totalCustomers: 0,
      customersWithActiveDebt: 0, customersWithoutCurrentDebt: 0, customersWithUncollectibleDebt: 0,
      customersWithRefinancingHistory: 0, customersWithCancelledLoans: 0, customersWithAnnulledLoans: 0,
      customersWithMultipleLoans: 0, averageLoansPerCustomer: 0, newCustomersInYear: 0, newCustomersCurrentMonth: 0 },
      currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 0 },
      monthlyNewCustomers: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, newCustomers: 0 })) };
    const html = render({ year: 2026, statistics: empty, loading: false, error: '' });
    expect(html).toContain('No hay clientes registrados');
    expect(html).toContain('customer-statistics__situation-layout');
    expect(html).toContain('customer-statistics__bars');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
