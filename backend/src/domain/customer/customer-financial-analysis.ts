import type { EconomicLoanFact, EconomicProvenanceResult } from '../cash-movement/economic-principal-provenance';

const MONEY = /^-?(?:0|[1-9]\d{0,35})(?:\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type CustomerFinancialAnalysisResult = {
  asOf: string;
  history: {
    firstEconomicDeploymentDate: string | null;
    calendarDays: number;
    loanCount: number;
    chainCount: number;
    loansByStatus: Record<string, number>;
  };
  cashFlow: { realCashDisbursed: string | null; paymentsReceived: string | null };
  economicCapital: {
    recovered: string | null;
    pending: string | null;
    capitalDays: string | null;
    averageWorkingCapital: string | null;
  };
  capitalizedYield: { created: string | null; recovered: string | null; pending: string | null };
  realizedGain: { regularInterest: string | null; recoveredCapitalizedYield: string | null; total: string | null };
  contractualExposure: { outstandingPrincipal: string | null; outstandingInterest: string | null; total: string | null };
  profitability: { cumulativeReturnRate: string | null };
  indicators: { historicalProfitability: string | null; equivalentThirtyDayRate: string | null; capitalRotation: string | null };
  integrity: { status: 'COMPLETE' | 'WITH_WARNINGS' | 'INCONSISTENT' | 'NOT_AVAILABLE'; warnings: string[] };
};

const cents = (value: string): bigint => {
  if (!MONEY.test(value)) throw new Error('Customer financial analysis contains invalid money.');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -amount : amount;
};
const money = (value: bigint): string => {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
};
const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const dateKey = (value: Date): string => value.toISOString().slice(0, 10);
const validDate = (value: string): boolean => {
  if (!DATE.test(value)) return false;
  const parsed = date(value);
  return Number.isFinite(parsed.getTime()) && dateKey(parsed) === value;
};
const addDay = (value: string): string => dateKey(new Date(date(value).getTime() + 86_400_000));
const daysInclusive = (from: string, to: string): number => Math.floor((date(to).getTime() - date(from).getTime()) / 86_400_000) + 1;
const roundedDivision = (numerator: bigint, denominator: bigint): bigint => {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const result = (absolute + denominator / 2n) / denominator;
  return negative ? -result : result;
};
const ratio = (numerator: bigint, denominator: bigint): string | null => {
  if (denominator <= 0n) return null;
  const scaled = roundedDivision(numerator * 10_000n, denominator);
  const absolute = scaled < 0n ? -scaled : scaled;
  return `${scaled < 0n ? '-' : ''}${absolute / 10_000n}.${(absolute % 10_000n).toString().padStart(4, '0')}`;
};

export function calculateCustomerFinancialAnalysis(asOf: string, provenance: EconomicProvenanceResult,
  loans: EconomicLoanFact[]): CustomerFinancialAnalysisResult {
  if (!validDate(asOf)) throw new Error('Customer financial analysis contains an invalid cutoff date.');
  const warnings = [...provenance.warnings];
  const loanById = new Map(loans.map((loan) => [loan.loanId, loan]));
  const loansByStatus: Record<string, number> = {};
  for (const loan of loans) loansByStatus[loan.status] = (loansByStatus[loan.status] ?? 0) + 1;

  let disbursed = 0n;
  let paymentsReceived = 0n;
  let recovered = 0n;
  let pending = 0n;
  let yieldCreated = 0n;
  let yieldRecovered = 0n;
  let yieldPending = 0n;
  let regularInterest = 0n;
  let exposurePrincipal = 0n;
  let exposureInterest = 0n;
  let completeCash = true;
  for (const chain of provenance.chains) {
    if (!chain.isComplete) completeCash = false;
    if (chain.totalRealCashDisbursed === null) completeCash = false;
    else disbursed += cents(chain.totalRealCashDisbursed);
    paymentsReceived += cents(chain.totalPaymentsReceived);
    recovered += cents(chain.economicPrincipalRecovered);
    pending += cents(chain.economicPrincipalPending);
    yieldCreated += cents(chain.capitalizedYieldCreated);
    yieldRecovered += cents(chain.capitalizedYieldRecovered);
    yieldPending += cents(chain.capitalizedYieldPending);
    regularInterest += cents(chain.regularInterestRealized);

    const terminal = loanById.get(chain.terminalLoanId);
    if (!terminal) {
      warnings.push(`El préstamo terminal ${chain.terminalLoanId} no existe en el corte financiero del cliente.`);
      continue;
    }
    if (terminal.status === 'REFINANCED') {
      warnings.push(`El préstamo refinanciado ${terminal.loanId} no tiene un sucesor conciliado en el corte.`);
      continue;
    }
    if (terminal.status === 'ANNULLED') continue;
    const terminalPayments = chain.payments.filter((payment) => payment.loanId === terminal.loanId);
    const principalApplied = terminalPayments.reduce((sum, payment) => sum + cents(payment.principalAppliedContractual), 0n);
    const interestApplied = terminalPayments.reduce((sum, payment) => sum + cents(payment.interestApplied), 0n);
    const outstandingPrincipal = cents(terminal.principal) - principalApplied;
    const outstandingInterest = cents(terminal.interestAmount) - interestApplied;
    exposurePrincipal += outstandingPrincipal;
    exposureInterest += outstandingInterest;
    if (outstandingPrincipal < 0n || outstandingInterest < 0n)
      warnings.push(`El préstamo terminal ${terminal.loanId} presenta una exposición contractual negativa.`);
    if (terminal.status === 'CANCELLED' && (outstandingPrincipal !== 0n || outstandingInterest !== 0n
      || cents(chain.economicPrincipalPending) !== 0n || cents(chain.capitalizedYieldPending) !== 0n))
      warnings.push(`El préstamo cancelado ${terminal.loanId} conserva saldos pendientes en el corte.`);
  }

  const grouped = new Map<string, { disbursed: bigint; recovered: bigint; adjustments: bigint }>();
  let firstEconomicDeploymentDate: string | null = null;
  for (const event of provenance.events) {
    if (!validDate(event.date) || event.date > asOf) {
      warnings.push('La reconstrucción económica contiene eventos fuera del corte o con fecha inválida.');
      continue;
    }
    const eventDisbursed = cents(event.realDisbursements);
    const row = grouped.get(event.date) ?? { disbursed: 0n, recovered: 0n, adjustments: 0n };
    row.disbursed += eventDisbursed;
    row.recovered += cents(event.capitalRecovered);
    row.adjustments += cents(event.adjustments);
    grouped.set(event.date, row);
    if (eventDisbursed > 0n && (!firstEconomicDeploymentDate || event.date < firstEconomicDeploymentDate))
      firstEconomicDeploymentDate = event.date;
  }
  let capitalDays: bigint | null = null;
  let averageWorkingCapital: bigint | null = null;
  let calendarDays = 0;
  if (firstEconomicDeploymentDate) {
    calendarDays = daysInclusive(firstEconomicDeploymentDate, asOf);
    let balance = 0n;
    let sum = 0n;
    for (let current = firstEconomicDeploymentDate; current <= asOf; current = addDay(current)) {
      const event = grouped.get(current) ?? { disbursed: 0n, recovered: 0n, adjustments: 0n };
      balance += event.disbursed - event.recovered + event.adjustments;
      sum += balance;
      if (balance < 0n) warnings.push('El saldo económico diario resulta negativo; existen hechos incompletos o inconsistentes.');
    }
    capitalDays = sum;
    averageWorkingCapital = roundedDivision(sum, BigInt(calendarDays));
    if (balance !== pending)
      warnings.push('El saldo económico diario no concilia con el capital económico pendiente de las cadenas.');
  }

  const uniqueWarnings = [...new Set(warnings)];
  const inconsistent = uniqueWarnings.some((warning) => provenance.warnings.includes(warning)
    || warning.includes('no existe') || warning.includes('no tiene un sucesor') || warning.includes('negativa')
    || warning.includes('fuera del corte') || warning.includes('no concilia') || warning.includes('saldos pendientes'));
  const hasAnnulled = (loansByStatus.ANNULLED ?? 0) > 0;
  if (hasAnnulled) uniqueWarnings.push('Los préstamos anulados se conservan en el historial y se excluyen de la exposición contractual válida.');
  const status = inconsistent || !completeCash ? 'INCONSISTENT'
    : !firstEconomicDeploymentDate ? 'NOT_AVAILABLE'
      : hasAnnulled ? 'WITH_WARNINGS' : 'COMPLETE';
  if (!firstEconomicDeploymentDate && loans.length === 0)
    uniqueWarnings.push('El cliente no registra capital económico desplegado a la fecha de corte.');
  const gain = regularInterest + yieldRecovered;
  const unavailableFinancials = loans.length > 0 && provenance.chains.length === 0 && provenance.warnings.length > 0;
  const reliableCashDenominator = (status === 'COMPLETE' || status === 'WITH_WARNINGS')
    && completeCash && !unavailableFinancials && disbursed > 0n;
  const reliable = (status === 'COMPLETE' || status === 'WITH_WARNINGS') && capitalDays !== null && capitalDays > 0n;
  return {
    asOf,
    history: { firstEconomicDeploymentDate, calendarDays, loanCount: loans.length,
      chainCount: provenance.chains.length, loansByStatus },
    cashFlow: { realCashDisbursed: completeCash && !unavailableFinancials ? money(disbursed) : null,
      paymentsReceived: unavailableFinancials ? null : money(paymentsReceived) },
    economicCapital: { recovered: unavailableFinancials ? null : money(recovered), pending: unavailableFinancials ? null : money(pending),
      capitalDays: capitalDays === null ? null : money(capitalDays),
      averageWorkingCapital: averageWorkingCapital === null ? null : money(averageWorkingCapital) },
    capitalizedYield: { created: unavailableFinancials ? null : money(yieldCreated),
      recovered: unavailableFinancials ? null : money(yieldRecovered), pending: unavailableFinancials ? null : money(yieldPending) },
    realizedGain: { regularInterest: unavailableFinancials ? null : money(regularInterest),
      recoveredCapitalizedYield: unavailableFinancials ? null : money(yieldRecovered), total: unavailableFinancials ? null : money(gain) },
    contractualExposure: { outstandingPrincipal: unavailableFinancials ? null : money(exposurePrincipal),
      outstandingInterest: unavailableFinancials ? null : money(exposureInterest),
      total: unavailableFinancials ? null : money(exposurePrincipal + exposureInterest) },
    profitability: { cumulativeReturnRate: reliableCashDenominator ? ratio(gain, disbursed) : null },
    indicators: { historicalProfitability: reliable ? ratio(gain * BigInt(calendarDays), capitalDays!) : null,
      equivalentThirtyDayRate: reliable ? ratio(gain * 30n, capitalDays!) : null,
      capitalRotation: reliable ? ratio(disbursed * BigInt(calendarDays), capitalDays!) : null },
    integrity: { status, warnings: [...new Set(uniqueWarnings)] },
  };
}
