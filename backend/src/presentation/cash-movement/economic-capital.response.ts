import type { EconomicCapitalResult } from '../../domain/cash-movement/economic-capital';

const statuses = { COMPLETE: 'COMPLETO', WARNING: 'CON_ADVERTENCIAS', INCONSISTENT: 'INCONSISTENTE', UNAVAILABLE: 'NO_DISPONIBLE' } as const;

export function economicCapitalResponse(result: EconomicCapitalResult) {
  return {
    periodo: result.period,
    fechaDesde: result.fromDate,
    fechaHasta: result.toDate,
    cantidadDias: result.calendarDays,
    saldoEconomicoInicial: result.openingEconomicBalance,
    capitalRealDesembolsadoPeriodo: result.realCapitalDisbursed,
    capitalRecuperadoPeriodo: result.recoveredCapital,
    ajustesReversosPeriodo: result.periodAdjustments,
    capitalPromedioTrabajando: result.averageWorkingCapital,
    rotacionCapital: result.capitalRotation,
    saldoEconomicoFinal: result.closingEconomicBalance,
    estadoDatos: statuses[result.dataStatus],
    advertencias: result.warnings,
    serieDiaria: result.daily.map((day) => ({ fecha: day.date, saldoInicial: day.openingBalance,
      desembolsosReales: day.realDisbursements, capitalRecuperado: day.capitalRecovered,
      ajustesReversos: day.adjustments, saldoFinal: day.closingBalance })),
  };
}
