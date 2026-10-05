import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CustomerStatisticsController, type CustomerStatisticsPort, type CustomerStatisticsState } from '../../application/use-cases/customer-statistics-controller';
import type { CustomerStatistics } from '../../domain/entities/customer-statistics';
import { CustomerStatisticsView, TopCustomersRanking } from './CustomerStatisticsPage';

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
  topCustomers: {
    capitalDisbursed: [{ customerId: 'c1', fullName: 'Ana Mora', value: '1500000.00' }, { customerId: 'c2', fullName: 'Bea Solís', value: '900000.00' }],
    loansPlaced: [{ customerId: 'c2', fullName: 'Bea Solís', value: 7 }],
    realizedGain: [{ customerId: 'c3', fullName: 'Carlos Ruiz', value: '250000.00' }],
    recoveredPrincipal: [{ customerId: 'c1', fullName: 'Ana Mora', value: '800000.00' }],
    currentBalance: [{ customerId: 'c4', fullName: 'Diana León', value: '600000.00' }],
  },
});
const api: CustomerStatisticsPort = { load: async (year) => report(year !== 2026) };
const controller = new CustomerStatisticsController(api, 2026, 2026);
const render = (state: CustomerStatisticsState) => renderToStaticMarkup(
  <CustomerStatisticsView state={state} controller={controller} years={[2026, 2025, 2024]} />,
);

describe('CustomerStatisticsView', () => {
  it('renders the independent heading, year selector and literal overview metrics', () => {
    const html = render({ year: 2026, limit: 10, statistics: report(), loading: false, error: '' });
    for (const fragment of ['Estadísticas de clientes', 'Panorama general y comportamiento de la base de clientes.',
      'value="2026" selected=""', 'TOTAL DE CLIENTES', '>120<', 'CON DEUDA ACTIVA', '>40<',
      'SIN DEUDA VIGENTE', '>75<', 'CLIENTES CON INCOBRABLES', '>14<']) expect(html).toContain(fragment);
    expect(html).toContain('también pueden tener deuda activa');
  });

  it('keeps general uncollectibles distinct from mutually exclusive uncollectible-only situation', () => {
    const html = render({ year: 2026, limit: 10, statistics: report(), loading: false, error: '' });
    expect(html).toContain('CLIENTES CON INCOBRABLES');
    expect(html).toContain('Incobrable sin deuda activa');
    expect(html).toContain('sólo clientes sin préstamos activos');
    expect(html).toContain('customer-statistics__donut');
    expect(html).toContain('Distribución de la situación actual');
  });

  it('renders annual/current growth and all twelve backend months including zeroes', () => {
    const html = render({ year: 2026, limit: 10, statistics: report(), loading: false, error: '' });
    expect(html).toContain('NUEVOS CLIENTES EN 2026'); expect(html).toContain('>24<');
    expect(html).toContain('NUEVOS ESTE MES'); expect(html).toContain('>2<');
    for (const month of ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'])
      expect(html).toContain(month);
    expect((html.match(/customer-statistics__bar-column/g) ?? []).length).toBe(12);
    expect(html).toContain('height:0%');
  });

  it('shows No aplica rather than zero for the contextual month of a historical year', () => {
    const html = render({ year: 2025, limit: 10, statistics: report(true), loading: false, error: '' });
    expect(html).toContain('NUEVOS CLIENTES EN 2025');
    expect(html).toContain('No aplica');
  });

  it('replaces historical metrics with one selectable ranking and a configurable default limit', () => {
    const html = render({ year: 2026, limit: 10, statistics: report(), loading: false, error: '' });
    for (const fragment of ['Top de clientes', 'Mayor capital prestado', 'Más préstamos', 'Mayor ganancia',
      'Mayor capital recuperado', 'Mayor saldo actual', 'Ana Mora', '₡1.500.000,00']) expect(html).toContain(fragment);
    for (const removed of ['Relación histórica', 'CON PRÉSTAMOS CANCELADOS', 'HAN REFINANCIADO',
      'CON PRÉSTAMOS ANULADOS', 'CON MÚLTIPLES PRÉSTAMOS', 'PROMEDIO DE PRÉSTAMOS POR CLIENTE']) expect(html).not.toContain(removed);
    expect((html.match(/role="tab"/g) ?? []).length).toBe(5);
    expect((html.match(/customer-statistics__top-position/g) ?? []).length).toBe(2);
    expect(html).toContain('Cantidad de clientes');
    expect(html).toContain('value="10"');
    expect(html).toContain('TOP 10');
  });

  it('formats count and monetary criteria without requesting another report', () => {
    const countHtml = renderToStaticMarkup(<TopCustomersRanking rankings={report().topCustomers} criterion="loansPlaced" limit={25} />);
    expect(countHtml).toContain('Bea Solís'); expect(countHtml).toContain('>7<'); expect(countHtml).not.toContain('₡7');
    expect(countHtml).toContain('TOP 25');
    const gainHtml = renderToStaticMarkup(<TopCustomersRanking rankings={report().topCustomers} criterion="realizedGain" limit={25} />);
    expect(gainHtml).toContain('Carlos Ruiz'); expect(gainHtml).toContain('₡250.000,00');
  });

  it('renders loading and retryable error without stale report values', () => {
    const loading = render({ year: 2025, limit: 10, statistics: null, loading: true, error: '' });
    expect(loading).toContain('Cargando estadísticas de clientes');
    expect(loading).not.toContain('TOTAL DE CLIENTES');
    const failed = render({ year: 2025, limit: 10, statistics: null, loading: false, error: 'No se pudo conectar.' });
    expect(failed).toContain('role="alert"'); expect(failed).toContain('Reintentar');
    expect(failed).not.toContain('TOTAL DE CLIENTES');
  });

  it('treats an empty customer base as valid and keeps responsive charts finite', () => {
    const empty: CustomerStatistics = { ...report(), summary: { ...report().summary, totalCustomers: 0,
      customersWithActiveDebt: 0, customersWithoutCurrentDebt: 0, customersWithUncollectibleDebt: 0,
      customersWithRefinancingHistory: 0, customersWithCancelledLoans: 0, customersWithAnnulledLoans: 0,
      customersWithMultipleLoans: 0, averageLoansPerCustomer: 0, newCustomersInYear: 0, newCustomersCurrentMonth: 0 },
      currentSituation: { activeDebt: 0, uncollectibleOnly: 0, noCurrentDebt: 0 },
      monthlyNewCustomers: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, newCustomers: 0 })),
      topCustomers: { capitalDisbursed: [], loansPlaced: [], realizedGain: [], recoveredPrincipal: [], currentBalance: [] } };
    const html = render({ year: 2026, limit: 10, statistics: empty, loading: false, error: '' });
    expect(html).toContain('No hay clientes registrados');
    expect(html).toContain('customer-statistics__situation-layout');
    expect(html).toContain('customer-statistics__bars');
    expect(html).toContain('No hay información disponible para este indicador');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
