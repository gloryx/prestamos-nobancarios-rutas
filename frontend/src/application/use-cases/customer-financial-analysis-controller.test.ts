import { describe, expect, it, vi } from 'vitest';
import type { CustomerFinancialAnalysis } from '../../domain/entities/customer-financial-analysis';
import { CustomerFinancialAnalysisController, type CustomerFinancialAnalysisPort } from './customer-financial-analysis-controller';

const analysis = (asOf = '2026-09-30'): CustomerFinancialAnalysis => ({
  cliente: { id: 'customer-1', identificacion: '123', nombreCompleto: 'Ana Perez' }, fechaCorte: asOf,
  historial: { fechaPrimerCapitalDesplegado: '2026-09-01', cantidadDiasCalendario: 30,
    cantidadPrestamos: 1, cantidadCadenas: 1, prestamosPorEstado: { ACTIVE: 1 } },
  flujoCaja: { capitalRealDesembolsado: '100.00', pagosRecibidos: '20.00' },
  capitalEconomico: { recuperado: '15.00', pendiente: '85.00', capitalDays: '2850.00', capitalPromedioTrabajando: '95.00' },
  rendimientoCapitalizado: { creado: '0.00', recuperado: '0.00', pendiente: '0.00' },
  gananciaRealizada: { interesRegular: '5.00', rendimientoCapitalizadoRecuperado: '0.00', total: '5.00' },
  exposicionContractual: { principalPendiente: '85.00', interesPendiente: '15.00', saldoTotal: '100.00' },
  profitability: { cumulativeReturnRate: '0.0500' },
  indicadores: { rentabilidadHistorica: '0.0526', tasaEquivalente30Dias: '0.0526', rotacionCapital: '1.0526' },
  integridad: { estado: 'COMPLETO', advertencias: [] },
});
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const api = { load: vi.fn<CustomerFinancialAnalysisPort['load']>(async (_id, asOf) => analysis(asOf)) };
  return { api, controller: new CustomerFinancialAnalysisController(api, 'customer-1', '2026-09-30', () => '2026-10-03') };
}

describe('CustomerFinancialAnalysisController', () => {
  it('loads the requested customer and cutoff literally', async () => {
    const { api, controller } = setup();
    await controller.load();
    expect(api.load).toHaveBeenCalledWith('customer-1', '2026-09-30');
    expect(controller.getSnapshot()).toMatchObject({ analysis: analysis(), loading: false, error: '' });
  });

  it('clears stale figures immediately and reloads when cutoff changes', async () => {
    const { api, controller } = setup(); await controller.load();
    controller.setAsOf('2026-09-15');
    expect(controller.getSnapshot()).toMatchObject({ asOf: '2026-09-15', analysis: null, loading: true });
    await tick();
    expect(api.load).toHaveBeenLastCalledWith('customer-1', '2026-09-15');
    expect(controller.getSnapshot().analysis?.fechaCorte).toBe('2026-09-15');
  });

  it.each(['2026-10-04', '2026-02-30'])('blocks invalid or future cutoff %s without a request', (asOf) => {
    const { api, controller } = setup(); controller.setAsOf(asOf);
    expect(controller.getSnapshot()).toMatchObject({ analysis: null, loading: false,
      error: 'La fecha de corte no puede ser futura y debe ser una fecha válida.' });
    expect(api.load).not.toHaveBeenCalled();
  });

  it('keeps invalid cutoff blocked when retry invokes load directly', async () => {
    const { api, controller } = setup(); controller.setAsOf('2026-10-04');
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ analysis: null, loading: false,
      error: 'La fecha de corte no puede ser futura y debe ser una fecha válida.' });
    expect(api.load).not.toHaveBeenCalled();
  });

  it('exposes errors and supports a clean retry without stale data', async () => {
    const { api, controller } = setup();
    api.load.mockRejectedValueOnce(new Error('Servicio no disponible'));
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ analysis: null, error: 'Servicio no disponible' });
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ analysis: analysis(), error: '' });
  });

  it('maps missing permission and connectivity failures to explicit UI states', async () => {
    const { api, controller } = setup();
    api.load.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await controller.load();
    expect(controller.getSnapshot().error).toContain('No tienes permiso');
    api.load.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await controller.load();
    expect(controller.getSnapshot().error).toContain('No se pudo conectar');
  });
});
