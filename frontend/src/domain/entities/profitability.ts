export type ProfitabilityIntegrityStatus = 'COMPLETO' | 'CON_ADVERTENCIAS' | 'INCONSISTENTE' | 'NO_DISPONIBLE';
export type ProfitabilityLoanStatus = 'ACTIVE' | 'CANCELLED' | 'REFINANCED' | 'UNCOLLECTIBLE' | 'ANNULLED';

export type ProfitabilitySummary = {
  periodo: string;
  fechaDesde: string;
  fechaHasta: string;
  cantidadDias: number;
  ganancia: {
    total: string;
    normal: string;
    refinanciamientos: string;
    interesRegularRefinanciamientos: string;
    rendimientoCapitalizadoRecuperado: string;
  };
  capital: {
    saldoEconomicoInicial: string | null;
    desembolsadoRealPeriodo: string | null;
    recuperadoEconomicoPeriodo: string | null;
    saldoEconomicoFinal: string | null;
    capitalDays: string | null;
    capitalPromedioTrabajando: string | null;
  };
  indicadores: {
    rentabilidadPeriodo: string | null;
    tasaEquivalente30Dias: string | null;
    rotacionCapital: string | null;
  };
  integridad: { estado: ProfitabilityIntegrityStatus; advertencias: string[] };
};

export type ProfitabilityNormalRow = {
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  status: string;
  realizedInterestInPeriod: string;
  paymentCountContributing: number;
};

export type ProfitabilityRefinancingRow = {
  rootLoanId: string;
  terminalLoanId: string;
  loanIds: string[];
  refinancingIds: string[];
  customer: { id: string; name: string };
  chainStatus: string;
  regularInterestRealizedInPeriod: string;
  capitalizedYieldRecoveredInPeriod: string;
  economicGainInPeriod: string;
  capitalizedYieldPendingAtEnd: string;
  paymentCountContributing: number;
};

export type ProfitabilityPaymentRow = {
  eventType: 'PAYMENT' | 'REVERSAL';
  source: 'NORMAL' | 'REFINANCING';
  rootLoanId: string | null;
  paymentId: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  paymentDate: string;
  paymentAmount: string;
  principalAppliedContractual: string;
  economicPrincipalRecovered: string;
  capitalizedYieldRecovered: string;
  interestApplied: string;
  economicGainContribution: string;
};

export type ProfitabilityNormalSummary = { realizedInterest: string | null };
export type ProfitabilityRefinancingSummary = {
  regularInterestRealized: string | null;
  capitalizedYieldRecovered: string | null;
  economicGain: string | null;
};
export type ProfitabilityZoomSummary = ProfitabilityNormalSummary | ProfitabilityRefinancingSummary;
export type ProfitabilityPage<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number;
  summary?: ProfitabilityZoomSummary };

export type ProfitabilityPaymentFilters = {
  source?: 'NORMAL' | 'REFINANCING';
  loanId?: string;
  rootLoanId?: string;
};

export type ProfitabilityZoomFilters = ProfitabilityPaymentFilters & {
  status?: ProfitabilityLoanStatus;
  terminalStatus?: ProfitabilityLoanStatus;
};

export type EconomicCapitalSeries = {
  periodo: string;
  fechaDesde: string;
  fechaHasta: string;
  estadoDatos: ProfitabilityIntegrityStatus;
  advertencias: string[];
  serieDiaria: Array<{
    fecha: string;
    saldoInicial: string;
    desembolsosReales: string;
    capitalRecuperado: string;
    ajustesReversos: string;
    saldoFinal: string;
  }>;
};

export type ProfitabilityDetailKind = 'normal' | 'refinancings' | 'payments';
export type ProfitabilityDetailRow = ProfitabilityNormalRow | ProfitabilityRefinancingRow | ProfitabilityPaymentRow;
