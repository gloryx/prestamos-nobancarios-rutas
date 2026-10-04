import type { CustomerFinancialAnalysisResult } from '../../domain/customer/customer-financial-analysis';

const statuses = { COMPLETE: 'COMPLETO', WITH_WARNINGS: 'CON_ADVERTENCIAS',
  INCONSISTENT: 'INCONSISTENTE', NOT_AVAILABLE: 'NO_DISPONIBLE' } as const;

type Analysis = CustomerFinancialAnalysisResult & { customer: { id: string; identification: string; fullName: string } };

export function customerFinancialAnalysisResponse(result: Analysis) {
  return {
    cliente: { id: result.customer.id, identificacion: result.customer.identification, nombreCompleto: result.customer.fullName },
    fechaCorte: result.asOf,
    historial: { fechaPrimerCapitalDesplegado: result.history.firstEconomicDeploymentDate,
      cantidadDiasCalendario: result.history.calendarDays, cantidadPrestamos: result.history.loanCount,
      cantidadCadenas: result.history.chainCount, prestamosPorEstado: result.history.loansByStatus },
    flujoCaja: { capitalRealDesembolsado: result.cashFlow.realCashDisbursed, pagosRecibidos: result.cashFlow.paymentsReceived },
    capitalEconomico: { recuperado: result.economicCapital.recovered, pendiente: result.economicCapital.pending,
      capitalDays: result.economicCapital.capitalDays, capitalPromedioTrabajando: result.economicCapital.averageWorkingCapital },
    rendimientoCapitalizado: { creado: result.capitalizedYield.created, recuperado: result.capitalizedYield.recovered,
      pendiente: result.capitalizedYield.pending },
    gananciaRealizada: { interesRegular: result.realizedGain.regularInterest,
      rendimientoCapitalizadoRecuperado: result.realizedGain.recoveredCapitalizedYield, total: result.realizedGain.total },
    exposicionContractual: { principalPendiente: result.contractualExposure.outstandingPrincipal,
      interesPendiente: result.contractualExposure.outstandingInterest, saldoTotal: result.contractualExposure.total },
    profitability: { cumulativeReturnRate: result.profitability.cumulativeReturnRate },
    indicadores: { rentabilidadHistorica: result.indicators.historicalProfitability,
      tasaEquivalente30Dias: result.indicators.equivalentThirtyDayRate, rotacionCapital: result.indicators.capitalRotation },
    integridad: { estado: statuses[result.integrity.status], advertencias: result.integrity.warnings },
  };
}
