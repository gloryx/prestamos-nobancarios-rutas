import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CustomerFinancialAnalysisController, type CustomerFinancialAnalysisState } from '../../application/use-cases/customer-financial-analysis-controller';
import type { CustomerFinancialAnalysis, CustomerFinancialIntegrity } from '../../domain/entities/customer-financial-analysis';
import { costaRicaDateOnly } from '../../shared/utils/date';
import { FinancialAnalysisView } from './FinancialAnalysisPage';

const data = (integrity: CustomerFinancialIntegrity = 'COMPLETO'): CustomerFinancialAnalysis => ({
  cliente: { id: 'customer-1', identificacion: '1-2345-6789', nombreCompleto: 'Ana Perez' }, fechaCorte: '2026-09-30',
  historial: { fechaPrimerCapitalDesplegado: '2026-01-15', cantidadDiasCalendario: 259, cantidadPrestamos: 6,
    cantidadCadenas: 4, prestamosPorEstado: { ACTIVE: 1, CANCELLED: 2, REFINANCED: 1, UNCOLLECTIBLE: 1, ANNULLED: 1 } },
  flujoCaja: { capitalRealDesembolsado: '152000.00', pagosRecibidos: '192000.00' },
  capitalEconomico: { recuperado: '122000.00', pendiente: '30000.00', capitalDays: '1340000.00', capitalPromedioTrabajando: '44666.67' },
  rendimientoCapitalizado: { creado: '20000.00', recuperado: '10000.00', pendiente: '10000.00' },
  gananciaRealizada: { interesRegular: '20000.00', rendimientoCapitalizadoRecuperado: '10000.00', total: '30000.00' },
  exposicionContractual: { principalPendiente: '40000.00', interesPendiente: '5000.00', saldoTotal: '45000.00' },
  profitability: { cumulativeReturnRate: '0.2632' },
  indicadores: { rentabilidadHistorica: '3.8897', tasaEquivalente30Dias: '0.4243', rotacionCapital: '2.1000' },
  integridad: { estado: integrity, advertencias: integrity === 'COMPLETO' ? [] : ['Revisar procedencia económica.'] },
});

const controller = new CustomerFinancialAnalysisController({ load: async () => data() }, 'customer-1', '2026-09-30', () => '2026-10-03');
const render = (analysis: CustomerFinancialAnalysis | null, error = '') => {
  const state: CustomerFinancialAnalysisState = { customerId: 'customer-1', asOf: '2026-09-30', analysis, loading: false, error };
  return renderToStaticMarkup(<MemoryRouter><FinancialAnalysisView state={state} controller={controller} canChangeCustomer /></MemoryRouter>);
};

describe('FinancialAnalysisView', () => {
  it('renders customer identity, authoritative summary, gain breakdown and cutoff', () => {
    const html = render(data());
    expect(html).toContain('Ana Perez'); expect(html).toContain('1-2345-6789');
    expect(html).toContain('DINERO REAL ENTREGADO'); expect(html).toContain('₡152.000');
    expect(html).toContain('TOTAL RECIBIDO DEL CLIENTE'); expect(html).toContain('₡192.000');
    expect(html).toContain('GANANCIA COBRADA'); expect(html).toContain('₡30.000');
    expect(html).toContain('Interés cobrado ₡20.000');
    expect(html).toContain('Ganancia anterior recuperada ₡10.000');
    expect(html).toContain('value="2026-09-30"'); expect(html).toContain(`max="${costaRicaDateOnly()}"`);
  });

  it('shows economic and contractual exposure, uncollectible history and backend rates without rotation', () => {
    const html = render(data());
    expect(html).toContain('Capital real pendiente de recuperar'); expect(html).toContain('₡30.000');
    expect(html).toContain('Ganancia anterior pendiente de recuperar'); expect(html).toContain('₡10.000');
    expect(html).toContain('Saldo contractual pendiente'); expect(html).toContain('₡45.000');
    expect(html).toContain('Incobrables'); expect(html).toContain('RETORNO HISTÓRICO'); expect(html).toContain('26,32 %');
    expect(html).toContain('RENTABILIDAD EQUIVALENTE A 30 DÍAS'); expect(html).toContain('42,43 %');
    expect(html).toContain('Ganancia acumulada / capital promedio'); expect(html).toContain('388,97 %');
    expect(html).not.toContain('Rentabilidad histórica');
    expect(html).not.toContain('ROTACIÓN'); expect(html).not.toContain('2,10x');
  });

  it('explains received profitability values before a closed native calculation detail', () => {
    const html = render(data());
    expect(html).toContain('Por cada ₡100 entregados a este cliente a lo largo de la relación, se han generado ₡26,32 de ganancia realizada.');
    expect(html).toContain('Rendimiento equivalente por cada 30 días, considerando cuánto capital estuvo realmente invertido y durante cuánto tiempo.');
    expect(html).toContain('¿Cómo leer estos resultados?');
    expect(html).toContain('Este cliente ha generado un retorno acumulado de 26,32 % sobre el dinero real desembolsado. Considerando el capital invertido y el tiempo que permaneció colocado, su rendimiento equivale a 42,43 % cada 30 días.');
    expect(html).toMatch(/<details class="customer-financial-analysis__profitability-details"><summary>Ver detalles del cálculo<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*\sopen(?:="")?/);
    expect(html).toContain('Capital económico que, en promedio, permaneció colocado en este cliente durante el período analizado.');
    expect(html).toContain('Indicador técnico acumulado. No representa una tasa de interés ni una rentabilidad mensual.');
    expect(html).toContain('Medida técnica de exposición que combina el capital pendiente con los días que permaneció colocado.');
  });

  it('preserves very high backend percentages and large CRC values as presentation-only details', () => {
    const high = data();
    high.indicadores.rentabilidadHistorica = '9.9213';
    high.capitalEconomico.capitalPromedioTrabajando = '320018.46';
    high.capitalEconomico.capitalDays = '606755000.00';
    const html = render(high);
    expect(html).toContain('992,13 %');
    expect(html).toContain('₡320.018,46');
    expect(html).toContain('₡606.755.000');
    expect(html).not.toContain('₡992,13');
  });

  it('shows every supported loan status count, first operation and the honest detail limitation', () => {
    const html = render(data());
    for (const label of ['Total préstamos', 'Activos', 'Cancelados', 'Refinanciados', 'Incobrables', 'Anulados'])
      expect(html).toContain(label);
    expect(html).toContain('Primera operación: 15/01/2026');
    expect(html).toContain('no detalle financiero por préstamo');
  });

  it.each(['CON_ADVERTENCIAS', 'INCONSISTENTE', 'NO_DISPONIBLE'] as const)('renders %s integrity and its warnings', (status) => {
    const html = render(data(status));
    expect(html).toContain(status.replaceAll('_', ' '));
    expect(html).toContain('Revisar procedencia económica.');
  });

  it('renders null financial fields as No disponible, never as zero or invalid numbers', () => {
    const unavailable = data('NO_DISPONIBLE');
    unavailable.flujoCaja.capitalRealDesembolsado = null;
    unavailable.flujoCaja.pagosRecibidos = null;
    unavailable.gananciaRealizada.total = null;
    unavailable.capitalEconomico.pendiente = null;
    unavailable.exposicionContractual.saldoTotal = null;
    unavailable.indicadores.rentabilidadHistorica = null;
    unavailable.indicadores.tasaEquivalente30Dias = null;
    unavailable.profitability.cumulativeReturnRate = null;
    const html = render(unavailable);
    expect((html.match(/No disponible/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(html).toContain('No hay información suficiente para interpretar este indicador.');
    expect(html).toContain('No hay datos suficientes para interpretar conjuntamente estos indicadores.');
    expect(html).not.toContain('Por cada ₡100 entregados');
    expect(html).not.toContain('Este cliente ha generado un retorno acumulado de');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('does not disguise malformed backend money as an authoritative zero', () => {
    const malformed = data('INCONSISTENTE');
    malformed.flujoCaja.capitalRealDesembolsado = 'not-money';
    const html = render(malformed);
    expect(html).toContain('DINERO REAL ENTREGADO');
    expect(html).toContain('No disponible');
    expect(html).not.toContain('₡0');
  });

  it('renders retry and change-client affordances in responsive page sections', () => {
    const html = render(null, 'No se pudo cargar.');
    expect(html).toContain('Reintentar'); expect(html).toContain('Cambiar cliente');
    expect(html).toContain('customer-financial-analysis__header');
    expect(html).not.toContain('href="/customers"');
    expect(html).not.toContain('₡152.000');
  });

  it('keeps change-client visible but disabled when customer listing permission is missing', () => {
    const state: CustomerFinancialAnalysisState = { customerId: 'customer-1', asOf: '2026-09-30', analysis: data(), loading: false, error: '' };
    const html = renderToStaticMarkup(<MemoryRouter><FinancialAnalysisView state={state} controller={controller}
      canChangeCustomer={false} /></MemoryRouter>);
    expect(html).toContain('disabled=""');
    expect(html).toContain('Se requiere permiso para consultar clientes');
  });
});
