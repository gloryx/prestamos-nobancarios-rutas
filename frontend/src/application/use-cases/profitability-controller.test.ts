import { describe, expect, it, vi } from 'vitest';
import { ProfitabilityController, type ProfitabilityPort } from './profitability-controller';

const summary = { periodo: '2026-10', fechaDesde: '2026-10-01', fechaHasta: '2026-10-31', cantidadDias: 31,
  ganancia: { total: '100.00', normal: '60.00', refinanciamientos: '40.00',
    interesRegularRefinanciamientos: '30.00', rendimientoCapitalizadoRecuperado: '10.00' },
  capital: { saldoEconomicoInicial: '1000.00', desembolsadoRealPeriodo: '200.00', recuperadoEconomicoPeriodo: '100.00',
    saldoEconomicoFinal: '1100.00', capitalDays: '32000.00', capitalPromedioTrabajando: '1032.26' },
  indicadores: { rentabilidadPeriodo: '0.0969', tasaEquivalente30Dias: '0.0938', rotacionCapital: '0.0969' },
  integridad: { estado: 'COMPLETO' as const, advertencias: [] } };
const series = { periodo: '2026-10', fechaDesde: '2026-10-01', fechaHasta: '2026-10-31', estadoDatos: 'COMPLETO' as const,
  advertencias: [], serieDiaria: [] };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const api = {
    summary: vi.fn<ProfitabilityPort['summary']>(async (period) => ({ ...summary, periodo: period })),
    capitalSeries: vi.fn<ProfitabilityPort['capitalSeries']>(async () => series),
    normal: vi.fn<ProfitabilityPort['normal']>(async (_period, page, pageSize, status) => ({ items: [], total: 25, page, pageSize,
      totalPages: 2, summary: { realizedInterest: status === 'CANCELLED' ? '700000.00' : status === 'ACTIVE' ? '500000.00' : '1200000.00' } })),
    refinancings: vi.fn<ProfitabilityPort['refinancings']>(async (_period, page, pageSize, status) => ({ items: [], total: 8, page, pageSize,
      totalPages: 1, summary: status === 'CANCELLED'
        ? { regularInterestRealized: '200000.00', capitalizedYieldRecovered: '100000.00', economicGain: '300000.00' }
        : status === 'ACTIVE' ? { regularInterestRealized: '100000.00', capitalizedYieldRecovered: '50000.00', economicGain: '150000.00' }
          : { regularInterestRealized: '300000.00', capitalizedYieldRecovered: '150000.00', economicGain: '450000.00' } })),
    payments: vi.fn<ProfitabilityPort['payments']>(async (_period, page, pageSize) => ({ items: [], total: 0, page, pageSize, totalPages: 0 })),
  };
  return { api, controller: new ProfitabilityController(api, '2026-10') };
}

describe('ProfitabilityController', () => {
  it('loads summary and daily backend series for one period, retaining the summary if the chart fails', async () => {
    const { api, controller } = setup();
    api.capitalSeries.mockRejectedValueOnce(new Error('Serie no disponible'));
    await controller.load();
    expect(api.summary).toHaveBeenCalledWith('2026-10');
    expect(controller.getSnapshot()).toMatchObject({ summary, capitalSeries: null, error: '',
      seriesError: 'Serie no disponible', loading: false });
  });

  it('clears stale period and detail data before loading another month', async () => {
    const { controller } = setup(); await controller.load();
    controller.openNormal(); await tick();
    expect(controller.getSnapshot().detail?.kind).toBe('normal');
    controller.setPeriod('2026-09');
    expect(controller.getSnapshot()).toMatchObject({ period: '2026-09', summary: null,
      capitalSeries: null, detail: null, loading: true });
    await tick();
    expect(controller.getSnapshot().summary?.periodo).toBe('2026-09');
  });

  it('requests server-paginated zooms with exact payment filters', async () => {
    const { api, controller } = setup();
    controller.openPayments({ source: 'REFINANCING', rootLoanId: 'root-1' }, 'Pagos de la cadena');
    await tick();
    expect(api.payments).toHaveBeenCalledWith('2026-10', 1, 20,
      { source: 'REFINANCING', rootLoanId: 'root-1' });
    controller.setDetailPage(2); await tick();
    expect(api.payments).toHaveBeenLastCalledWith('2026-10', 2, 20,
      { source: 'REFINANCING', rootLoanId: 'root-1' });
  });

  it('sends normal status server-side, resets page one and clears stale rows', async () => {
    const { api, controller } = setup();
    controller.openNormal(); await tick();
    const firstPageSummary = controller.getSnapshot().detail?.data?.summary;
    controller.setDetailPage(2); await tick();
    expect(controller.getSnapshot().detail?.data?.summary).toEqual(firstPageSummary);
    controller.setDetailStatus('CANCELLED');
    expect(controller.getSnapshot().detail).toMatchObject({ page: 1, data: null, loading: true,
      filters: { status: 'CANCELLED' } });
    await tick();
    expect(api.normal).toHaveBeenLastCalledWith('2026-10', 1, 20, 'CANCELLED');
    expect(controller.getSnapshot().detail?.data?.summary).toEqual({ realizedInterest: '700000.00' });
    controller.setDetailStatus('ACTIVE'); await tick();
    expect(api.normal).toHaveBeenLastCalledWith('2026-10', 1, 20, 'ACTIVE');
    expect(controller.getSnapshot().detail?.data?.summary).toEqual({ realizedInterest: '500000.00' });
    controller.setDetailStatus(''); await tick();
    expect(api.normal).toHaveBeenLastCalledWith('2026-10', 1, 20, undefined);
  });

  it('sends refinancing terminal status server-side without changing the selected period', async () => {
    const { api, controller } = setup();
    controller.openRefinancings(); await tick();
    controller.setDetailStatus('CANCELLED'); await tick();
    expect(api.refinancings).toHaveBeenLastCalledWith('2026-10', 1, 20, 'CANCELLED');
    expect(controller.getSnapshot().detail?.data?.summary).toMatchObject({ economicGain: '300000.00' });
    controller.setDetailStatus('ACTIVE'); await tick();
    expect(api.refinancings).toHaveBeenLastCalledWith('2026-10', 1, 20, 'ACTIVE');
    expect(controller.getSnapshot().detail?.data?.summary).toMatchObject({ economicGain: '150000.00' });
    expect(controller.getSnapshot().period).toBe('2026-10');
  });

  it('exposes explicit permission and connectivity failures', async () => {
    const { api, controller } = setup();
    api.summary.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await controller.load();
    expect(controller.getSnapshot().error).toBe('No tienes permiso para consultar la rentabilidad integral.');
    api.summary.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await controller.load();
    expect(controller.getSnapshot().error).toBe('No se pudo conectar al servidor. Intenta nuevamente.');
  });
});
