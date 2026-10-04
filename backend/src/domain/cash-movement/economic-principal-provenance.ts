import type { EconomicCapitalEvent } from './economic-capital';

const MONEY = /^(?:0|[1-9]\d{0,35})(?:\.\d{1,2})?$/;

export type EconomicLoanFact = {
  loanId: string; loanNumber?: string; customerId: string; customerName?: string; startDate: string; principal: string; interestAmount: string;
  totalAmount: string; status: string; cancelledDate: string | null; annulledDate: string | null;
  disbursementId: string | null; disbursementAmount: string | null; disbursementDate: string | null;
  disbursementMethodId: string | null; cashId: string | null; cashAmount: string | null;
  cashDate: string | null; cashMethodId: string | null; cashDirection: string | null; cashConcept: string | null;
  reversalId: string | null; reversalAmount: string | null; reversalDate: string | null;
  reversalMethodId: string | null; reversalDirection: string | null; reversalConcept: string | null;
};

export type EconomicRefinancingFact = {
  refinancingId: string; originLoanId: string; newLoanId: string; refinancingDate: string; createdAt: string;
  outstandingPrincipalTransferred: string; capitalizedOutstandingInterest: string;
  newMoneyDisbursed: string; newContractualPrincipal: string;
};

export type EconomicPaymentFact = {
  paymentId: string; loanId: string; date: string; createdAt: string; amount: string;
  principalApplied: string; interestApplied: string; status: 'VALID' | 'ANNULLED'; methodId: string;
  cashId: string | null; cashAmount: string | null; cashDate: string | null; cashMethodId: string | null;
  cashDirection: string | null; cashConcept: string | null; annulmentId: string | null;
  reversalId: string | null; reversalAmount: string | null; reversalDate: string | null;
  reversalCreatedAt: string | null; reversalMethodId: string | null;
  reversalDirection: string | null; reversalConcept: string | null;
};

export type EconomicProvenanceFacts = {
  loans: EconomicLoanFact[];
  refinancings: EconomicRefinancingFact[];
  payments: EconomicPaymentFact[];
};

export type EconomicPaymentAttribution = {
  paymentId: string; loanId: string; date: string; paymentAmount: string; principalAppliedContractual: string;
  economicPrincipalRecovered: string; capitalizedYieldRecovered: string; interestApplied: string;
  regularInterestRealized: string;
  capitalizedYieldRecoveries: Array<{ refinancingId: string; amount: string }>;
};

export type EconomicGainEvent = EconomicPaymentAttribution & {
  eventType: 'PAYMENT' | 'REVERSAL';
  economicGainContribution: string;
};

export type EconomicChainAnalysis = {
  rootLoanId: string; terminalLoanId: string; loanIds: string[]; refinancingIds: string[]; rootRealDisbursement: string | null;
  totalNewMoneyDisbursed: string; totalRealCashDisbursed: string | null;
  economicPrincipalRecovered: string; economicPrincipalPending: string;
  capitalizedYieldCreated: string; capitalizedYieldRecovered: string; capitalizedYieldPending: string;
  regularInterestRealized: string; totalPaymentsReceived: string;
  economicGain: string | null; realizedCashDifference: string | null;
  isComplete: boolean; integrityStatus: 'COMPLETE' | 'INCONSISTENT'; warnings: string[];
  payments: EconomicPaymentAttribution[];
  capitalizedYieldBuckets: Array<{ refinancingId: string; createdAt: string; pending: string }>;
};

export type EconomicProvenanceResult = {
  chains: EconomicChainAnalysis[];
  events: EconomicCapitalEvent[];
  gainEvents: EconomicGainEvent[];
  warnings: string[];
};

type Bucket = { kind: 'ECONOMIC' | 'CAPITALIZED_YIELD'; sourceId: string; createdAt: string; order: number; amount: bigint };
type Slice = Omit<Bucket, 'amount'> & { amount: bigint };

export const MAX_ECONOMIC_PROVENANCE_LOANS = 100_000;
export const MAX_ECONOMIC_PROVENANCE_REFINANCINGS = 2_048;
export const MAX_ECONOMIC_PROVENANCE_PAYMENTS = 500_000;

const cents = (value: string): bigint | null => {
  if (typeof value !== 'string' || !MONEY.test(value)) return null;
  const [whole, decimal = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
};
const money = (value: bigint): string => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100n}.${((value < 0n ? -value : value) % 100n).toString().padStart(2, '0')}`;
const total = (buckets: Bucket[], kind?: Bucket['kind']) => buckets.reduce((sum, bucket) => sum + (!kind || bucket.kind === kind ? bucket.amount : 0n), 0n);

function consume(buckets: Bucket[], requested: bigint): Slice[] | null {
  if (requested < 0n || total(buckets) < requested) return null;
  let remaining = requested;
  const slices: Slice[] = [];
  for (const kind of ['ECONOMIC', 'CAPITALIZED_YIELD'] as const) {
    for (const bucket of buckets.filter((item) => item.kind === kind).sort((a, b) => a.order - b.order)) {
      if (!remaining) break;
      const amount = bucket.amount < remaining ? bucket.amount : remaining;
      if (amount) slices.push({ kind: bucket.kind, sourceId: bucket.sourceId, createdAt: bucket.createdAt, order: bucket.order, amount });
      bucket.amount -= amount;
      remaining -= amount;
    }
  }
  return remaining === 0n ? slices : null;
}

function restore(buckets: Bucket[], slices: Slice[]) {
  for (const slice of slices) {
    const bucket = buckets.find((item) => item.kind === slice.kind && item.sourceId === slice.sourceId && item.order === slice.order);
    if (bucket) bucket.amount += slice.amount;
    else buckets.push({ ...slice });
  }
  buckets.sort((left, right) => left.order - right.order);
}

function paymentCashIsValid(payment: EconomicPaymentFact): boolean {
  return payment.cashId !== null && payment.cashDirection === 'INFLOW' && payment.cashConcept === 'CUSTOMER_PAYMENT'
    && cents(payment.cashAmount ?? '') === cents(payment.amount) && payment.cashDate === payment.date
    && payment.cashMethodId === payment.methodId;
}

function reversalIsValid(payment: EconomicPaymentFact): boolean {
  return payment.reversalId !== null && payment.reversalDirection === 'OUTFLOW' && payment.reversalConcept === 'REVERSAL'
    && cents(payment.reversalAmount ?? '') === cents(payment.amount) && payment.reversalMethodId === payment.methodId
    && payment.reversalDate !== null && payment.reversalDate >= payment.date;
}

function addEvent(target: EconomicCapitalEvent[], date: string, disbursement = 0n, recovered = 0n, adjustment = 0n) {
  target.push({ date, realDisbursements: money(disbursement), capitalRecovered: money(recovered), adjustments: money(adjustment) });
}

export function analyzeEconomicPrincipalProvenance(facts: EconomicProvenanceFacts, throughDate: string): EconomicProvenanceResult {
  if (facts.loans.length > MAX_ECONOMIC_PROVENANCE_LOANS || facts.refinancings.length > MAX_ECONOMIC_PROVENANCE_REFINANCINGS
    || facts.payments.length > MAX_ECONOMIC_PROVENANCE_PAYMENTS) {
    return { chains: [], events: [], gainEvents: [], warnings: ['La reconstrucción económica excede los límites seguros de procesamiento.'] };
  }
  const warnings: string[] = [];
  const capitalEvents: EconomicCapitalEvent[] = [];
  const gainEvents: EconomicGainEvent[] = [];
  const chains: EconomicChainAnalysis[] = [];
  const loans = new Map<string, EconomicLoanFact>();
  for (const loan of facts.loans) {
    if (!loan.loanId || loans.has(loan.loanId)) warnings.push('La procedencia económica contiene préstamos duplicados o sin identificador.');
    else loans.set(loan.loanId, loan);
  }
  const incoming = new Map<string, EconomicRefinancingFact>();
  const outgoing = new Map<string, EconomicRefinancingFact>();
  for (const edge of facts.refinancings) {
    if (!edge.refinancingId || edge.originLoanId === edge.newLoanId || incoming.has(edge.newLoanId) || outgoing.has(edge.originLoanId)
      || !loans.has(edge.originLoanId) || !loans.has(edge.newLoanId)) {
      warnings.push('El grafo de refinanciamientos contiene relaciones faltantes, duplicadas o ramificadas.');
      continue;
    }
    incoming.set(edge.newLoanId, edge);
    outgoing.set(edge.originLoanId, edge);
  }
  const paymentsByLoan = new Map<string, EconomicPaymentFact[]>();
  const paymentIds = new Set<string>();
  for (const payment of facts.payments) {
    if (!payment.paymentId || paymentIds.has(payment.paymentId)) {
      warnings.push('La procedencia económica contiene pagos duplicados o sin identificador.');
      continue;
    }
    paymentIds.add(payment.paymentId);
    if (!loans.has(payment.loanId)) {
      warnings.push(`El pago ${payment.paymentId} referencia un préstamo inexistente en la reconstrucción económica.`);
      continue;
    }
    const list = paymentsByLoan.get(payment.loanId) ?? [];
    list.push(payment);
    paymentsByLoan.set(payment.loanId, list);
  }
  const graphIsComplete = warnings.length === 0;

  for (const root of loans.values()) {
    if (incoming.has(root.loanId)) continue;
    const chainWarnings: string[] = [];
    const localEvents: EconomicCapitalEvent[] = [];
    const localGainEvents: EconomicGainEvent[] = [];
    const buckets: Bucket[] = [];
    const attributions = new Map<string, EconomicPaymentAttribution>();
    const slicesByPayment = new Map<string, Slice[]>();
    let order = 0;
    let current = root;
    let terminalLoanId = root.loanId;
    let rootRealDisbursement: bigint | null = null;
    let totalNewMoney = 0n;
    let recoveredEconomic = 0n;
    let recoveredYield = 0n;
    let createdYield = 0n;
    let regularInterest = 0n;
    let paymentsReceived = 0n;
    const visited = new Set<string>();
    const refinancingIds: string[] = [];
    const fail = (message: string) => { if (!chainWarnings.includes(message)) chainWarnings.push(message); };

    const validateDisbursement = (loan: EconomicLoanFact, expected: bigint, concept: string, expectedDate: string): boolean => {
      if (expected === 0n) {
        if (loan.disbursementId || loan.cashId) fail(`El préstamo ${loan.loanId} registra un desembolso inesperado sin dinero nuevo.`);
        return !loan.disbursementId && !loan.cashId;
      }
      const valid = loan.disbursementId !== null && loan.cashId !== null && cents(loan.disbursementAmount ?? '') === expected
        && cents(loan.cashAmount ?? '') === expected && loan.disbursementDate === loan.cashDate
        && loan.cashDate === expectedDate
        && loan.disbursementMethodId === loan.cashMethodId && loan.cashDirection === 'OUTFLOW' && loan.cashConcept === concept;
      if (!valid) fail(`El desembolso del préstamo ${loan.loanId} no tiene evidencia de Caja confiable.`);
      if (valid && loan.cashDate && loan.cashDate <= throughDate) addEvent(localEvents, loan.cashDate, expected);
      if (loan.reversalId) {
        const reversalValid = valid && loan.reversalConcept === 'REVERSAL' && loan.reversalDirection === 'INFLOW'
          && cents(loan.reversalAmount ?? '') === expected && loan.reversalMethodId === loan.cashMethodId
          && loan.reversalDate !== null && loan.reversalDate >= loan.cashDate!;
        if (!reversalValid) fail(`El reverso de desembolso del préstamo ${loan.loanId} no concilia.`);
        else if (loan.reversalDate! <= throughDate) addEvent(localEvents, loan.reversalDate!, 0n, 0n, -expected);
      }
      if (loan.annulledDate && loan.annulledDate <= throughDate && !loan.reversalId) {
        fail(`El préstamo anulado ${loan.loanId} no tiene reverso de desembolso.`);
      }
      return valid;
    };

    const rootPrincipal = cents(root.principal);
    const rootInterest = cents(root.interestAmount);
    const rootTotal = cents(root.totalAmount);
    if (rootPrincipal === null || rootInterest === null || rootTotal === null || rootPrincipal + rootInterest !== rootTotal) {
      fail(`El préstamo raíz ${root.loanId} tiene importes contractuales inválidos.`);
    } else if (validateDisbursement(root, rootPrincipal, 'LOAN_DISBURSEMENT', root.startDate)) {
      rootRealDisbursement = rootPrincipal;
      buckets.push({ kind: 'ECONOMIC', sourceId: root.loanId, createdAt: root.startDate, order: order++, amount: rootPrincipal });
    }

    while (!visited.has(current.loanId)) {
      visited.add(current.loanId);
      terminalLoanId = current.loanId;
      const transition = outgoing.get(current.loanId);
      const boundary = transition?.refinancingDate ?? throughDate;
      const principal = cents(current.principal);
      const interest = cents(current.interestAmount);
      const contractualTotal = cents(current.totalAmount);
      if (principal === null || interest === null || contractualTotal === null || principal + interest !== contractualTotal) {
        fail(`El préstamo ${current.loanId} tiene importes contractuales inválidos.`); break;
      }
      let effectivePrincipal = 0n;
      let effectiveInterest = 0n;
      const effectivePayments: string[] = [];
      const timeline: Array<{ date: string; createdAt: string; kind: 'PAYMENT' | 'REVERSAL'; payment: EconomicPaymentFact }> = [];
      for (const payment of (paymentsByLoan.get(current.loanId) ?? []).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.paymentId.localeCompare(b.paymentId))) {
        const amount = cents(payment.amount); const principalApplied = cents(payment.principalApplied); const interestApplied = cents(payment.interestApplied);
        if (amount === null || principalApplied === null || interestApplied === null || amount <= 0n || principalApplied + interestApplied !== amount
          || !paymentCashIsValid(payment) || payment.date < current.startDate || payment.date > boundary
          || (transition && payment.date === transition.refinancingDate && payment.createdAt > transition.createdAt)
          || (incoming.get(current.loanId) && payment.date === incoming.get(current.loanId)!.refinancingDate
            && payment.createdAt < incoming.get(current.loanId)!.createdAt)) {
          fail(`El pago ${payment.paymentId} no concilia con su contrato o movimiento de Caja.`); continue;
        }
        if (payment.status === 'VALID' && payment.reversalId) fail(`El pago válido ${payment.paymentId} tiene un reverso inesperado.`);
        if (payment.status === 'ANNULLED' && (!payment.annulmentId || !reversalIsValid(payment))) {
          fail(`El pago anulado ${payment.paymentId} no tiene un reverso confiable.`);
        }
        if (payment.reversalDate && payment.reversalDate > boundary && transition) {
          fail(`El pago ${payment.paymentId} fue revertido después de transferir su préstamo.`);
        }
        timeline.push({ date: payment.date, createdAt: payment.createdAt, kind: 'PAYMENT', payment });
        if (payment.status === 'ANNULLED' && reversalIsValid(payment) && payment.reversalDate! <= boundary && payment.reversalDate! <= throughDate) {
          timeline.push({ date: payment.reversalDate!, createdAt: payment.reversalCreatedAt ?? payment.createdAt, kind: 'REVERSAL', payment });
        }
      }
      timeline.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)
        || (a.kind === b.kind ? a.payment.paymentId.localeCompare(b.payment.paymentId) : a.kind === 'PAYMENT' ? -1 : 1));
      for (const item of timeline) {
        const payment = item.payment;
        const principalApplied = cents(payment.principalApplied)!;
        const interestApplied = cents(payment.interestApplied)!;
        const amount = cents(payment.amount)!;
        if (item.kind === 'PAYMENT') {
          const slices = consume(buckets, principalApplied);
          if (!slices) { fail(`El principal del pago ${payment.paymentId} excede la composición económica disponible.`); continue; }
          slicesByPayment.set(payment.paymentId, slices);
          effectivePayments.push(payment.paymentId);
          const economic = slices.filter((slice) => slice.kind === 'ECONOMIC').reduce((sum, slice) => sum + slice.amount, 0n);
          const capitalized = principalApplied - economic;
          const capitalizedYieldRecoveries = slices.filter((slice) => slice.kind === 'CAPITALIZED_YIELD')
            .map((slice) => ({ refinancingId: slice.sourceId, amount: money(slice.amount) }));
          recoveredEconomic += economic; recoveredYield += capitalized; regularInterest += interestApplied; paymentsReceived += amount;
          effectivePrincipal += principalApplied; effectiveInterest += interestApplied;
          const attribution = { paymentId: payment.paymentId, loanId: payment.loanId, date: payment.date, paymentAmount: money(amount),
            principalAppliedContractual: money(principalApplied), economicPrincipalRecovered: money(economic),
            capitalizedYieldRecovered: money(capitalized), interestApplied: money(interestApplied), regularInterestRealized: money(interestApplied),
            capitalizedYieldRecoveries };
          attributions.set(payment.paymentId, attribution);
          localGainEvents.push({ ...attribution, eventType: 'PAYMENT', economicGainContribution: money(capitalized + interestApplied) });
          if (item.date <= throughDate) addEvent(localEvents, item.date, 0n, economic);
        } else {
          const slices = slicesByPayment.get(payment.paymentId);
          if (!slices) { fail(`El reverso del pago ${payment.paymentId} no tiene atribución económica previa.`); continue; }
          if (effectivePayments.at(-1) !== payment.paymentId) {
            fail(`El reverso del pago ${payment.paymentId} no respeta el orden contractual de anulaciones.`); continue;
          }
          const economic = slices.filter((slice) => slice.kind === 'ECONOMIC').reduce((sum, slice) => sum + slice.amount, 0n);
          const capitalized = principalApplied - economic;
          const capitalizedYieldRecoveries = slices.filter((slice) => slice.kind === 'CAPITALIZED_YIELD')
            .map((slice) => ({ refinancingId: slice.sourceId, amount: money(-slice.amount) }));
          restore(buckets, slices);
          recoveredEconomic -= economic; recoveredYield -= capitalized; regularInterest -= interestApplied; paymentsReceived -= amount;
          effectivePrincipal -= principalApplied; effectiveInterest -= interestApplied;
          attributions.delete(payment.paymentId);
          effectivePayments.pop();
          localGainEvents.push({ paymentId: payment.paymentId, loanId: payment.loanId, date: item.date,
            paymentAmount: money(-amount), principalAppliedContractual: money(-principalApplied),
            economicPrincipalRecovered: money(-economic), capitalizedYieldRecovered: money(-capitalized),
            interestApplied: money(-interestApplied), regularInterestRealized: money(-interestApplied),
            capitalizedYieldRecoveries, eventType: 'REVERSAL', economicGainContribution: money(-capitalized - interestApplied) });
          addEvent(localEvents, item.date, 0n, 0n, economic);
        }
      }
      let reversedOwnDisbursement = 0n;
      if (current.reversalId && current.reversalDate! <= boundary && current.reversalDate! <= throughDate) {
        const sourceId = incoming.get(current.loanId)?.refinancingId ?? current.loanId;
        const ownDisbursement = incoming.get(current.loanId)
          ? cents(incoming.get(current.loanId)!.newMoneyDisbursed) ?? 0n : principal;
        const ownBucket = buckets.find((bucket) => bucket.kind === 'ECONOMIC' && bucket.sourceId === sourceId);
        if (!ownBucket || ownBucket.amount < ownDisbursement) fail(`El reverso de desembolso del préstamo ${current.loanId} excede su capital económico pendiente.`);
        else { ownBucket.amount -= ownDisbursement; reversedOwnDisbursement = ownDisbursement; }
      }
      if (total(buckets) + reversedOwnDisbursement !== principal - effectivePrincipal || effectiveInterest > interest) {
        fail(`La composición pendiente del préstamo ${current.loanId} no concilia con sus pagos.`);
      }
      if (!transition) break;
      const transferred = cents(transition.outstandingPrincipalTransferred);
      const capitalized = cents(transition.capitalizedOutstandingInterest);
      const newMoney = cents(transition.newMoneyDisbursed);
      const newPrincipal = cents(transition.newContractualPrincipal);
      const successor = loans.get(transition.newLoanId);
      if (transferred === null || capitalized === null || newMoney === null || newPrincipal === null || !successor
        || current.customerId !== successor?.customerId || transition.refinancingDate < current.startDate
        || transferred + capitalized + newMoney !== newPrincipal || total(buckets) !== transferred
        || interest - effectiveInterest !== capitalized || cents(successor.principal) !== newPrincipal) {
        fail(`El refinanciamiento ${transition.refinancingId} no concilia con los buckets pendientes del origen.`); break;
      }
      if (current.status !== 'REFINANCED') fail(`El préstamo origen ${current.loanId} no está marcado como refinanciado.`);
      refinancingIds.push(transition.refinancingId);
      if (capitalized) {
        buckets.push({ kind: 'CAPITALIZED_YIELD', sourceId: transition.refinancingId,
          createdAt: transition.refinancingDate, order: order++, amount: capitalized });
        createdYield += capitalized;
      }
      if (successor.startDate !== transition.refinancingDate) {
        fail(`El préstamo sucesor ${successor.loanId} no inicia en la fecha del refinanciamiento.`);
      }
      if (newMoney && validateDisbursement(successor, newMoney, 'REFINANCING_NEW_MONEY_DISBURSEMENT', transition.refinancingDate)) {
        const bucket = { kind: 'ECONOMIC' as const, sourceId: transition.refinancingId,
          createdAt: transition.refinancingDate, order: order++, amount: newMoney };
        buckets.push(bucket);
        totalNewMoney += newMoney;
      } else if (!newMoney) validateDisbursement(successor, 0n, 'REFINANCING_NEW_MONEY_DISBURSEMENT', transition.refinancingDate);
      current = successor;
    }
    if (visited.has(outgoing.get(current.loanId)?.newLoanId ?? '')) fail(`La cadena con raíz ${root.loanId} contiene un ciclo.`);
    const economicPending = total(buckets, 'ECONOMIC');
    const yieldPending = total(buckets, 'CAPITALIZED_YIELD');
    const cashDisbursed = rootRealDisbursement === null ? null : rootRealDisbursement + totalNewMoney;
    const terminalSettled = current.cancelledDate !== null && current.cancelledDate <= throughDate
      && economicPending === 0n && yieldPending === 0n;
    const economicGain = terminalSettled ? recoveredYield + regularInterest : null;
    const cashDifference = terminalSettled && cashDisbursed !== null ? paymentsReceived - cashDisbursed : null;
    if (graphIsComplete && chainWarnings.length === 0 && rootRealDisbursement !== null && terminalSettled && economicGain !== cashDifference) {
      fail(`La cadena terminada ${root.loanId} no concilia ganancia económica contra flujos de efectivo.`);
    }
    const isComplete = graphIsComplete && chainWarnings.length === 0 && rootRealDisbursement !== null;
    if (isComplete) { capitalEvents.push(...localEvents); gainEvents.push(...localGainEvents); }
    else {
      capitalEvents.push(...localEvents.filter((event) => event.realDisbursements !== '0.00' || event.adjustments.startsWith('-')));
      warnings.push(...chainWarnings);
    }
    chains.push({ rootLoanId: root.loanId, terminalLoanId, loanIds: [...visited], refinancingIds,
      rootRealDisbursement: rootRealDisbursement === null ? null : money(rootRealDisbursement),
      totalNewMoneyDisbursed: money(totalNewMoney), totalRealCashDisbursed: cashDisbursed === null ? null : money(cashDisbursed),
      economicPrincipalRecovered: money(recoveredEconomic), economicPrincipalPending: money(economicPending),
      capitalizedYieldCreated: money(createdYield), capitalizedYieldRecovered: money(recoveredYield), capitalizedYieldPending: money(yieldPending),
      regularInterestRealized: money(regularInterest), totalPaymentsReceived: money(paymentsReceived),
      economicGain: economicGain === null ? null : money(economicGain), realizedCashDifference: cashDifference === null ? null : money(cashDifference),
      isComplete, integrityStatus: isComplete ? 'COMPLETE' : 'INCONSISTENT', warnings: chainWarnings,
      payments: [...attributions.values()].sort((a, b) => a.date.localeCompare(b.date) || a.paymentId.localeCompare(b.paymentId)),
      capitalizedYieldBuckets: buckets.filter((bucket) => bucket.kind === 'CAPITALIZED_YIELD' && bucket.amount > 0n)
        .sort((a, b) => a.order - b.order).map((bucket) => ({ refinancingId: bucket.sourceId, createdAt: bucket.createdAt, pending: money(bucket.amount) })) });
  }
  const covered = new Set<string>();
  for (const chain of chains) {
    let current = chain.rootLoanId;
    while (current && !covered.has(current)) { covered.add(current); current = outgoing.get(current)?.newLoanId ?? ''; }
  }
  if (covered.size !== loans.size) warnings.push('Existen préstamos cuya cadena económica no pudo reconstruirse de forma autoritativa.');
  return { chains, events: capitalEvents, gainEvents, warnings: [...new Set(warnings)] };
}
