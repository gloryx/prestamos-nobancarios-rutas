import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CollectorStatisticsController, type CollectorStatisticsPort, type CollectorStatisticsState } from '../../application/use-cases/collector-statistics-controller';
import type { CollectorStatistics } from '../../domain/entities/collector-statistics';
import { CollectorStatisticsView } from './CollectorStatisticsPage';

const annualEvolution = Array.from({ length: 12 }, (_, index) => ({ period: `2026-${String(index + 1).padStart(2, '0')}`,
  validPaymentsCount: index === 0 ? 2 : 0, uniqueCustomersServed: index === 0 ? 1 : 0,
  totalCollectedAmount: index === 0 ? '125000.00' : '0.00', annulledPaymentsCount: 0, annulledAmount: '0.00' }));
const report = (month: number | null = null): CollectorStatistics => ({
  period: { year: 2026, month, startDate: month ? '2026-02-01' : '2026-01-01',
    endDate: month ? '2026-02-28' : '2026-12-31', timeZone: 'America/Costa_Rica' },
  semantics: { paymentDateBasis: 'PAYMENT_DATE', paymentValidityBasis: 'CURRENT_STATUS', assignmentSnapshot: 'CURRENT' },
  summary: { totalCollectors: 3, activeCollectors: 2, inactiveCollectors: 1, collectorsWithValidPayments: 1,
    collectorsWithoutValidPayments: 2, activeCollectorsWithoutValidPayments: 1, linkedCollectors: 2,
    unlinkedCollectors: 1, validPaymentsCount: 2, uniqueCustomersServed: 1, totalCollectedAmount: '125000.00',
    principalAppliedAmount: '100000.00', interestAppliedAmount: '25000.00', averageValidPaymentAmount: '62500.00',
    annulledPaymentsCount: 1, annulledAmount: '10000.00', averageAssignedCustomersPerActiveCollector: 2.5 },
  byCollector: [
    { collectorId: 'c1', identification: '1-1111', fullName: 'Ana Pérez', isActive: true, userLinked: true,
      validPaymentsCount: 2, uniqueCustomersServed: 1, totalCollectedAmount: '125000.00', principalAppliedAmount: '100000.00',
      interestAppliedAmount: '25000.00', averageValidPaymentAmount: '62500.00', annulledPaymentsCount: 1,
      annulledAmount: '10000.00', currentActiveRoutes: 2, currentAssignedActiveCustomers: 5 },
    { collectorId: 'c2', identification: '2-2222', fullName: 'Juan Rojas', isActive: true, userLinked: true,
      validPaymentsCount: 0, uniqueCustomersServed: 0, totalCollectedAmount: '0.00', principalAppliedAmount: '0.00',
      interestAppliedAmount: '0.00', averageValidPaymentAmount: '0.00', annulledPaymentsCount: 0,
      annulledAmount: '0.00', currentActiveRoutes: 0, currentAssignedActiveCustomers: 0 },
    { collectorId: 'c3', identification: '3-3333', fullName: 'Luis Mora', isActive: false, userLinked: false,
      validPaymentsCount: 0, uniqueCustomersServed: 0, totalCollectedAmount: '0.00', principalAppliedAmount: '0.00',
      interestAppliedAmount: '0.00', averageValidPaymentAmount: '0.00', annulledPaymentsCount: 0,
      annulledAmount: '0.00', currentActiveRoutes: 0, currentAssignedActiveCustomers: 0 },
  ],
  paymentMethods: [{ paymentMethodId: 'm1', name: 'SINPE Móvil', currentlyActive: true,
    validPaymentsCount: 2, totalCollectedAmount: '125000.00' }],
  evolution: month === null ? annualEvolution : Array.from({ length: 28 }, (_, index) => ({
    period: `2026-02-${String(index + 1).padStart(2, '0')}`, validPaymentsCount: index === 1 ? 2 : 0,
    uniqueCustomersServed: index === 1 ? 1 : 0, totalCollectedAmount: index === 1 ? '125000.00' : '0.00',
    annulledPaymentsCount: 0, annulledAmount: '0.00',
  })),
  unattributedPayments: { validPaymentsCount: 3, totalCollectedAmount: '15000.00',
    annulledPaymentsCount: 1, annulledAmount: '5000.00' },
});
const api: CollectorStatisticsPort = { load: async (year, month) => ({ ...report(month), period: { ...report(month).period, year } }) };
const controller = new CollectorStatisticsController(api, 2026, 2026);
const render = (state: CollectorStatisticsState) => renderToStaticMarkup(
  <CollectorStatisticsView state={state} controller={controller} years={[2026, 2025]} />,
);

describe('CollectorStatisticsView', () => {
  it('renders selectors and authoritative overview and collection activity', () => {
    const html = render({ year: 2026, month: null, statistics: report(), loading: false, error: '' });
    for (const fragment of ['Estadísticas de cobradores', 'Actividad de cobro y atención de clientes por período.',
      'Todo el año', 'Octubre', 'COBRADORES ACTIVOS', '>2<', 'CON ACTIVIDAD', '>1<', 'ACTIVOS SIN ACTIVIDAD',
      'CLIENTES ATENDIDOS', 'PAGOS VÁLIDOS', 'COBRADO POR COBRADORES', '₡125.000,00', 'CAPITAL COBRADO', '₡100.000,00',
      'INTERÉS COBRADO', '₡25.000,00', 'PROMEDIO POR PAGO', '₡62.500,00']) expect(html).toContain(fragment);
    expect(html).toContain('Clientes únicos con al menos un pago válido');
    expect(html).toContain('Monto de pagos válidos atribuibles a cobradores durante el período.');
    expect(html).not.toContain('TOTAL COBRADO');
  });

  it('renders all annual buckets including zeroes and customers only as tooltip information', () => {
    const html = render({ year: 2026, month: null, statistics: report(), loading: false, error: '' });
    expect(html).toContain('Cobros por mes');
    for (const month of ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'])
      expect(html).toContain(month);
    expect((html.match(/collector-statistics__bar&quot;|collector-statistics__bar"/g) ?? []).length).toBe(12);
    expect(html).toContain('1 clientes atendidos');
    expect(html).toContain('height:0%');
  });

  it('renders every backend day for a selected month, including zero days', () => {
    const html = render({ year: 2026, month: 2, statistics: report(2), loading: false, error: '' });
    expect(html).toContain('Cobros diarios — Febrero 2026');
    expect((html.match(/collector-statistics__bar&quot;|collector-statistics__bar"/g) ?? []).length).toBe(28);
    expect(html).toContain('Día 28');
    expect(html).toContain('height:0%');
  });

  it('keeps zero-activity collectors visible and renders literal per-collector customers and money', () => {
    const html = render({ year: 2026, month: null, statistics: report(), loading: false, error: '' });
    expect(html).toContain('Desglose de actividad');
    expect(html).toContain('Esta tabla no representa un ranking');
    expect(html).toContain('Ana Pérez');
    expect(html).toContain('Juan Rojas');
    expect(html).toContain('Luis Mora');
    expect(html).toContain('Clientes atendidos');
    expect(html).toContain('₡0,00');
  });

  it('separates payment methods, annulments, unattributed payments and current coverage', () => {
    const html = render({ year: 2026, month: null, statistics: report(), loading: false, error: '' });
    for (const fragment of ['FORMAS DE PAGO', 'SINPE Móvil', '2 pagos', 'ANULACIONES', '1 pagos anulados',
      '₡10.000,00', 'INTEGRIDAD DE COBRO', 'Pagos no atribuibles a un cobrador', '3 pagos válidos', '₡15.000,00', 'COBERTURA ACTUAL',
      '2 rutas activas', '5 clientes actualmente asignados', 'no reconstruyen la asignación histórica'])
      expect(html).toContain(fragment);
    expect(html).not.toContain('Dinero perdido');
    expect(html).not.toContain('Pagos sin cobrador válido');
    expect(html).not.toContain('clientes asignados en');
  });

  it('renders loading and retryable errors without stale report values', () => {
    const loading = render({ year: 2025, month: null, statistics: null, loading: true, error: '' });
    expect(loading).toContain('Cargando estadísticas de cobradores');
    expect(loading).not.toContain('COBRADORES ACTIVOS');
    const failed = render({ year: 2025, month: null, statistics: null, loading: false, error: 'No se pudo conectar.' });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Reintentar');
    expect(failed).not.toContain('COBRADORES ACTIVOS');
  });

  it('treats a period without activity as valid and keeps all visuals finite', () => {
    const empty = report();
    empty.summary = { ...empty.summary, collectorsWithValidPayments: 0, activeCollectorsWithoutValidPayments: 2,
      validPaymentsCount: 0, uniqueCustomersServed: 0, totalCollectedAmount: '0.00', principalAppliedAmount: '0.00',
      interestAppliedAmount: '0.00', averageValidPaymentAmount: '0.00', annulledPaymentsCount: 0, annulledAmount: '0.00' };
    empty.byCollector = empty.byCollector.map((row) => ({ ...row, validPaymentsCount: 0, uniqueCustomersServed: 0,
      totalCollectedAmount: '0.00', principalAppliedAmount: '0.00', interestAppliedAmount: '0.00',
      averageValidPaymentAmount: '0.00', annulledPaymentsCount: 0, annulledAmount: '0.00' }));
    empty.paymentMethods = [];
    empty.evolution = annualEvolution.map((item) => ({ ...item, validPaymentsCount: 0, uniqueCustomersServed: 0,
      totalCollectedAmount: '0.00' }));
    const html = render({ year: 2026, month: null, statistics: empty, loading: false, error: '' });
    expect(html).toContain('No hubo actividad de cobro válida');
    expect(html).toContain('No se utilizaron formas de pago');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
