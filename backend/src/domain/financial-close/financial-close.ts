import type { EconomicPaymentFact, EconomicProvenanceFacts, EconomicProvenanceResult } from '../cash-movement/economic-principal-provenance';
import type { MonthlyProfitabilityResult } from '../cash-movement/monthly-profitability';

export const FINANCIAL_CLOSE_MODEL_VERSION = 2;
export type FinancialCloseSection = 'LIQUIDITY' | 'CONTRACTUAL_PORTFOLIO' | 'ECONOMIC_CAPITAL' |
  'REFINANCINGS' | 'PROFITABILITY' | 'RECONCILIATIONS';
export type FinancialCloseCashFact = { direction: 'INFLOW' | 'OUTFLOW'; concept: string; amount: string; date: string;
  reversedConcept: string | null };
export type FinancialCloseStatusTransition = { loanId: string; fromStatus: string | null; toStatus: string; date: string };
export type FinancialCloseConcept = { section: FinancialCloseSection; code: string; label: string;
  classification: 'OPERATING' | 'FINANCING' | 'EXTERNAL_NON_OPERATING' | 'BALANCE' | 'CONTROL' | 'RESULT';
  amount: string; ordinal: number };
export type FinancialCloseCalculation = { modelVersion: 2; period: string; fromDate: string; toDate: string;
  integrity: { status: 'COMPLETE' | 'INCONSISTENT'; blockingIssues: string[]; warnings: string[] };
  sections: Array<{ code: FinancialCloseSection; concepts: FinancialCloseConcept[] }> };
export type FinancialCloseEconomicSnapshot = { provenance: EconomicProvenanceResult; facts: EconomicProvenanceFacts };

const MONEY = /^-?(?:0|[1-9]\d{0,35})(?:\.\d{1,2})?$/;
const cents = (value: string): bigint => {
  if (!MONEY.test(value)) throw new Error('Financial close contains invalid money.');
  const negative = value.startsWith('-'); const [whole, decimal = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0')); return negative ? -result : result;
};
const money = (value: bigint): string => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100n}.${((value < 0n ? -value : value) % 100n).toString().padStart(2, '0')}`;
const within = (date: string | null, fromDate: string, toDate: string) => date !== null && date >= fromDate && date <= toDate;
const sum = <T>(rows: T[], value: (row: T) => bigint) => rows.reduce((total, row) => total + value(row), 0n);
const cash = (facts: FinancialCloseCashFact[], direction: 'INFLOW' | 'OUTFLOW', concept: string) =>
  sum(facts.filter((fact) => fact.direction === direction && fact.concept === concept), (fact) => cents(fact.amount));
const reversedCash = (facts: FinancialCloseCashFact[], direction: 'INFLOW' | 'OUTFLOW', sourceConcept: string) =>
  sum(facts.filter((fact) => fact.direction === direction && fact.concept === 'REVERSAL' && fact.reversedConcept === sourceConcept), (fact) => cents(fact.amount));

function effectivePayments(payments: EconomicPaymentFact[], loanId: string, throughDate: string): bigint {
  return sum(payments.filter((payment) => payment.loanId === loanId), (payment) => {
    const received = payment.date <= throughDate ? cents(payment.amount) : 0n;
    const reversed = payment.reversalDate && payment.reversalDate <= throughDate ? cents(payment.amount) : 0n;
    return received - reversed;
  });
}

function contractualStockAt(snapshot: FinancialCloseEconomicSnapshot, throughDate: string) {
  const loans = new Map(snapshot.facts.loans.map((loan) => [loan.loanId, loan]));
  let active = 0n; let uncollectible = 0n;
  for (const chain of snapshot.provenance.chains) {
    const terminal = loans.get(chain.terminalLoanId);
    if (!terminal || !['ACTIVE', 'UNCOLLECTIBLE'].includes(terminal.status)) continue;
    const outstanding = cents(terminal.totalAmount) - effectivePayments(snapshot.facts.payments, terminal.loanId, throughDate);
    if (terminal.status === 'ACTIVE') active += outstanding; else uncollectible += outstanding;
  }
  return { active, uncollectible, total: active + uncollectible };
}

function economicStock(snapshot: FinancialCloseEconomicSnapshot | null, fallbackTotal: bigint, fallbackUncollectible: bigint) {
  if (!snapshot) return { active: fallbackTotal - fallbackUncollectible, uncollectible: fallbackUncollectible,
    total: fallbackTotal, pendingYield: 0n };
  const statuses = new Map(snapshot.facts.loans.map((loan) => [loan.loanId, loan.status]));
  let active = 0n; let uncollectible = 0n; let pendingYield = 0n;
  for (const chain of snapshot.provenance.chains) {
    const status = statuses.get(chain.terminalLoanId);
    if (status !== 'ACTIVE' && status !== 'UNCOLLECTIBLE') continue;
    if (status === 'ACTIVE') active += cents(chain.economicPrincipalPending); else uncollectible += cents(chain.economicPrincipalPending);
    pendingYield += cents(chain.capitalizedYieldPending);
  }
  return { active, uncollectible, total: active + uncollectible, pendingYield };
}

function paymentFlows(payments: EconomicPaymentFact[], fromDate: string, toDate: string) {
  let received = 0n; let reversed = 0n;
  for (const payment of payments) {
    if (within(payment.date, fromDate, toDate)) received += cents(payment.amount);
    if (within(payment.reversalDate, fromDate, toDate)) reversed += cents(payment.amount);
  }
  return { received, reversed, net: received - reversed };
}

export function calculateFinancialClose(input: { period: string; openingDate: string; initialAvailableAmount: string;
  initialPortfolio: string; initialUncollectibleAmount: string; cashFacts: FinancialCloseCashFact[];
  cashBalances: { opening: string; closing: string }; profitability: MonthlyProfitabilityResult;
  openingEconomic: FinancialCloseEconomicSnapshot | null; finalEconomic: FinancialCloseEconomicSnapshot;
  statusTransitions: FinancialCloseStatusTransition[] }): FinancialCloseCalculation {
  const { fromDate, toDate } = input.profitability;
  const periodCash = input.cashFacts.filter((fact) => within(fact.date, fromDate, toDate));
  const cashIn = sum(periodCash.filter((fact) => fact.direction === 'INFLOW'), (fact) => cents(fact.amount));
  const cashOut = sum(periodCash.filter((fact) => fact.direction === 'OUTFLOW'), (fact) => cents(fact.amount));
  const openingCash = cents(input.cashBalances.opening); const closingCash = cents(input.cashBalances.closing);
  const cashVariance = closingCash - (openingCash + cashIn - cashOut);
  const customerCash = cash(periodCash, 'INFLOW', 'CUSTOMER_PAYMENT') - reversedCash(periodCash, 'OUTFLOW', 'CUSTOMER_PAYMENT');
  const contributions = cash(periodCash, 'INFLOW', 'CAPITAL_CONTRIBUTION') - reversedCash(periodCash, 'OUTFLOW', 'CAPITAL_CONTRIBUTION');
  const externalIncome = cash(periodCash, 'INFLOW', 'EXTERNAL_INCOME') - reversedCash(periodCash, 'OUTFLOW', 'EXTERNAL_INCOME');
  const normalDisbursements = cash(periodCash, 'OUTFLOW', 'LOAN_DISBURSEMENT') - reversedCash(periodCash, 'INFLOW', 'LOAN_DISBURSEMENT');
  const refinancingDisbursements = cash(periodCash, 'OUTFLOW', 'REFINANCING_NEW_MONEY_DISBURSEMENT')
    - reversedCash(periodCash, 'INFLOW', 'REFINANCING_NEW_MONEY_DISBURSEMENT');
  const normalEconomicOrigin = cash(periodCash, 'OUTFLOW', 'LOAN_DISBURSEMENT');
  const refinancingEconomicOrigin = cash(periodCash, 'OUTFLOW', 'REFINANCING_NEW_MONEY_DISBURSEMENT');
  const disbursementReversalAdjustment = -reversedCash(periodCash, 'INFLOW', 'LOAN_DISBURSEMENT')
    - reversedCash(periodCash, 'INFLOW', 'REFINANCING_NEW_MONEY_DISBURSEMENT');
  const expenses = cash(periodCash, 'OUTFLOW', 'OPERATING_EXPENSE') - reversedCash(periodCash, 'INFLOW', 'OPERATING_EXPENSE');
  const withdrawals = cash(periodCash, 'OUTFLOW', 'CAPITAL_WITHDRAWAL') - reversedCash(periodCash, 'INFLOW', 'CAPITAL_WITHDRAWAL');

  const finalSnapshot = input.finalEconomic;
  const openingContract = input.openingEconomic ? contractualStockAt(input.openingEconomic, fromDate < input.openingDate ? input.openingDate : fromDate)
    : { active: cents(input.initialPortfolio) - cents(input.initialUncollectibleAmount),
      uncollectible: cents(input.initialUncollectibleAmount), total: cents(input.initialPortfolio) };
  const finalContract = contractualStockAt(finalSnapshot, toDate);
  const incoming = new Set(finalSnapshot.facts.refinancings.map((row) => row.newLoanId));
  const normalOriginations = finalSnapshot.facts.loans.filter((loan) => !incoming.has(loan.loanId) && within(loan.startDate, fromDate, toDate));
  const periodRefinancings = finalSnapshot.facts.refinancings.filter((row) => within(row.refinancingDate, fromDate, toDate));
  const normalContractOriginated = sum(normalOriginations, (loan) => cents(loan.totalAmount));
  const successorContractTotal = sum(periodRefinancings, (row) => cents(finalSnapshot.facts.loans.find((loan) => loan.loanId === row.newLoanId)?.totalAmount ?? '0.00'));
  const transferredPrincipal = sum(periodRefinancings, (row) => cents(row.outstandingPrincipalTransferred));
  const capitalizedYield = sum(periodRefinancings, (row) => cents(row.capitalizedOutstandingInterest));
  const newMoney = sum(periodRefinancings, (row) => cents(row.newMoneyDisbursed));
  const successorPrincipal = sum(periodRefinancings, (row) => cents(row.newContractualPrincipal));
  const removedOriginContract = transferredPrincipal + capitalizedYield;
  const contractualPayments = paymentFlows(finalSnapshot.facts.payments, fromDate, toDate);
  const annulledContract = sum(finalSnapshot.facts.loans.filter((loan) => within(loan.annulledDate, fromDate, toDate)),
    (loan) => cents(loan.totalAmount) - effectivePayments(finalSnapshot.facts.payments, loan.loanId, loan.annulledDate!));
  const contractualVariance = finalContract.total - (openingContract.total + normalContractOriginated + successorContractTotal
    - contractualPayments.net - removedOriginContract - annulledContract);
  const uncollectibleMovement = sum(input.statusTransitions.filter((transition) => within(transition.date, fromDate, toDate)), (transition) => {
    const loan = finalSnapshot.facts.loans.find((item) => item.loanId === transition.loanId);
    if (!loan) return 0n;
    const outstanding = cents(loan.totalAmount) - effectivePayments(finalSnapshot.facts.payments, loan.loanId, transition.date);
    if (transition.toStatus === 'UNCOLLECTIBLE') return outstanding;
    if (transition.fromStatus === 'UNCOLLECTIBLE' && transition.toStatus === 'ACTIVE') return -outstanding;
    return 0n;
  });

  const openingEconomic = economicStock(input.openingEconomic, cents(input.initialPortfolio), cents(input.initialUncollectibleAmount));
  const closingEconomic = economicStock(finalSnapshot, 0n, 0n);
  const gainEvents = finalSnapshot.provenance.gainEvents.filter((event) => within(event.date, fromDate, toDate));
  const recoveredEconomic = sum(gainEvents, (event) => cents(event.economicPrincipalRecovered));
  const regularInterest = sum(gainEvents, (event) => cents(event.interestApplied));
  const recoveredYield = sum(gainEvents, (event) => cents(event.capitalizedYieldRecovered));
  const paymentReversalRestoration = -sum(gainEvents.filter((event) => event.eventType === 'REVERSAL'),
    (event) => cents(event.economicPrincipalRecovered));
  const reportedAdjustments = cents(input.profitability.capital.adjustmentsInPeriod ?? '0.00');
  const legitimateEconomicAdjustment = disbursementReversalAdjustment;
  const adjustmentEvidenceVariance = reportedAdjustments - paymentReversalRestoration - legitimateEconomicAdjustment;
  const originatedEconomic = normalEconomicOrigin + refinancingEconomicOrigin;
  const closingEconomicCapital = cents(input.profitability.capital.closingEconomicBalance ?? '0.00');
  const capitalVariance = closingEconomicCapital - (cents(input.profitability.capital.openingEconomicBalance ?? '0.00')
    + originatedEconomic - recoveredEconomic + legitimateEconomicAdjustment);
  const exposureVariance = closingEconomicCapital - closingEconomic.total;
  const totalGain = cents(input.profitability.gain.total);
  const gainVariance = totalGain - regularInterest - recoveredYield;
  const paymentVariance = customerCash - recoveredEconomic - regularInterest - recoveredYield;
  const economicResult = totalGain - expenses;

  let ordinal = 0;
  const concept = (section: FinancialCloseSection, code: string, label: string, classification: FinancialCloseConcept['classification'], value: bigint): FinancialCloseConcept =>
    ({ section, code, label, classification, amount: money(value), ordinal: ++ordinal });
  const concepts: FinancialCloseConcept[] = [
    concept('LIQUIDITY', 'SALDO_CAJA_INICIAL', 'Saldo inicial de caja', 'BALANCE', openingCash),
    concept('LIQUIDITY', 'ENTRADAS_CAJA', 'Entradas de caja', 'BALANCE', cashIn),
    concept('LIQUIDITY', 'SALIDAS_CAJA', 'Salidas de caja', 'BALANCE', cashOut),
    concept('LIQUIDITY', 'PAGOS_CLIENTES_NETOS', 'Pagos netos recibidos de clientes', 'OPERATING', customerCash),
    concept('LIQUIDITY', 'APORTES_CAPITAL_NETOS', 'Aportes netos de capital', 'FINANCING', contributions),
    concept('LIQUIDITY', 'INGRESOS_EXTERNOS_NETOS', 'Ingresos externos netos', 'EXTERNAL_NON_OPERATING', externalIncome),
    concept('LIQUIDITY', 'DESEMBOLSOS_PRESTAMOS_NORMALES', 'Desembolsos de préstamos normales', 'OPERATING', normalDisbursements),
    concept('LIQUIDITY', 'DESEMBOLSOS_DINERO_NUEVO_REFINANCIACION', 'Desembolsos de dinero nuevo por refinanciación', 'OPERATING', refinancingDisbursements),
    concept('LIQUIDITY', 'GASTOS_OPERATIVOS_NETOS', 'Gastos operativos netos', 'OPERATING', expenses),
    concept('LIQUIDITY', 'RETIROS_CAPITAL_NETOS', 'Retiros netos de capital', 'FINANCING', withdrawals),
    concept('LIQUIDITY', 'SALDO_CAJA_FINAL', 'Saldo final de caja', 'BALANCE', closingCash),

    concept('CONTRACTUAL_PORTFOLIO', 'CARTERA_CONTRACTUAL_ACTIVA_INICIAL', 'Cartera contractual activa inicial', 'BALANCE', openingContract.active),
    concept('CONTRACTUAL_PORTFOLIO', 'CARTERA_CONTRACTUAL_INCOBRABLE_INICIAL', 'Cartera contractual incobrable inicial', 'BALANCE', openingContract.uncollectible),
    concept('CONTRACTUAL_PORTFOLIO', 'CARTERA_CONTRACTUAL_TOTAL_INICIAL', 'Cartera contractual total inicial', 'BALANCE', openingContract.total),
    concept('CONTRACTUAL_PORTFOLIO', 'ORIGINACION_CONTRACTUAL_NORMAL', 'Originación contractual normal', 'OPERATING', normalContractOriginated),
    concept('CONTRACTUAL_PORTFOLIO', 'ORIGINACION_CONTRACTUAL_REFINANCIACION', 'Originación contractual por refinanciación', 'OPERATING', successorContractTotal),
    concept('CONTRACTUAL_PORTFOLIO', 'PAGOS_CONTRACTUALES_NETOS', 'Pagos contractuales netos', 'OPERATING', contractualPayments.net),
    concept('CONTRACTUAL_PORTFOLIO', 'SALDO_ORIGEN_RETIRADO_REFINANCIACION', 'Saldo contractual de origen retirado por refinanciación', 'CONTROL', removedOriginContract),
    concept('CONTRACTUAL_PORTFOLIO', 'CARTERA_ANULADA_RETIRADA', 'Cartera anulada retirada', 'CONTROL', annulledContract),
    concept('CONTRACTUAL_PORTFOLIO', 'TRASLADO_NETO_CARTERA_INCOBRABLE', 'Traslado neto a cartera incobrable', 'CONTROL', uncollectibleMovement),
    concept('CONTRACTUAL_PORTFOLIO', 'CARTERA_CONTRACTUAL_ACTIVA_FINAL', 'Cartera contractual activa final', 'BALANCE', finalContract.active),
    concept('CONTRACTUAL_PORTFOLIO', 'CARTERA_CONTRACTUAL_INCOBRABLE_FINAL', 'Cartera contractual incobrable final', 'BALANCE', finalContract.uncollectible),
    concept('CONTRACTUAL_PORTFOLIO', 'CARTERA_CONTRACTUAL_TOTAL_FINAL', 'Cartera contractual total final', 'BALANCE', finalContract.total),

    concept('ECONOMIC_CAPITAL', 'CAPITAL_ECONOMICO_ACTIVO_INICIAL', 'Capital económico activo inicial', 'BALANCE', openingEconomic.active),
    concept('ECONOMIC_CAPITAL', 'CAPITAL_ECONOMICO_INCOBRABLE_INICIAL', 'Capital económico incobrable inicial', 'BALANCE', openingEconomic.uncollectible),
    concept('ECONOMIC_CAPITAL', 'CAPITAL_ECONOMICO_INICIAL', 'Capital económico total inicial', 'BALANCE', cents(input.profitability.capital.openingEconomicBalance ?? '0.00')),
    concept('ECONOMIC_CAPITAL', 'CAPITAL_ECONOMICO_ORIGINADO_NORMAL', 'Capital económico originado en préstamos normales', 'OPERATING', normalEconomicOrigin),
    concept('ECONOMIC_CAPITAL', 'CAPITAL_ECONOMICO_ORIGINADO_REFINANCIACION', 'Capital económico originado por refinanciación', 'OPERATING', refinancingEconomicOrigin),
    concept('ECONOMIC_CAPITAL', 'CAPITAL_ECONOMICO_ORIGINADO', 'Capital económico originado', 'OPERATING', originatedEconomic),
    concept('ECONOMIC_CAPITAL', 'CAPITAL_ECONOMICO_RECUPERADO', 'Capital económico recuperado neto', 'OPERATING', recoveredEconomic),
    concept('ECONOMIC_CAPITAL', 'AJUSTE_CAPITAL_ECONOMICO', 'Ajuste legítimo de capital económico', 'CONTROL', legitimateEconomicAdjustment),
    concept('ECONOMIC_CAPITAL', 'CAPITAL_ECONOMICO_ACTIVO_FINAL', 'Capital económico activo final', 'BALANCE', closingEconomic.active),
    concept('ECONOMIC_CAPITAL', 'CAPITAL_ECONOMICO_INCOBRABLE_FINAL', 'Capital económico incobrable final', 'BALANCE', closingEconomic.uncollectible),
    concept('ECONOMIC_CAPITAL', 'CAPITAL_ECONOMICO_FINAL', 'Capital económico total final', 'BALANCE', closingEconomicCapital),
    concept('ECONOMIC_CAPITAL', 'RENDIMIENTO_CAPITALIZADO_PENDIENTE', 'Rendimiento capitalizado pendiente', 'BALANCE', closingEconomic.pendingYield),

    concept('REFINANCINGS', 'CAPITAL_PRINCIPAL_TRANSFERIDO', 'Capital principal transferido', 'CONTROL', transferredPrincipal),
    concept('REFINANCINGS', 'RENDIMIENTO_CAPITALIZADO_CREADO', 'Rendimiento capitalizado creado', 'CONTROL', capitalizedYield),
    concept('REFINANCINGS', 'DINERO_NUEVO_DESEMBOLSADO', 'Dinero nuevo desembolsado', 'OPERATING', newMoney),
    concept('REFINANCINGS', 'CAPITAL_CONTRACTUAL_SUCESOR', 'Capital contractual de sucesores', 'CONTROL', successorPrincipal),
    concept('REFINANCINGS', 'TOTAL_CONTRACTUAL_SUCESOR', 'Total contractual de sucesores', 'CONTROL', successorContractTotal),

    concept('PROFITABILITY', 'INTERES_REGULAR_REALIZADO', 'Interés regular realizado', 'OPERATING', regularInterest),
    concept('PROFITABILITY', 'RENDIMIENTO_CAPITALIZADO_RECUPERADO', 'Rendimiento capitalizado recuperado', 'OPERATING', recoveredYield),
    concept('PROFITABILITY', 'GANANCIA_ECONOMICA_REALIZADA', 'Ganancia económica realizada', 'RESULT', totalGain),
    concept('PROFITABILITY', 'GASTOS_OPERATIVOS_DEL_MES', 'Gastos operativos netos del mes', 'OPERATING', expenses),
    concept('PROFITABILITY', 'RESULTADO_ECONOMICO_MES', 'Resultado económico del mes', 'RESULT', economicResult),
    concept('PROFITABILITY', 'INGRESOS_EXTERNOS_EXCLUIDOS', 'Ingresos externos excluidos del resultado económico', 'EXTERNAL_NON_OPERATING', externalIncome),

    concept('RECONCILIATIONS', 'VARIACION_CONCILIACION_CAJA', 'Variación de conciliación de caja', 'CONTROL', cashVariance),
    concept('RECONCILIATIONS', 'VARIACION_CONCILIACION_CARTERA_CONTRACTUAL', 'Variación de conciliación contractual', 'CONTROL', contractualVariance),
    concept('RECONCILIATIONS', 'VARIACION_CONCILIACION_CAPITAL_ECONOMICO', 'Variación de conciliación de capital económico', 'CONTROL', capitalVariance),
    concept('RECONCILIATIONS', 'VARIACION_EVIDENCIA_AJUSTE_CAPITAL', 'Variación de evidencia del ajuste de capital', 'CONTROL', adjustmentEvidenceVariance),
    concept('RECONCILIATIONS', 'VARIACION_CONCILIACION_EXPOSICION_ECONOMICA', 'Variación de exposición económica', 'CONTROL', exposureVariance),
    concept('RECONCILIATIONS', 'VARIACION_CONCILIACION_PAGOS_RECIBIDOS', 'Variación de pagos recibidos', 'CONTROL', paymentVariance),
    concept('RECONCILIATIONS', 'VARIACION_CONCILIACION_GANANCIA', 'Variación de ganancia económica', 'CONTROL', gainVariance),
  ];
  const blockingIssues = [...(input.profitability.integrity.status === 'COMPLETE' ? [] : input.profitability.integrity.warnings),
    ...(cashVariance !== 0n ? ['La caja final independiente no concilia con el movimiento del período.'] : []),
    ...(contractualVariance !== 0n ? ['La cartera contractual final no concilia con sus flujos formales.'] : []),
    ...(capitalVariance !== 0n ? ['El capital económico final no concilia con originación, recuperación y ajustes legítimos.'] : []),
    ...(adjustmentEvidenceVariance !== 0n ? ['Los ajustes de capital económico no están explicados por reversos formales.'] : []),
    ...(exposureVariance !== 0n ? ['La exposición económica ACTIVE/UNCOLLECTIBLE no concilia con el capital económico final.'] : []),
    ...(paymentVariance !== 0n ? ['Los pagos netos de clientes no concilian con capital económico y ganancia realizados.'] : []),
    ...(gainVariance !== 0n ? ['La ganancia económica no concilia con interés regular y rendimiento capitalizado recuperado.'] : [])];
  const sectionOrder: FinancialCloseSection[] = ['LIQUIDITY', 'CONTRACTUAL_PORTFOLIO', 'ECONOMIC_CAPITAL', 'REFINANCINGS', 'PROFITABILITY', 'RECONCILIATIONS'];
  return { modelVersion: FINANCIAL_CLOSE_MODEL_VERSION, period: input.period, fromDate, toDate,
    integrity: { status: blockingIssues.length ? 'INCONSISTENT' : 'COMPLETE', blockingIssues: [...new Set(blockingIssues)], warnings: input.profitability.integrity.warnings },
    sections: sectionOrder.map((code) => ({ code, concepts: concepts.filter((item) => item.section === code) })) };
}
