import { MonthlyProfitabilityUseCase, type EconomicProfitabilitySnapshot } from '../src/application/cash-movement/monthly-profitability.use-case';
import { calculateEconomicCapital, type EconomicCapitalEvent } from '../src/domain/cash-movement/economic-capital';
import { calculateMonthlyProfitability } from '../src/domain/cash-movement/monthly-profitability';
import type { EconomicChainAnalysis, EconomicGainEvent, EconomicLoanFact,
  EconomicProvenanceResult } from '../src/domain/cash-movement/economic-principal-provenance';

const loan = (loanId: string, status = 'ACTIVE', customerId = `customer-${loanId}`): EconomicLoanFact => ({
  loanId, loanNumber: loanId.replace(/\D/g, '') || loanId, customerId, customerName: `Customer ${loanId}`,
  startDate: '2026-01-01', principal: '100.00', interestAmount: '20.00', totalAmount: '120.00', status,
  cancelledDate: status === 'CANCELLED' ? '2026-09-30' : null, annulledDate: null,
  disbursementId: `d-${loanId}`, disbursementAmount: '100.00', disbursementDate: '2026-01-01',
  disbursementMethodId: 'cash', cashId: `c-${loanId}`, cashAmount: '100.00', cashDate: '2026-01-01',
  cashMethodId: 'cash', cashDirection: 'OUTFLOW', cashConcept: 'LOAN_DISBURSEMENT', reversalId: null,
  reversalAmount: null, reversalDate: null, reversalMethodId: null, reversalDirection: null, reversalConcept: null,
});

const gain = (paymentId: string, loanId: string, date: string, interestApplied: string,
  capitalizedYieldRecovered = '0.00', eventType: 'PAYMENT' | 'REVERSAL' = 'PAYMENT'): EconomicGainEvent => ({
  paymentId, loanId, date, eventType, paymentAmount: eventType === 'PAYMENT' ? '10.00' : '-10.00',
  principalAppliedContractual: '0.00', economicPrincipalRecovered: '0.00', capitalizedYieldRecovered,
  interestApplied, regularInterestRealized: interestApplied, capitalizedYieldRecoveries: [],
  economicGainContribution: `${Number(interestApplied) + Number(capitalizedYieldRecovered)}.00`,
});

const chain = (status: string, pending = '0.00', rootLoanId = 'A', terminalLoanId = 'B'): EconomicChainAnalysis => ({
  rootLoanId, terminalLoanId, loanIds: [rootLoanId, terminalLoanId], refinancingIds: [`${rootLoanId}-${terminalLoanId}`], rootRealDisbursement: '100.00',
  totalNewMoneyDisbursed: '52.00', totalRealCashDisbursed: '152.00', economicPrincipalRecovered: '152.00',
  economicPrincipalPending: '0.00', capitalizedYieldCreated: '20.00', capitalizedYieldRecovered: '20.00',
  capitalizedYieldPending: pending, regularInterestRealized: '20.00', totalPaymentsReceived: '192.00',
  economicGain: status === 'CANCELLED' ? '40.00' : null, realizedCashDifference: status === 'CANCELLED' ? '40.00' : null,
  isComplete: true, integrityStatus: 'COMPLETE', warnings: [], payments: [], capitalizedYieldBuckets: [],
});

const provenance = (gainEvents: EconomicGainEvent[], chains: EconomicChainAnalysis[] = [], warnings: string[] = []): EconomicProvenanceResult =>
  ({ gainEvents, chains, events: [], warnings });

const capital = (period: string, initial = '100.00', events: EconomicCapitalEvent[] = [], warnings: string[] = []) =>
  calculateEconomicCapital(period, { opening: { date: '2024-01-01', initialPortfolio: initial }, events, warnings }, '2027-01-01');

describe('monthly integral profitability', () => {
  it('calculates normal gain from realized interest without requiring a cancelled loan', () => {
    const result = calculateMonthlyProfitability('2026-09', capital('2026-09'),
      provenance([gain('p1', 'N1', '2026-09-15', '10.00')]), [loan('N1')]);
    expect(result.gain).toEqual({ total: '10.00', normal: '10.00', refinancings: '0.00',
      refinancingRegularInterest: '0.00', recoveredCapitalizedYield: '0.00' });
    expect(result.normal[0]).toMatchObject({ loanId: 'N1', status: 'ACTIVE', realizedInterestInPeriod: '10.00',
      paymentCountContributing: 1 });
  });

  it('separates regular and capitalized gain for an active refinancing chain', () => {
    const result = calculateMonthlyProfitability('2026-09', capital('2026-09'),
      provenance([gain('p1', 'B', '2026-09-15', '3.00', '2.00')], [chain('ACTIVE', '18.00')]),
      [loan('A', 'REFINANCED', 'customer-chain'), loan('B', 'ACTIVE', 'customer-chain')]);
    expect(result.gain).toMatchObject({ total: '5.00', normal: '0.00', refinancings: '5.00',
      refinancingRegularInterest: '3.00', recoveredCapitalizedYield: '2.00' });
    expect(result.refinancings[0]).toMatchObject({ chainStatus: 'ACTIVE', economicGainInPeriod: '5.00',
      capitalizedYieldPendingAtEnd: '18.00' });
  });

  it('reports cancelled chains but recognizes only gain events inside the requested month', () => {
    const events = [gain('sep', 'B', '2026-09-30', '20.00', '20.00'), gain('oct', 'B', '2026-10-01', '5.00', '0.00')];
    const result = calculateMonthlyProfitability('2026-09', capital('2026-09'), provenance(events, [chain('CANCELLED')]),
      [loan('A', 'REFINANCED', 'customer-chain'), loan('B', 'CANCELLED', 'customer-chain')]);
    expect(result.gain.total).toBe('40.00');
    expect(result.refinancings[0]).toMatchObject({ chainStatus: 'CANCELLED', economicGainInPeriod: '40.00' });
  });

  it('does not recognize capitalized yield when it is created but still pending', () => {
    const result = calculateMonthlyProfitability('2026-09', capital('2026-09'), provenance([], [chain('ACTIVE', '20.00')]),
      [loan('A', 'REFINANCED'), loan('B')]);
    expect(result.gain).toMatchObject({ total: '0.00', refinancings: '0.00', recoveredCapitalizedYield: '0.00' });
  });

  it('does not count principal-only payments as gain contributors', () => {
    const result = calculateMonthlyProfitability('2026-09', capital('2026-09'),
      provenance([gain('principal-only', 'N1', '2026-09-15', '0.00')]), [loan('N1')]);
    expect(result.gain.total).toBe('0.00');
    expect(result.normal).toEqual([]);
    expect(result.payments).toEqual([]);
  });

  it('does not double count a mixed normal and refinancing month', () => {
    const result = calculateMonthlyProfitability('2026-09', capital('2026-09'), provenance([
      gain('normal', 'N1', '2026-09-10', '5.00'), gain('chain', 'B', '2026-09-20', '3.00', '2.00'),
    ], [chain('ACTIVE', '18.00')]), [loan('N1'), loan('A', 'REFINANCED', 'chain'), loan('B', 'ACTIVE', 'chain')]);
    expect(result.gain.total).toBe('10.00');
    expect(Number(result.gain.normal) + Number(result.gain.refinancings)).toBe(Number(result.gain.total));
    expect(Number(result.gain.refinancingRegularInterest) + Number(result.gain.recoveredCapitalizedYield))
      .toBe(Number(result.gain.refinancings));
    expect(result.payments).toHaveLength(2);
  });

  it('uses signed reversal events so an annulled payment contributes exactly zero in the month', () => {
    const result = calculateMonthlyProfitability('2026-09', capital('2026-09'), provenance([
      gain('p1', 'N1', '2026-09-10', '10.00'), gain('p1', 'N1', '2026-09-20', '-10.00', '0.00', 'REVERSAL'),
    ]), [loan('N1')]);
    expect(result.gain.total).toBe('0.00');
    expect(result.payments.map((item) => item.eventType)).toEqual(['PAYMENT', 'REVERSAL']);
  });

  it('keeps high capital rotation independent from monetary gain', () => {
    const result = calculateMonthlyProfitability('2026-09', capital('2026-09', '0.00', [
      { date: '2026-09-01', realDisbursements: '100.00', capitalRecovered: '0.00', adjustments: '0.00' },
      { date: '2026-09-10', realDisbursements: '0.00', capitalRecovered: '100.00', adjustments: '0.00' },
      { date: '2026-09-11', realDisbursements: '100.00', capitalRecovered: '0.00', adjustments: '0.00' },
    ]), provenance([]), []);
    expect(result.gain.total).toBe('0.00');
    expect(result.indicators.capitalRotation).toBe('2.0690');
    expect(result.indicators.periodProfitability).toBe('0.0000');
  });

  it('supports gain with low rotation and returns null only for a zero denominator', () => {
    const low = calculateMonthlyProfitability('2026-09', capital('2026-09'),
      provenance([gain('p1', 'N1', '2026-09-01', '10.00')]), [loan('N1')]);
    expect(low.indicators).toMatchObject({ periodProfitability: '0.1000', equivalentThirtyDayRate: '0.1000', capitalRotation: '0.0000' });
    const zero = calculateMonthlyProfitability('2026-09', capital('2026-09', '0.00'), provenance([]), []);
    expect(zero.indicators).toEqual({ periodProfitability: null, equivalentThirtyDayRate: null, capitalRotation: null });
  });

  it('uses capital-days for a 31-day month and normalizes it simply to 30 days', () => {
    const result = calculateMonthlyProfitability('2026-01', capital('2026-01'),
      provenance([gain('p1', 'N1', '2026-01-15', '31.00')]), [loan('N1')]);
    expect(result.capital).toMatchObject({ capitalDays: '3100.00', averageWorkingCapital: '100.00' });
    expect(result.indicators).toMatchObject({ periodProfitability: '0.3100', equivalentThirtyDayRate: '0.3000' });
  });

  it.each([['2026-02', 28, '28.00'], ['2024-02', 29, '29.00'], ['2026-04', 30, '30.00']] as const)
  ('normalizes %s with %i calendar days against 30 days', (period, days, interest) => {
    const result = calculateMonthlyProfitability(period, capital(period),
      provenance([gain('p1', 'N1', `${period}-15`, interest)]), [loan('N1')]);
    expect(result.calendarDays).toBe(days);
    expect(result.indicators.equivalentThirtyDayRate).toBe('0.3000');
  });

  it('nulls denominator-based indicators when economic integrity is inconsistent', () => {
    const result = calculateMonthlyProfitability('2026-09', capital('2026-09', '100.00', [], ['legacy chain incomplete']),
      provenance([]), []);
    expect(result.integrity).toMatchObject({ status: 'INCONSISTENT', warnings: ['legacy chain incomplete'] });
    expect(result.indicators).toEqual({ periodProfitability: null, equivalentThirtyDayRate: null, capitalRotation: null });
  });

  it('does not publish denominator-based rates for a provisional month', () => {
    const provisional = calculateEconomicCapital('2026-09', {
      opening: { date: '2024-01-01', initialPortfolio: '100.00' }, events: [], warnings: [],
    }, '2026-09-15');
    const result = calculateMonthlyProfitability('2026-09', provisional,
      provenance([gain('p1', 'N1', '2026-09-10', '10.00')]), [loan('N1')]);
    expect(result.integrity.status).toBe('WARNING');
    expect(result.indicators).toEqual({ periodProfitability: null, equivalentThirtyDayRate: null, capitalRotation: null });
  });

  it('provides loan, chain and payment zoom traces', () => {
    const result = calculateMonthlyProfitability('2026-09', capital('2026-09'), provenance([
      gain('n1', 'N1', '2026-09-05', '4.00'), gain('r1', 'B', '2026-09-06', '3.00', '2.00'),
    ], [chain('ACTIVE', '18.00')]), [loan('N1'), loan('A', 'REFINANCED', 'chain'), loan('B', 'ACTIVE', 'chain')]);
    expect(result.normal[0]).toMatchObject({ loanId: 'N1', customerId: 'customer-N1', paymentCountContributing: 1 });
    expect(result.refinancings[0]).toMatchObject({ rootLoanId: 'A', terminalLoanId: 'B', paymentCountContributing: 1 });
    expect(result.payments[1]).toMatchObject({ paymentId: 'r1', source: 'REFINANCING', rootLoanId: 'A',
      economicGainContribution: '5.00' });
  });
});

describe('monthly profitability pagination', () => {
  it('paginates zooms server-side without embedding them in the summary', async () => {
    const loans = Array.from({ length: 21 }, (_, index) => loan(`N${index + 1}`));
    const gainEvents = loans.map((item, index) => gain(`p${index}`, item.loanId, '2026-09-15', '1.00'));
    const snapshot: EconomicProfitabilitySnapshot = { capitalFacts: { opening: { date: '2024-01-01', initialPortfolio: '100.00' },
      events: [], warnings: [] }, provenance: provenance(gainEvents), loans };
    const reader = { readProfitabilityThrough: jest.fn(async () => snapshot) };
    const useCase = new MonthlyProfitabilityUseCase(reader);
    await expect(useCase.normal('2026-09', { page: 2, pageSize: 10 })).resolves.toMatchObject({ total: 21, page: 2, pageSize: 10, totalPages: 3,
      summary: { realizedInterest: '21.00' },
      items: expect.arrayContaining([expect.objectContaining({ loanId: expect.any(String) })]) });
    const summary = await useCase.summary('2026-09');
    expect(summary).not.toHaveProperty('normal');
    expect(summary).not.toHaveProperty('payments');
  });

  it('filters normal-loan status before count and pagination without changing payment-date attribution', async () => {
    const loans = Array.from({ length: 23 }, (_, index) => loan(`N${index + 1}`, index < 11 ? 'CANCELLED' : index < 22 ? 'ACTIVE' : 'UNCOLLECTIBLE'));
    const gainEvents = loans.flatMap((item, index) => [
      gain(`outside-${index}`, item.loanId, '2026-08-31', '9.00'),
      gain(`inside-${index}`, item.loanId, '2026-09-15', '1.00'),
    ]);
    const snapshot: EconomicProfitabilitySnapshot = { capitalFacts: { opening: { date: '2024-01-01', initialPortfolio: '100.00' },
      events: [], warnings: [] }, provenance: provenance(gainEvents), loans };
    const useCase = new MonthlyProfitabilityUseCase({ readProfitabilityThrough: jest.fn(async () => snapshot) });

    const all = await useCase.normal('2026-09', { page: 1, pageSize: 10 });
    expect(all).toMatchObject({ total: 23, totalPages: 3, summary: { realizedInterest: '23.00' } });
    expect(all.summary.realizedInterest).toBe((await useCase.summary('2026-09')).gain.normal);
    const cancelled = await useCase.normal('2026-09', { page: 2, pageSize: 10 }, { status: 'CANCELLED' });
    expect(cancelled).toMatchObject({ total: 11, totalPages: 2, page: 2, pageSize: 10,
      summary: { realizedInterest: '11.00' } });
    expect(cancelled.items).toHaveLength(1);
    expect(cancelled.items[0]).toMatchObject({ status: 'CANCELLED', realizedInterestInPeriod: '1.00' });
    const active = await useCase.normal('2026-09', { page: 1, pageSize: 10 }, { status: 'ACTIVE' });
    expect(active).toMatchObject({ total: 11, totalPages: 2, summary: { realizedInterest: '11.00' } });
    expect(active.items).toHaveLength(10);
    expect(active.items.every((item) => item.status === 'ACTIVE')).toBe(true);
    const cancelledFirstPage = await useCase.normal('2026-09', { page: 1, pageSize: 10 }, { status: 'CANCELLED' });
    expect(cancelledFirstPage.summary).toEqual(cancelled.summary);
    const cancelledLargerPage = await useCase.normal('2026-09', { page: 1, pageSize: 50 }, { status: 'CANCELLED' });
    expect(cancelledLargerPage.summary).toEqual(cancelled.summary);
  });

  it('filters refinancing terminal status before count and keeps active chains with realized gain', async () => {
    const chains = [chain('CANCELLED', '0.00', 'A1', 'B1'), chain('ACTIVE', '18.00', 'A2', 'B2')];
    const loans = [loan('A1', 'REFINANCED', 'customer-1'), loan('B1', 'CANCELLED', 'customer-1'),
      loan('A2', 'REFINANCED', 'customer-2'), loan('B2', 'ACTIVE', 'customer-2')];
    const gainEvents = [gain('cancelled-payment', 'B1', '2026-09-10', '3.00', '2.00'),
      gain('active-payment', 'B2', '2026-09-11', '4.00', '1.00')];
    const snapshot: EconomicProfitabilitySnapshot = { capitalFacts: { opening: { date: '2024-01-01', initialPortfolio: '100.00' },
      events: [], warnings: [] }, provenance: provenance(gainEvents, chains), loans };
    const useCase = new MonthlyProfitabilityUseCase({ readProfitabilityThrough: jest.fn(async () => snapshot) });

    const all = await useCase.refinancings('2026-09', { page: 1, pageSize: 10 });
    expect(all).toMatchObject({ total: 2, totalPages: 1, summary: { regularInterestRealized: '7.00',
      capitalizedYieldRecovered: '3.00', economicGain: '10.00' } });
    expect(all.summary.economicGain).toBe((await useCase.summary('2026-09')).gain.refinancings);
    const cancelled = await useCase.refinancings('2026-09', { page: 1, pageSize: 10 }, { terminalStatus: 'CANCELLED' });
    expect(cancelled.summary).toEqual({ regularInterestRealized: '3.00', capitalizedYieldRecovered: '2.00', economicGain: '5.00' });
    expect(cancelled.items).toEqual([expect.objectContaining({ rootLoanId: 'A1', chainStatus: 'CANCELLED', economicGainInPeriod: '5.00' })]);
    const active = await useCase.refinancings('2026-09', { page: 1, pageSize: 10 }, { terminalStatus: 'ACTIVE' });
    expect(active).toMatchObject({ total: 1, totalPages: 1,
      summary: { regularInterestRealized: '4.00', capitalizedYieldRecovered: '1.00', economicGain: '5.00' } });
    expect(active.items).toEqual([expect.objectContaining({ rootLoanId: 'A2', chainStatus: 'ACTIVE', economicGainInPeriod: '5.00' })]);
  });
});
