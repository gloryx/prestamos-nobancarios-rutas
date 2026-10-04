export type CustomerFinancialIntegrity = 'COMPLETO' | 'CON_ADVERTENCIAS' | 'INCONSISTENTE' | 'NO_DISPONIBLE';

export type CustomerFinancialAnalysis = {
  cliente: { id: string; identificacion: string; nombreCompleto: string };
  fechaCorte: string;
  historial: {
    fechaPrimerCapitalDesplegado: string | null;
    cantidadDiasCalendario: number;
    cantidadPrestamos: number;
    cantidadCadenas: number;
    prestamosPorEstado: Record<string, number>;
  };
  flujoCaja: { capitalRealDesembolsado: string | null; pagosRecibidos: string | null };
  capitalEconomico: {
    recuperado: string | null;
    pendiente: string | null;
    capitalDays: string | null;
    capitalPromedioTrabajando: string | null;
  };
  rendimientoCapitalizado: { creado: string | null; recuperado: string | null; pendiente: string | null };
  gananciaRealizada: {
    interesRegular: string | null;
    rendimientoCapitalizadoRecuperado: string | null;
    total: string | null;
  };
  exposicionContractual: {
    principalPendiente: string | null;
    interesPendiente: string | null;
    saldoTotal: string | null;
  };
  profitability: { cumulativeReturnRate: string | null };
  indicadores: {
    rentabilidadHistorica: string | null;
    tasaEquivalente30Dias: string | null;
    rotacionCapital: string | null;
  };
  integridad: { estado: CustomerFinancialIntegrity; advertencias: string[] };
};
