import { cents, evaluateLoanFinancialIntegrity } from '../../domain/loan/loan-financial-integrity';
import { money } from '../../domain/loan-refinancing/refinancing-finance';
import type { RefinancingChain, RefinancingChainGraph, RefinancingChainLoan,
  RefinancingChainLoanRow, RefinancingChainTransition, RefinancingChainTransitionRow } from './refinancing.port';

export const MAX_REFINANCING_GRAPH_EDGES = 2048;
const MAX_REFINANCING_CHAIN_NODES = 128;
const AMOUNT = /^\d+(?:\.\d{1,2})?$/;

export class RefinancingChainIntegrityError extends Error {}

const corrupt = (message: string): never => { throw new RefinancingChainIntegrityError(message); };
const numeric = (value: string): bigint => {
  if (typeof value !== 'string' || !AMOUNT.test(value)) return corrupt('Refinancing chain money is invalid.');
  return cents(value);
};

function validatedLoan(row: RefinancingChainLoanRow): Omit<RefinancingChainLoan, 'isRoot' | 'isTerminal'> {
  if (!row.loanId || !row.customerId || !row.loanNumber || !row.startDate || !row.status ||
    !Number.isSafeInteger(row.invalidCount) || row.invalidCount !== 0) {
    return corrupt('Refinancing chain loan is invalid.');
  }
  for (const value of [row.principal, row.interestAmount, row.totalAmount, row.paidAmount,
    row.paidPrincipal, row.paidInterest, row.pendingPlanAmount]) numeric(value);
  const result = evaluateLoanFinancialIntegrity(row, row, cents(row.pendingPlanAmount));
  if (!result.valid) return corrupt('Refinancing chain loan does not reconcile.');
  return { loanId: row.loanId, loanNumber: row.loanNumber, status: row.status, startDate: row.startDate,
    principal: money(numeric(row.principal)), interestAmount: money(numeric(row.interestAmount)),
    totalAmount: money(numeric(row.totalAmount)), paidAmount: money(result.validPaidAmount),
    paidPrincipal: money(result.validPrincipalApplied), paidInterest: money(result.validInterestApplied),
    outstandingPrincipal: money(result.outstandingPrincipal), outstandingInterest: money(result.outstandingInterest),
    financialBalance: money(result.financialBalance) };
}

function validatedTransition(row: RefinancingChainTransitionRow, customerId: string): RefinancingChainTransition {
  if (!row.refinancingId || !row.originLoanId || !row.newLoanId || !row.refinancingDate ||
    row.originLoanId === row.newLoanId || row.originCustomerId !== customerId || row.newCustomerId !== customerId) {
    return corrupt('Refinancing chain customer or relationship is invalid.');
  }
  const principal = numeric(row.outstandingPrincipalTransferred);
  const capitalized = numeric(row.capitalizedOutstandingInterest);
  const newMoney = numeric(row.newMoneyDisbursed);
  const newInterest = numeric(row.newInterestAmount);
  const contractualPrincipal = numeric(row.newContractualPrincipal);
  const total = numeric(row.newContractualTotal);
  if (contractualPrincipal <= 0n || principal + capitalized + newMoney !== contractualPrincipal ||
    contractualPrincipal + newInterest !== total) return corrupt('Refinancing chain transition does not reconcile.');
  return { refinancingId: row.refinancingId, refinancingDate: row.refinancingDate,
    originLoanId: row.originLoanId, newLoanId: row.newLoanId,
    outstandingPrincipalTransferred: money(principal), capitalizedOutstandingInterest: money(capitalized),
    newMoneyDisbursed: money(newMoney), newContractualPrincipal: money(contractualPrincipal),
    newInterestAmount: money(newInterest), newContractualTotal: money(total) };
}

export function buildRefinancingChains(graph: RefinancingChainGraph): RefinancingChain[] {
  if (graph.transitions.length > MAX_REFINANCING_GRAPH_EDGES) return corrupt('Refinancing graph exceeds the safe limit.');
  if (!graph.customer?.id || !graph.customer.fullName || !graph.customer.identification) {
    return corrupt('Refinancing chain customer is unavailable.');
  }
  if (!graph.transitions.length) {
    if (graph.loans.length) return corrupt('Refinancing graph contains unrelated loans.');
    return [];
  }
  const loanRows = new Map<string, RefinancingChainLoanRow>();
  const loans = new Map<string, Omit<RefinancingChainLoan, 'isRoot' | 'isTerminal'>>();
  for (const row of graph.loans) {
    if (row.customerId !== graph.customer.id || loanRows.has(row.loanId)) return corrupt('Refinancing chain loans have different customers or duplicate IDs.');
    loanRows.set(row.loanId, row);
    loans.set(row.loanId, validatedLoan(row));
  }
  const outgoing = new Map<string, RefinancingChainTransition>();
  const incoming = new Map<string, string>();
  const refinancingIds = new Set<string>();
  for (const row of graph.transitions) {
    const transition = validatedTransition(row, graph.customer.id);
    if (!loans.has(transition.originLoanId) || !loans.has(transition.newLoanId) ||
      outgoing.has(transition.originLoanId) || incoming.has(transition.newLoanId) ||
      refinancingIds.has(transition.refinancingId)) {
      return corrupt('Refinancing chain contains a missing loan, branch or duplicate predecessor.');
    }
    if (loans.get(transition.originLoanId)!.status !== 'REFINANCED' ||
      numeric(loans.get(transition.newLoanId)!.principal) !== numeric(transition.newContractualPrincipal)) {
      return corrupt('Refinancing chain loan principal or status is inconsistent.');
    }
    outgoing.set(transition.originLoanId, transition);
    incoming.set(transition.newLoanId, transition.originLoanId);
    refinancingIds.add(transition.refinancingId);
  }
  const roots = [...outgoing.keys()].filter((id) => !incoming.has(id));
  if (!roots.length) return corrupt('Refinancing chain contains a cycle.');
  const covered = new Set<string>();
  const chains: RefinancingChain[] = [];
  for (const rootLoanId of roots) {
    const seen = new Set<string>();
    const chainLoans: RefinancingChainLoan[] = [];
    const transitions: RefinancingChainTransition[] = [];
    let current = rootLoanId;
    for (;;) {
      if (seen.has(current) || covered.has(current)) return corrupt('Refinancing chain contains a cycle or overlapping branch.');
      if (seen.size >= MAX_REFINANCING_CHAIN_NODES) return corrupt('Refinancing chain exceeds the safe node limit.');
      const loan = loans.get(current);
      if (!loan) return corrupt('Refinancing chain references an unavailable loan.');
      seen.add(current); covered.add(current);
      const next = outgoing.get(current);
      chainLoans.push({ ...loan, isRoot: current === rootLoanId, isTerminal: !next });
      if (!next) break;
      transitions.push(next);
      current = next.newLoanId;
    }
    const rootDisbursement = loanRows.get(rootLoanId)!.rootDisbursedAmount;
    const total = (values: string[]) => money(values.reduce((sum, value) => sum + numeric(value), 0n));
    const newMoney = total(transitions.map((item) => item.newMoneyDisbursed));
    const rootAmount = rootDisbursement === null ? null : money(numeric(rootDisbursement));
    chains.push({ rootLoanId, terminalLoanId: current, customer: graph.customer,
      startedAt: chainLoans[0].startDate, lastRefinancingDate: transitions.at(-1)?.refinancingDate ?? null,
      loans: chainLoans, transitions,
      summary: { loanCount: chainLoans.length, refinancingCount: transitions.length,
        totalOutstandingPrincipalTransferred: total(transitions.map((item) => item.outstandingPrincipalTransferred)),
        totalCapitalizedOutstandingInterest: total(transitions.map((item) => item.capitalizedOutstandingInterest)),
        totalNewMoneyDisbursed: newMoney,
        totalNewInterestContracted: total(transitions.map((item) => item.newInterestAmount)),
        totalPaymentsReceived: total(chainLoans.map((item) => item.paidAmount)),
        totalPrincipalApplied: total(chainLoans.map((item) => item.paidPrincipal)),
        totalInterestApplied: total(chainLoans.map((item) => item.paidInterest)),
        rootDisbursedAmount: rootAmount,
        totalCashActuallyDisbursed: rootAmount === null ? null : money(cents(rootAmount) + cents(newMoney)) },
    });
  }
  if (covered.size !== loans.size || chains.reduce((sum, chain) => sum + chain.transitions.length, 0) !== graph.transitions.length) {
    return corrupt('Refinancing graph contains a cycle or disconnected transitions.');
  }
  return chains.sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.rootLoanId.localeCompare(right.rootLoanId));
}
