import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProfitabilityController, type ProfitabilityPort, type ProfitabilityState } from '../../application/use-cases/profitability-controller';
import { ProfitabilityView } from './ProfitabilityPage';

const summary = { periodo: '2026-10', fechaDesde: '2026-10-01', fechaHasta: '2026-10-31', cantidadDias: 31,
  ganancia: { total: '125000.50', normal: '80000.25', refinanciamientos: '45000.25',
    interesRegularRefinanciamientos: '30000.00', rendimientoCapitalizadoRecuperado: '15000.25' },
  capital: { saldoEconomicoInicial: '1000000.00', desembolsadoRealPeriodo: '250000.00',
    recuperadoEconomicoPeriodo: '175000.00', saldoEconomicoFinal: '1075000.00', capitalDays: '32100000.00',
    capitalPromedioTrabajando: '1035483.87' },
  indicadores: { rentabilidadPeriodo: '0.1207', tasaEquivalente30Dias: '0.1168', rotacionCapital: '0.1690' },
  integridad: { estado: 'COMPLETO' as const, advertencias: [] } };
const capitalSeries = { periodo: '2026-10', fechaDesde: '2026-10-01', fechaHasta: '2026-10-31',
  estadoDatos: 'COMPLETO' as const, advertencias: [], serieDiaria: [
    { fecha: '2026-10-01', saldoInicial: '1000000.00', desembolsosReales: '0.00', capitalRecuperado: '0.00', ajustesReversos: '0.00', saldoFinal: '1000000.00' },
    { fecha: '2026-10-31', saldoInicial: '1075000.00', desembolsosReales: '0.00', capitalRecuperado: '0.00', ajustesReversos: '0.00', saldoFinal: '1075000.00' },
  ] };
const api: ProfitabilityPort = { summary: async () => summary, capitalSeries: async () => capitalSeries,
  normal: async (_period, page, pageSize) => ({ items: [], total: 0, page, pageSize, totalPages: 0 }),
  refinancings: async (_period, page, pageSize) => ({ items: [], total: 0, page, pageSize, totalPages: 0 }),
  payments: async (_period, page, pageSize) => ({ items: [], total: 0, page, pageSize, totalPages: 0 }) };

const baseState = (): ProfitabilityState => ({ period: '2026-10', summary, capitalSeries, loading: false,
  refreshing: false, error: '', seriesError: '', detail: null });
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
const render = (state: ProfitabilityState, controller = new ProfitabilityController(api, state.period)) =>
  renderToStaticMarkup(<MemoryRouter><ProfitabilityView state={state} controller={controller} /></MemoryRouter>);

describe('Rentabilidad integral', () => {
  it('prioritizes backend gain, origin, indicators, capital and exact daily balances', () => {
    const html = render(baseState());
    for (const fragment of ['Rentabilidad integral', 'GANANCIA REALIZADA DEL PERÍODO', '₡125.000,50',
      'PRÉSTAMOS NORMALES', '₡80.000,25', 'REFINANCIAMIENTOS', '₡45.000,25',
      '12,07 %', '11,68 %', '0,17x', '₡1.035.483,87', 'Capital trabajando durante el mes',
      '01/10/2026: <strong>₡1.000.000,00', 'Datos completos para el período seleccionado.'])
      expect(html).toContain(fragment);
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('opens backend zooms from the dominant and origin cards', () => {
    const controller = new ProfitabilityController(api, '2026-10');
    const payments = vi.spyOn(controller, 'openPayments');
    const normal = vi.spyOn(controller, 'openNormal');
    const refinancings = vi.spyOn(controller, 'openRefinancings');
    const tree = elements(ProfitabilityView({ state: baseState(), controller }));
    const buttons = tree.filter((element) => element.type === 'button');
    const click = (button: ReactElement | undefined) => (button?.props as { onClick?: () => void }).onClick?.();
    click(buttons.find((button) => (button.props as { className?: string }).className === 'profitability__hero'));
    const originButtons = buttons.filter((button) => (button.props as { children?: ReactNode }).children &&
      (button.props as { className?: string }).className === undefined);
    click(originButtons[0]); click(originButtons[1]);
    expect(payments).toHaveBeenCalledOnce(); expect(normal).toHaveBeenCalledOnce(); expect(refinancings).toHaveBeenCalledOnce();
  });

  it('renders null metrics and unavailable integrity honestly', () => {
    const unavailable: ProfitabilityState = { ...baseState(), summary: { ...summary,
      capital: { saldoEconomicoInicial: null, desembolsadoRealPeriodo: null, recuperadoEconomicoPeriodo: null,
        saldoEconomicoFinal: null, capitalDays: null, capitalPromedioTrabajando: null },
      indicadores: { rentabilidadPeriodo: null, tasaEquivalente30Dias: null, rotacionCapital: null },
      integridad: { estado: 'NO_DISPONIBLE', advertencias: ['Falta apertura económica.'] } }, capitalSeries: null };
    const html = render(unavailable);
    expect(html).toContain('NO DISPONIBLE'); expect(html).toContain('Falta apertura económica.');
    expect(html.match(/No disponible/g)?.length).toBeGreaterThanOrEqual(9);
    expect(html).not.toMatch(/0,00 %|0,00x|NaN|Infinity/);
  });

  it('shows audit rows, reversals, compact actions, pagination and empty/error states', () => {
    const controller = new ProfitabilityController(api, '2026-10');
    const normalState: ProfitabilityState = { ...baseState(), detail: { kind: 'normal', title: 'Ganancia normal',
      page: 1, pageSize: 20, filters: { status: 'CANCELLED' }, loading: false, error: '', data: { total: 21, page: 1, pageSize: 20, totalPages: 2,
        summary: { realizedInterest: '1200000.00' }, items: [
        { loanId: 'loan-1', loanNumber: '4548', customerId: 'customer-1', customerName: 'Ana Pérez', status: 'CANCELLED',
          realizedInterestInPeriod: '80000.25', paymentCountContributing: 2 },
        { loanId: 'loan-2', loanNumber: '4549', customerId: 'customer-2', customerName: 'Luis Mora', status: 'ACTIVE',
          realizedInterestInPeriod: '100.00', paymentCountContributing: 1 },
      ] } } };
    const normalHtml = render(normalState, controller);
    for (const fragment of ['DETALLE AUDITABLE', 'GANANCIA DEL CONJUNTO', '₡1.200.000,00', 'REGISTROS', '#4548', 'Ana Pérez', 'CANCELADO', '₡80.000,25',
      'href="/loans/loan-1"', 'Ver pagos del préstamo 4548', 'Página 1 de 2 · 21 registros']) expect(normalHtml).toContain(fragment);
    for (const label of ['Todos', 'Cancelados', 'Activos', 'Refinanciados', 'Incobrables', 'Anulados', 'Luis Mora'])
      expect(normalHtml).toContain(label);

    const paymentState: ProfitabilityState = { ...baseState(), detail: { kind: 'payments', title: 'Pagos', page: 1,
      pageSize: 20, filters: {}, loading: false, error: '', data: { total: 1, page: 1, pageSize: 20, totalPages: 1, items: [
        { eventType: 'REVERSAL', source: 'REFINANCING', rootLoanId: 'root-1', paymentId: 'pay-1', loanId: 'loan-1',
          loanNumber: '4548', customerId: 'customer-1', customerName: 'Ana Pérez', paymentDate: '2026-10-15',
          paymentAmount: '-50000.00', principalAppliedContractual: '-30000.00', economicPrincipalRecovered: '-25000.00',
          capitalizedYieldRecovered: '-5000.00', interestApplied: '-20000.00', economicGainContribution: '-25000.00' },
      ] } } };
    const paymentHtml = render(paymentState, controller);
    expect(paymentHtml).toContain('Reverso'); expect(paymentHtml).toContain('-₡25.000,00'); expect(paymentHtml).toContain('15/10/2026');
    const unavailableSummary = render({ ...baseState(), detail: { ...normalState.detail!, data: { items: [], total: 0,
      page: 1, pageSize: 20, totalPages: 0, summary: { realizedInterest: null } } } }, controller);
    expect(unavailableSummary).toContain('No hay registros para este filtro.');
    expect(unavailableSummary).toContain('No disponible');
    expect(render({ ...baseState(), error: 'No se pudo conectar.', summary: null, capitalSeries: null }, controller))
      .toContain('No se pudo conectar.');
  });

  it('labels terminal-chain filters for partners and trusts server rows without client filtering', () => {
    const state: ProfitabilityState = { ...baseState(), detail: { kind: 'refinancings', title: 'Refinanciamientos',
      page: 1, pageSize: 20, filters: { terminalStatus: 'ACTIVE' }, loading: false, error: '', data: {
        total: 1, page: 1, pageSize: 20, totalPages: 1, summary: { regularInterestRealized: '300000.00',
          capitalizedYieldRecovered: '150000.00', economicGain: '450000.00' }, items: [{ rootLoanId: 'root-1', terminalLoanId: 'loan-2',
          loanIds: ['root-1', 'loan-2'], refinancingIds: ['ref-1'], customer: { id: 'customer-1', name: 'Socio visible' },
          chainStatus: 'CANCELLED', regularInterestRealizedInPeriod: '10.00', capitalizedYieldRecoveredInPeriod: '5.00',
          economicGainInPeriod: '15.00', capitalizedYieldPendingAtEnd: '0.00', paymentCountContributing: 1 }],
      } } };
    const html = render(state);
    for (const label of ['Todas las cadenas', 'Deuda final cancelada', 'Cadenas activas', 'GANANCIA ECONÓMICA', '₡450.000,00',
      'INTERÉS REGULAR', '₡300.000,00', 'RENDIMIENTO CAPITALIZADO RECUPERADO', '₡150.000,00', 'Socio visible', 'CANCELADO'])
      expect(html).toContain(label);
  });
});
