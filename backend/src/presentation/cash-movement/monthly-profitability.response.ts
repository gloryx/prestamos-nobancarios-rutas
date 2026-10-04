import type { MonthlyProfitabilityResult } from '../../domain/cash-movement/monthly-profitability';

const statuses = { COMPLETE: 'COMPLETO', WARNING: 'CON_ADVERTENCIAS',
  INCONSISTENT: 'INCONSISTENTE', UNAVAILABLE: 'NO_DISPONIBLE' } as const;

export function monthlyProfitabilityResponse(result: Omit<MonthlyProfitabilityResult, 'normal' | 'refinancings' | 'payments'>) {
  return {
    periodo: result.period,
    fechaDesde: result.fromDate,
    fechaHasta: result.toDate,
    cantidadDias: result.calendarDays,
    ganancia: {
      total: result.gain.total,
      normal: result.gain.normal,
      refinanciamientos: result.gain.refinancings,
      interesRegularRefinanciamientos: result.gain.refinancingRegularInterest,
      rendimientoCapitalizadoRecuperado: result.gain.recoveredCapitalizedYield,
    },
    capital: {
      saldoEconomicoInicial: result.capital.openingEconomicBalance,
      desembolsadoRealPeriodo: result.capital.realDisbursedInPeriod,
      recuperadoEconomicoPeriodo: result.capital.economicRecoveredInPeriod,
      saldoEconomicoFinal: result.capital.closingEconomicBalance,
      capitalDays: result.capital.capitalDays,
      capitalPromedioTrabajando: result.capital.averageWorkingCapital,
    },
    indicadores: {
      rentabilidadPeriodo: result.indicators.periodProfitability,
      tasaEquivalente30Dias: result.indicators.equivalentThirtyDayRate,
      rotacionCapital: result.indicators.capitalRotation,
    },
    integridad: { estado: statuses[result.integrity.status], advertencias: result.integrity.warnings },
  };
}
