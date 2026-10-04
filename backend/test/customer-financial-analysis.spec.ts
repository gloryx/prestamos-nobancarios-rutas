import { CustomerFinancialAnalysisUseCase } from '../src/application/customer/customer-financial-analysis.use-case';
import { calculateCustomerFinancialAnalysis } from '../src/domain/customer/customer-financial-analysis';
import { CustomerNotFoundError, CustomerValidationError } from '../src/domain/customer/customer.errors';
import { analyzeEconomicPrincipalProvenance, type EconomicLoanFact, type EconomicPaymentFact,
  type EconomicProvenanceFacts, type EconomicRefinancingFact } from '../src/domain/cash-movement/economic-principal-provenance';
import { CustomerFinancialAnalysisTypeOrmReader } from '../src/infrastructure/database/typeorm/repositories/customer-financial-analysis.reader';

const loan = (loanId: string, principal: string, interest: string, status: string, date: string,
  disbursement: string | null, concept: string | null, overrides: Partial<EconomicLoanFact> = {}): EconomicLoanFact => ({
  loanId, loanNumber: loanId, customerId: 'customer-1', customerName: 'Ana Perez', startDate: date, principal,
  interestAmount: interest, totalAmount: `${Number(principal) + Number(interest)}.00`, status,
  cancelledDate: status === 'CANCELLED' ? '2026-09-30' : null, annulledDate: status === 'ANNULLED' ? '2026-09-08' : null,
  disbursementId: disbursement ? `d-${loanId}` : null, disbursementAmount: disbursement,
  disbursementDate: disbursement ? date : null, disbursementMethodId: disbursement ? 'cash' : null,
  cashId: disbursement ? `cash-${loanId}` : null, cashAmount: disbursement, cashDate: disbursement ? date : null,
  cashMethodId: disbursement ? 'cash' : null, cashDirection: disbursement ? 'OUTFLOW' : null, cashConcept: concept,
  reversalId: null, reversalAmount: null, reversalDate: null, reversalMethodId: null,
  reversalDirection: null, reversalConcept: null, ...overrides,
});
const payment = (paymentId: string, loanId: string, date: string, principal: string, interest = '0.00',
  overrides: Partial<EconomicPaymentFact> = {}): EconomicPaymentFact => {
  const amount = `${Number(principal) + Number(interest)}.00`;
  return { paymentId, loanId, date, createdAt: `${date}T12:00:00.000Z`, amount, principalApplied: principal,
    interestApplied: interest, status: 'VALID', methodId: 'cash', cashId: `cash-${paymentId}`, cashAmount: amount,
    cashDate: date, cashMethodId: 'cash', cashDirection: 'INFLOW', cashConcept: 'CUSTOMER_PAYMENT', annulmentId: null,
    reversalId: null, reversalAmount: null, reversalDate: null, reversalCreatedAt: null, reversalMethodId: null,
    reversalDirection: null, reversalConcept: null, ...overrides };
};
const refinancing = (id: string, origin: string, successor: string, date: string, transferred: string,
  capitalized: string, newMoney: string, principal: string): EconomicRefinancingFact => ({ refinancingId: id,
  originLoanId: origin, newLoanId: successor, refinancingDate: date, createdAt: `${date}T12:00:00.000Z`,
  outstandingPrincipalTransferred: transferred, capitalizedOutstandingInterest: capitalized,
  newMoneyDisbursed: newMoney, newContractualPrincipal: principal });
const mandatoryFacts = (): EconomicProvenanceFacts => ({
  loans: [
    loan('A', '100000.00', '20000.00', 'REFINANCED', '2026-09-01', '100000.00', 'LOAN_DISBURSEMENT'),
    loan('B', '100000.00', '20000.00', 'CANCELLED', '2026-09-10', '52000.00', 'REFINANCING_NEW_MONEY_DISBURSEMENT'),
  ],
  refinancings: [refinancing('A-B', 'A', 'B', '2026-09-10', '28000.00', '20000.00', '52000.00', '100000.00')],
  payments: [payment('p-A', 'A', '2026-09-05', '72000.00'), payment('p-B', 'B', '2026-09-20', '100000.00', '20000.00')],
});
const calculate = (facts: EconomicProvenanceFacts, asOf = '2026-09-30') =>
  calculateCustomerFinancialAnalysis(asOf, analyzeEconomicPrincipalProvenance(facts, asOf), facts.loans);

describe('customer financial analysis', () => {
  it('reconciles cash, realized gain, exposure and historical capital-days without double counting refinancing principal', () => {
    const result = calculate(mandatoryFacts());
    expect(result.cashFlow).toEqual({ realCashDisbursed: '152000.00', paymentsReceived: '192000.00' });
    expect(result.economicCapital).toEqual({ recovered: '152000.00', pending: '0.00',
      capitalDays: '1340000.00', averageWorkingCapital: '44666.67' });
    expect(result.capitalizedYield).toEqual({ created: '20000.00', recovered: '20000.00', pending: '0.00' });
    expect(result.realizedGain).toEqual({ regularInterest: '20000.00', recoveredCapitalizedYield: '20000.00', total: '40000.00' });
    expect(result.contractualExposure).toEqual({ outstandingPrincipal: '0.00', outstandingInterest: '0.00', total: '0.00' });
    expect(result.profitability).toEqual({ cumulativeReturnRate: '0.2632' });
    expect(result.indicators).toEqual({ historicalProfitability: '0.8955', equivalentThirtyDayRate: '0.8955', capitalRotation: '3.4030' });
    expect(result.history).toMatchObject({ firstEconomicDeploymentDate: '2026-09-01', calendarDays: 30,
      loanCount: 2, chainCount: 1, loansByStatus: { REFINANCED: 1, CANCELLED: 1 } });
    expect(result.integrity).toEqual({ status: 'COMPLETE', warnings: [] });
  });

  it('recognizes regular and recovered capitalized gain on an active chain and keeps both exposure layers separate', () => {
    const facts = mandatoryFacts();
    facts.loans[1].status = 'ACTIVE'; facts.loans[1].cancelledDate = null;
    facts.payments[1] = payment('p-B', 'B', '2026-09-20', '90000.00', '5000.00');
    const result = calculate(facts);
    expect(result.realizedGain).toEqual({ regularInterest: '5000.00', recoveredCapitalizedYield: '10000.00', total: '15000.00' });
    expect(result.economicCapital.pending).toBe('0.00');
    expect(result.capitalizedYield.pending).toBe('10000.00');
    expect(result.contractualExposure).toEqual({ outstandingPrincipal: '10000.00', outstandingInterest: '15000.00', total: '25000.00' });
  });

  it('includes uncollectible terminal debt in exposure because status does not recover capital', () => {
    const facts: EconomicProvenanceFacts = { loans: [loan('U', '100.00', '20.00', 'UNCOLLECTIBLE', '2026-09-01', '100.00', 'LOAN_DISBURSEMENT')],
      refinancings: [], payments: [payment('p', 'U', '2026-09-05', '25.00', '5.00')] };
    const result = calculate(facts);
    expect(result.economicCapital.pending).toBe('75.00');
    expect(result.contractualExposure).toEqual({ outstandingPrincipal: '75.00', outstandingInterest: '15.00', total: '90.00' });
    expect(result.history.loansByStatus).toEqual({ UNCOLLECTIBLE: 1 });
  });

  it('keeps valid annulled loans in history but excludes them from valid exposure', () => {
    const annulled = loan('X', '100.00', '20.00', 'ANNULLED', '2026-09-01', '100.00', 'LOAN_DISBURSEMENT', {
      reversalId: 'r-X', reversalAmount: '100.00', reversalDate: '2026-09-08', reversalMethodId: 'cash',
      reversalDirection: 'INFLOW', reversalConcept: 'REVERSAL',
    });
    const result = calculate({ loans: [annulled], refinancings: [], payments: [] });
    expect(result.history.loansByStatus).toEqual({ ANNULLED: 1 });
    expect(result.economicCapital.pending).toBe('0.00');
    expect(result.contractualExposure.total).toBe('0.00');
    expect(result.integrity.status).toBe('WITH_WARNINGS');
  });

  it('nets an annulled payment and its reversal on their actual dates', () => {
    const annulledPayment = payment('p1', 'N', '2026-09-05', '40.00', '10.00', { status: 'ANNULLED',
      annulmentId: 'a1', reversalId: 'r1', reversalAmount: '50.00', reversalDate: '2026-09-08',
      reversalCreatedAt: '2026-09-08T12:00:00.000Z', reversalMethodId: 'cash', reversalDirection: 'OUTFLOW', reversalConcept: 'REVERSAL' });
    const facts = { loans: [loan('N', '100.00', '20.00', 'ACTIVE', '2026-09-01', '100.00', 'LOAN_DISBURSEMENT')],
      refinancings: [], payments: [annulledPayment] };
    const result = calculate(facts);
    expect(result.cashFlow.paymentsReceived).toBe('0.00');
    expect(result.realizedGain.total).toBe('0.00');
    expect(result.economicCapital).toMatchObject({ recovered: '0.00', pending: '100.00', capitalDays: '2880.00' });
  });

  it('returns not available rather than fabricated ratios for a customer without loans', () => {
    const result = calculate({ loans: [], refinancings: [], payments: [] });
    expect(result.integrity.status).toBe('NOT_AVAILABLE');
    expect(result.history).toMatchObject({ firstEconomicDeploymentDate: null, calendarDays: 0, loanCount: 0, chainCount: 0 });
    expect(result.indicators).toEqual({ historicalProfitability: null, equivalentThirtyDayRate: null, capitalRotation: null });
    expect(result.profitability.cumulativeReturnRate).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('publishes raw inconsistencies without clamping and nulls all denominator-based ratios', () => {
    const facts = mandatoryFacts(); facts.loans[0].cashId = null;
    const result = calculate(facts);
    expect(result.integrity.status).toBe('INCONSISTENT');
    expect(result.cashFlow.realCashDisbursed).toBeNull();
    expect(result.indicators).toEqual({ historicalProfitability: null, equivalentThirtyDayRate: null, capitalRotation: null });
    expect(result.profitability.cumulativeReturnRate).toBeNull();
  });

  it('marks a cancelled loan with residual balances inconsistent instead of publishing ratios', () => {
    const facts: EconomicProvenanceFacts = { loans: [loan('C', '100.00', '20.00', 'CANCELLED', '2026-09-01', '100.00', 'LOAN_DISBURSEMENT')],
      refinancings: [], payments: [] };
    const result = calculate(facts);
    expect(result.contractualExposure.total).toBe('120.00');
    expect(result.integrity).toMatchObject({ status: 'INCONSISTENT', warnings: [expect.stringContaining('saldos pendientes')] });
    expect(result.indicators).toEqual({ historicalProfitability: null, equivalentThirtyDayRate: null, capitalRotation: null });
    expect(result.profitability.cumulativeReturnRate).toBeNull();
  });

  it('returns null financial aggregates when reconstruction is unavailable instead of fabricated zeros', () => {
    const fact = loan('N', '100.00', '20.00', 'ACTIVE', '2026-09-01', '100.00', 'LOAN_DISBURSEMENT');
    const result = calculateCustomerFinancialAnalysis('2026-09-30', { chains: [], events: [], gainEvents: [],
      warnings: ['La reconstrucción económica excede los límites seguros de procesamiento.'] }, [fact]);
    expect(result.integrity.status).toBe('INCONSISTENT');
    expect(result.cashFlow).toEqual({ realCashDisbursed: null, paymentsReceived: null });
    expect(result.realizedGain.total).toBeNull();
    expect(result.contractualExposure.total).toBeNull();
  });
});

describe('customer financial analysis application and reader', () => {
  const customer = { id: 'customer-1', identification: '123', fullName: 'Ana Perez' };

  it('defaults the cutoff to Costa Rica today and composes the authoritative provenance engine', async () => {
    const reader = { read: jest.fn(async () => ({ customer, facts: mandatoryFacts() })) };
    const useCase = new CustomerFinancialAnalysisUseCase(reader, () => '2026-09-30');
    const result = await useCase.execute('customer-1');
    expect(reader.read).toHaveBeenCalledWith('customer-1', '2026-09-30');
    expect(result).toMatchObject({ customer, asOf: '2026-09-30', realizedGain: { total: '40000.00' } });
  });

  it.each(['2026-9-01', '2026-02-30', '2026-13-01', '2026-99-99'])('rejects invalid cutoff %s before reading', async (asOf) => {
    const reader = { read: jest.fn() };
    await expect(new CustomerFinancialAnalysisUseCase(reader, () => '2026-09-30').execute('customer-1', asOf))
      .rejects.toBeInstanceOf(CustomerValidationError);
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('rejects future cutoffs and missing customers', async () => {
    const futureReader = { read: jest.fn() };
    await expect(new CustomerFinancialAnalysisUseCase(futureReader, () => '2026-09-30').execute('customer-1', '2026-10-01'))
      .rejects.toBeInstanceOf(CustomerValidationError);
    const missing = { read: jest.fn(async () => ({ customer: null, facts: { loans: [], refinancings: [], payments: [] } })) };
    await expect(new CustomerFinancialAnalysisUseCase(missing, () => '2026-09-30').execute('missing'))
      .rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('loads one customer snapshot in repeatable read with four bounded customer-scoped queries', async () => {
    const query = jest.fn().mockResolvedValueOnce([customer]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const transaction = jest.fn(async (_isolation, work) => work({ query }));
    const result = await new CustomerFinancialAnalysisTypeOrmReader({ transaction } as never).read('customer-1', '2026-09-30');
    expect(transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    expect(query).toHaveBeenCalledTimes(4);
    for (const call of query.mock.calls.slice(1)) {
      expect(call[0]).toMatch(/customer_id/);
      expect(call[1]).toEqual(expect.arrayContaining(['customer-1', '2026-09-30']));
    }
    expect(query.mock.calls[1][0]).toContain("COALESCE(snapshot.status,'ACTIVE')");
    expect(query.mock.calls[1][0]).toContain('reversal.movement_date <= $2::date');
    expect(query.mock.calls[3][0]).toContain('annulment.annulled_at');
    expect(result).toEqual({ customer, facts: { loans: [], refinancings: [], payments: [] } });
  });

  it('stops after the customer lookup when the customer does not exist', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const transaction = jest.fn(async (_isolation, work) => work({ query }));
    await expect(new CustomerFinancialAnalysisTypeOrmReader({ transaction } as never).read('missing', '2026-09-30'))
      .resolves.toEqual({ customer: null, facts: { loans: [], refinancings: [], payments: [] } });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
