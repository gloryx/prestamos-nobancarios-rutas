import { calculateEconomicCapital } from '../src/domain/cash-movement/economic-capital';
import { analyzeEconomicPrincipalProvenance, type EconomicLoanFact, type EconomicPaymentFact,
  type EconomicProvenanceFacts, type EconomicRefinancingFact } from '../src/domain/cash-movement/economic-principal-provenance';
import { calculateMonthlyProfitability } from '../src/domain/cash-movement/monthly-profitability';
import { calculateFinancialClose, type FinancialCloseCashFact } from '../src/domain/financial-close/financial-close';
import { FinancialCloseUseCases } from '../src/application/financial-close/financial-close.use-cases';
import type { FinancialCloseSourceSnapshot, FinancialCloseStore } from '../src/application/financial-close/financial-close.store';
import { FinancialCloseConflictError, FinancialCloseIntegrityError, FinancialCloseValidationError } from '../src/domain/financial-close/financial-close.errors';
import { RetroactivePeriodGuard } from '../src/application/financial-close/retroactive-period.guard';

const loan = (loanId: string, principal: string, interest: string, status: string, date: string,
  disbursed: string | null, concept: string | null): EconomicLoanFact => ({ loanId, loanNumber: loanId,
  customerId: 'customer', customerName: 'Customer', startDate: date, principal, interestAmount: interest,
  totalAmount: `${Number(principal) + Number(interest)}.00`, status, cancelledDate: status === 'CANCELLED' ? '2026-03-15' : null,
  annulledDate: null, disbursementId: disbursed ? `d-${loanId}` : null, disbursementAmount: disbursed,
  disbursementDate: disbursed ? date : null, disbursementMethodId: disbursed ? 'cash' : null,
  cashId: disbursed ? `c-${loanId}` : null, cashAmount: disbursed, cashDate: disbursed ? date : null,
  cashMethodId: disbursed ? 'cash' : null, cashDirection: disbursed ? 'OUTFLOW' : null, cashConcept: concept,
  reversalId: null, reversalAmount: null, reversalDate: null, reversalMethodId: null, reversalDirection: null, reversalConcept: null });
const payment = (id: string, loanId: string, date: string, principal: string, interest: string): EconomicPaymentFact => {
  const amount = `${Number(principal) + Number(interest)}.00`;
  return { paymentId: id, loanId, date, createdAt: `${date}T12:00:00Z`, amount, principalApplied: principal,
    interestApplied: interest, status: 'VALID', methodId: 'cash', cashId: `cash-${id}`, cashAmount: amount,
    cashDate: date, cashMethodId: 'cash', cashDirection: 'INFLOW', cashConcept: 'CUSTOMER_PAYMENT', annulmentId: null,
    reversalId: null, reversalAmount: null, reversalDate: null, reversalCreatedAt: null, reversalMethodId: null,
    reversalDirection: null, reversalConcept: null };
};
const refinancing = (id: string, origin: string, successor: string, date: string, transferred: string,
  capitalized: string, newMoney: string, principal: string): EconomicRefinancingFact => ({ refinancingId: id,
  originLoanId: origin, newLoanId: successor, refinancingDate: date, createdAt: `${date}T12:00:00Z`,
  outstandingPrincipalTransferred: transferred, capitalizedOutstandingInterest: capitalized,
  newMoneyDisbursed: newMoney, newContractualPrincipal: principal });
const analyzed = (facts: EconomicProvenanceFacts, throughDate: string) => ({ provenance: analyzeEconomicPrincipalProvenance(facts, throughDate), facts });
const openingFacts: EconomicProvenanceFacts = { loans: [loan('A', '100000.00', '20000.00', 'ACTIVE', '2026-01-01', '100000.00', 'LOAN_DISBURSEMENT')],
  refinancings: [], payments: [payment('P-A', 'A', '2026-01-15', '72000.00', '0.00')] };
const februaryFacts: EconomicProvenanceFacts = { loans: [
  loan('A', '100000.00', '20000.00', 'REFINANCED', '2026-01-01', '100000.00', 'LOAN_DISBURSEMENT'),
  loan('B', '100000.00', '20000.00', 'ACTIVE', '2026-02-10', '52000.00', 'REFINANCING_NEW_MONEY_DISBURSEMENT')],
  refinancings: [refinancing('R-AB', 'A', 'B', '2026-02-10', '28000.00', '20000.00', '52000.00', '100000.00')],
  payments: openingFacts.payments };
const marchFacts: EconomicProvenanceFacts = { loans: [
  loan('A', '100000.00', '20000.00', 'REFINANCED', '2026-01-01', '100000.00', 'LOAN_DISBURSEMENT'),
  loan('B', '100000.00', '20000.00', 'REFINANCED', '2026-02-10', '52000.00', 'REFINANCING_NEW_MONEY_DISBURSEMENT'),
  loan('C', '120000.00', '10000.00', 'UNCOLLECTIBLE', '2026-03-10', null, null)],
  refinancings: [...februaryFacts.refinancings, refinancing('R-BC', 'B', 'C', '2026-03-10', '100000.00', '20000.00', '0.00', '120000.00')],
  payments: openingFacts.payments };
const cashFact = (direction: 'INFLOW' | 'OUTFLOW', concept: string, amount: string, date: string,
  reversedConcept: string | null = null): FinancialCloseCashFact => ({ direction, concept, amount, date, reversedConcept });
const profitability = (period: string, snapshot: ReturnType<typeof analyzed>) => {
  const capital = calculateEconomicCapital(period, { opening: { date: '2026-01-01', initialPortfolio: '0.00' },
    events: snapshot.provenance.events, warnings: snapshot.provenance.warnings }, '2026-05-01');
  return calculateMonthlyProfitability(period, capital, snapshot.provenance, snapshot.facts.loans);
};
const concepts = (result: ReturnType<typeof calculateFinancialClose>) => new Map(result.sections.flatMap((section) => section.concepts).map((item) => [item.code, item.amount]));

describe('financial close V2 economic model', () => {
  it('rejects economic dates inside the latest immutable period', async () => {
    const guard = new RetroactivePeriodGuard({ latestClosedThrough: jest.fn(async () => '2026-01-31') });
    await expect(guard.assertDateAllowed('2026-01-31')).rejects.toThrow('belongs to a closed financial period');
    await expect(guard.assertDateAllowed('2026-02-01')).resolves.toBeUndefined();
  });

  it('uses the financial opening date as the effective start of the first period', () => {
    const result = calculateEconomicCapital('2026-01', { opening: { date: '2026-01-15', initialPortfolio: '100.00' },
      events: [], warnings: [] }, '2026-02-01', '2026-01-15');
    expect(result).toMatchObject({ fromDate: '2026-01-15', toDate: '2026-01-31', calendarDays: 17,
      openingEconomicBalance: '100.00', closingEconomicBalance: '100.00' });
    expect(result.daily).toHaveLength(17);
  });

  it('periodizes the 100k/20k/72k/52k refinancing chain without duplicating origin exposure', () => {
    const opening = analyzed(openingFacts, '2026-01-31'); const final = analyzed(februaryFacts, '2026-02-28');
    const result = calculateFinancialClose({ period: '2026-02', openingDate: '2026-01-01', initialAvailableAmount: '100000.00',
      initialPortfolio: '0.00', initialUncollectibleAmount: '0.00', openingEconomic: opening, finalEconomic: final,
      profitability: profitability('2026-02', final), cashFacts: [cashFact('OUTFLOW', 'REFINANCING_NEW_MONEY_DISBURSEMENT', '52000.00', '2026-02-10')],
      cashBalances: { opening: '72000.00', closing: '20000.00' }, statusTransitions: [] });
    const values = concepts(result);
    expect(result.sections.map((section) => section.code)).toEqual(['LIQUIDITY', 'CONTRACTUAL_PORTFOLIO', 'ECONOMIC_CAPITAL', 'REFINANCINGS', 'PROFITABILITY', 'RECONCILIATIONS']);
    expect(values.size).toBeGreaterThanOrEqual(31);
    expect(values.get('CARTERA_CONTRACTUAL_TOTAL_INICIAL')).toBe('48000.00');
    expect(values.get('CAPITAL_PRINCIPAL_TRANSFERIDO')).toBe('28000.00');
    expect(values.has('CANTIDAD_REFINANCIACIONES')).toBe(false);
    expect(values.get('RENDIMIENTO_CAPITALIZADO_CREADO')).toBe('20000.00');
    expect(values.get('DINERO_NUEVO_DESEMBOLSADO')).toBe('52000.00');
    expect(values.get('CAPITAL_ECONOMICO_ORIGINADO')).toBe('52000.00');
    expect(values.get('CAPITAL_ECONOMICO_FINAL')).toBe('80000.00');
    expect(values.get('RENDIMIENTO_CAPITALIZADO_PENDIENTE')).toBe('20000.00');
    expect(values.get('VARIACION_CONCILIACION_CARTERA_CONTRACTUAL')).toBe('0.00');
    expect(result.integrity).toMatchObject({ status: 'COMPLETE', blockingIssues: [] });
  });

  it('handles A→B→C and an ACTIVE→UNCOLLECTIBLE movement as period stock changes', () => {
    const opening = analyzed(februaryFacts, '2026-02-28'); const final = analyzed(marchFacts, '2026-03-31');
    const result = calculateFinancialClose({ period: '2026-03', openingDate: '2026-01-01', initialAvailableAmount: '100000.00',
      initialPortfolio: '0.00', initialUncollectibleAmount: '0.00', openingEconomic: opening, finalEconomic: final,
      profitability: profitability('2026-03', final), cashFacts: [], cashBalances: { opening: '20000.00', closing: '20000.00' },
      statusTransitions: [{ loanId: 'C', fromStatus: 'ACTIVE', toStatus: 'UNCOLLECTIBLE', date: '2026-03-20' }] });
    const values = concepts(result);
    expect(values.get('CAPITAL_PRINCIPAL_TRANSFERIDO')).toBe('100000.00');
    expect(values.get('RENDIMIENTO_CAPITALIZADO_PENDIENTE')).toBe('40000.00');
    expect(values.get('CARTERA_CONTRACTUAL_ACTIVA_FINAL')).toBe('0.00');
    expect(values.get('CARTERA_CONTRACTUAL_INCOBRABLE_FINAL')).toBe('130000.00');
    expect(values.get('CAPITAL_ECONOMICO_INCOBRABLE_FINAL')).toBe('80000.00');
    expect(values.get('TRASLADO_NETO_CARTERA_INCOBRABLE')).toBe('130000.00');
    expect(result.integrity.status).toBe('COMPLETE');
  });

  it('keeps profitability equal to the existing calculator and reconciles net customer cash identity', () => {
    const paidFacts: EconomicProvenanceFacts = { ...februaryFacts,
      loans: februaryFacts.loans.map((item) => item.loanId === 'B' ? { ...item, status: 'CANCELLED', cancelledDate: '2026-03-15' } : item),
      payments: [...februaryFacts.payments, payment('P-B', 'B', '2026-03-15', '100000.00', '20000.00')] };
    const opening = analyzed(februaryFacts, '2026-02-28'); const final = analyzed(paidFacts, '2026-03-31');
    const monthly = profitability('2026-03', final);
    const result = calculateFinancialClose({ period: '2026-03', openingDate: '2026-01-01', initialAvailableAmount: '100000.00',
      initialPortfolio: '0.00', initialUncollectibleAmount: '0.00', openingEconomic: opening, finalEconomic: final,
      profitability: monthly, cashFacts: [cashFact('INFLOW', 'CUSTOMER_PAYMENT', '120000.00', '2026-03-15'),
        cashFact('OUTFLOW', 'OPERATING_EXPENSE', '10000.00', '2026-03-20'),
        cashFact('INFLOW', 'EXTERNAL_INCOME', '5000.00', '2026-03-21')],
      cashBalances: { opening: '20000.00', closing: '135000.00' }, statusTransitions: [] });
    const values = concepts(result);
    expect(values.get('CAPITAL_ECONOMICO_RECUPERADO')).toBe('80000.00');
    expect(values.get('INTERES_REGULAR_REALIZADO')).toBe('20000.00');
    expect(values.get('RENDIMIENTO_CAPITALIZADO_RECUPERADO')).toBe('20000.00');
    expect(values.get('GANANCIA_ECONOMICA_REALIZADA')).toBe(monthly.gain.total);
    expect(values.get('VARIACION_CONCILIACION_PAGOS_RECIBIDOS')).toBe('0.00');
    expect(values.get('GASTOS_OPERATIVOS_NETOS')).toBe('10000.00');
    expect(values.get('INGRESOS_EXTERNOS_EXCLUIDOS')).toBe('5000.00');
    expect(values.get('RESULTADO_ECONOMICO_MES')).toBe('30000.00');
  });

  it('enforces ended periods, sequence, transactional recalculation and blocking integrity', async () => {
    const opening = analyzed(openingFacts, '2026-01-31'); const final = analyzed(februaryFacts, '2026-02-28');
    const source: FinancialCloseSourceSnapshot = { opening: { openingDate: '2026-01-01', initialAvailableAmount: '100000.00',
      initialPortfolio: '0.00', initialUncollectibleAmount: '0.00' }, effectiveFromDate: '2026-02-01',
      openingEconomic: opening, economicFacts: final.facts, capitalFacts: { opening: { date: '2026-01-01', initialPortfolio: '0.00' },
        events: final.provenance.events, warnings: final.provenance.warnings }, provenance: final.provenance, loans: final.facts.loans,
      cashFacts: [cashFact('OUTFLOW', 'REFINANCING_NEW_MONEY_DISBURSEMENT', '52000.00', '2026-02-10')],
      cashBalances: { opening: '72000.00', closing: '20000.00' }, statusTransitions: [] };
    const insert = jest.fn(async (calculation, sequence) => ({ ...calculation, id: 'close', sequence, confirmedAt: new Date(), confirmedBy: { id: 'actor', fullName: 'Actor' } }));
    const tx = { lock: jest.fn(), nextSequence: jest.fn(async () => ({ sequence: 2, expectedPeriod: '2026-02' })),
      source: jest.fn(async () => source), insert };
    const store = { previewSource: jest.fn(async () => source), nextSequence: jest.fn(async () => ({ sequence: 2, expectedPeriod: '2026-02' })),
      confirm: jest.fn(async (work) => work(tx)), list: jest.fn(), findById: jest.fn() } as unknown as FinancialCloseStore;
    const useCases = new FinancialCloseUseCases(store, () => '2026-04-01');
    await expect(useCases.preview('2026-04')).rejects.toThrow(FinancialCloseValidationError);
    await expect(useCases.preview('2026-01')).rejects.toThrow(FinancialCloseConflictError);
    await expect(useCases.confirm('2026-02', 'actor')).resolves.toMatchObject({ sequence: 2, modelVersion: 2 });
    expect(tx.lock).toHaveBeenCalled(); expect(tx.source).toHaveBeenCalledWith('2026-02-01', '2026-02-28');
    const broken = structuredClone(source); broken.cashBalances.closing = '20001.00';
    (tx.source as jest.Mock).mockResolvedValueOnce(broken);
    await expect(useCases.confirm('2026-02', 'actor')).rejects.toThrow(FinancialCloseIntegrityError);
  });
});
