import { analyzeEconomicPrincipalProvenance, type EconomicLoanFact, type EconomicPaymentFact,
  type EconomicProvenanceFacts, type EconomicRefinancingFact } from '../src/domain/cash-movement/economic-principal-provenance';
import { calculateEconomicCapital } from '../src/domain/cash-movement/economic-capital';

const loan = (loanId: string, principal: string, interestAmount: string, status: string,
  concept: string | null, disbursementAmount: string | null, date: string,
  overrides: Partial<EconomicLoanFact> = {}): EconomicLoanFact => ({
  loanId, customerId: 'customer-1', startDate: date, principal, interestAmount,
  totalAmount: `${Number(principal) + Number(interestAmount)}.00`, status,
  cancelledDate: status === 'CANCELLED' ? '2026-09-30' : null, annulledDate: null,
  disbursementId: disbursementAmount ? `disbursement-${loanId}` : null,
  disbursementAmount, disbursementDate: disbursementAmount ? date : null,
  disbursementMethodId: disbursementAmount ? 'cash' : null,
  cashId: disbursementAmount ? `cash-${loanId}` : null, cashAmount: disbursementAmount,
  cashDate: disbursementAmount ? date : null, cashMethodId: disbursementAmount ? 'cash' : null,
  cashDirection: disbursementAmount ? 'OUTFLOW' : null, cashConcept: concept,
  reversalId: null, reversalAmount: null, reversalDate: null, reversalMethodId: null,
  reversalDirection: null, reversalConcept: null, ...overrides,
});

const payment = (paymentId: string, loanId: string, date: string, principalApplied: string,
  interestApplied = '0.00', overrides: Partial<EconomicPaymentFact> = {}): EconomicPaymentFact => {
  const amount = `${Number(principalApplied) + Number(interestApplied)}.00`;
  return { paymentId, loanId, date, createdAt: `${date}T12:00:00.000Z`, amount,
    principalApplied, interestApplied, status: 'VALID', methodId: 'cash', cashId: `cash-${paymentId}`,
    cashAmount: amount, cashDate: date, cashMethodId: 'cash', cashDirection: 'INFLOW', cashConcept: 'CUSTOMER_PAYMENT',
    annulmentId: null, reversalId: null, reversalAmount: null, reversalDate: null, reversalCreatedAt: null,
    reversalMethodId: null, reversalDirection: null, reversalConcept: null, ...overrides };
};

const refinancing = (refinancingId: string, originLoanId: string, newLoanId: string, refinancingDate: string,
  outstandingPrincipalTransferred: string, capitalizedOutstandingInterest: string, newMoneyDisbursed: string,
  newContractualPrincipal: string): EconomicRefinancingFact => ({ refinancingId, originLoanId, newLoanId,
  refinancingDate, outstandingPrincipalTransferred, capitalizedOutstandingInterest, newMoneyDisbursed,
  newContractualPrincipal, createdAt: `${refinancingDate}T12:00:00.000Z` });

const example = (): EconomicProvenanceFacts => ({
  loans: [
    loan('A', '100000.00', '20000.00', 'REFINANCED', 'LOAN_DISBURSEMENT', '100000.00', '2026-09-01'),
    loan('B', '100000.00', '20000.00', 'CANCELLED', 'REFINANCING_NEW_MONEY_DISBURSEMENT', '52000.00', '2026-09-10'),
  ],
  refinancings: [refinancing('A-B', 'A', 'B', '2026-09-10', '28000.00', '20000.00', '52000.00', '100000.00')],
  payments: [payment('payment-A', 'A', '2026-09-05', '72000.00'), payment('payment-B', 'B', '2026-09-20', '100000.00', '20000.00')],
});

describe('economic principal provenance', () => {
  it('reconciles the mandatory 152000 disbursed, 192000 received and 40000 gain example', () => {
    const result = analyzeEconomicPrincipalProvenance(example(), '2026-09-30');
    expect(result.warnings).toEqual([]);
    expect(result.chains[0]).toMatchObject({ rootRealDisbursement: '100000.00', totalNewMoneyDisbursed: '52000.00',
      totalRealCashDisbursed: '152000.00', economicPrincipalRecovered: '152000.00', economicPrincipalPending: '0.00',
      capitalizedYieldCreated: '20000.00', capitalizedYieldRecovered: '20000.00', capitalizedYieldPending: '0.00',
      regularInterestRealized: '20000.00', totalPaymentsReceived: '192000.00', economicGain: '40000.00',
      realizedCashDifference: '40000.00', isComplete: true, integrityStatus: 'COMPLETE' });
    expect(result.chains[0].payments).toEqual([
      expect.objectContaining({ paymentId: 'payment-A', principalAppliedContractual: '72000.00',
        economicPrincipalRecovered: '72000.00', capitalizedYieldRecovered: '0.00', interestApplied: '0.00' }),
      expect.objectContaining({ paymentId: 'payment-B', principalAppliedContractual: '100000.00',
        economicPrincipalRecovered: '80000.00', capitalizedYieldRecovered: '20000.00', interestApplied: '20000.00' }),
    ]);
    expect(result.gainEvents.find((item) => item.paymentId === 'payment-B')).toMatchObject({ paymentAmount: '120000.00',
      capitalizedYieldRecovered: '20000.00', interestApplied: '20000.00', economicGainContribution: '40000.00' });
  });

  it('does not realize capitalized yield while an active successor is still recovering economic capital', () => {
    const facts = example();
    facts.loans[1].status = 'ACTIVE'; facts.loans[1].cancelledDate = null;
    facts.payments[1] = payment('payment-B', 'B', '2026-09-20', '50000.00');
    const chain = analyzeEconomicPrincipalProvenance(facts, '2026-09-30').chains[0];
    expect(chain).toMatchObject({ economicPrincipalRecovered: '122000.00', economicPrincipalPending: '30000.00',
      capitalizedYieldRecovered: '0.00', capitalizedYieldPending: '20000.00', economicGain: null,
      realizedCashDifference: null, isComplete: true });
    expect(chain.payments[1]).toMatchObject({ economicPrincipalRecovered: '50000.00', capitalizedYieldRecovered: '0.00' });
  });

  it('attributes only the amount crossing the economic boundary to capitalized yield', () => {
    const facts = example();
    facts.loans[1].status = 'ACTIVE'; facts.loans[1].cancelledDate = null;
    facts.payments[1] = payment('payment-B', 'B', '2026-09-20', '90000.00');
    const chain = analyzeEconomicPrincipalProvenance(facts, '2026-09-30').chains[0];
    expect(chain.payments[1]).toMatchObject({ principalAppliedContractual: '90000.00',
      economicPrincipalRecovered: '80000.00', capitalizedYieldRecovered: '10000.00' });
    expect(chain).toMatchObject({ economicPrincipalPending: '0.00', capitalizedYieldRecovered: '10000.00',
      capitalizedYieldPending: '10000.00' });
  });

  it('crosses the exact boundary without recognizing capitalized yield', () => {
    const facts = example();
    facts.loans[1].status = 'ACTIVE'; facts.loans[1].cancelledDate = null;
    facts.payments[1] = payment('payment-B', 'B', '2026-09-20', '80000.00');
    expect(analyzeEconomicPrincipalProvenance(facts, '2026-09-30').chains[0].payments[1]).toMatchObject({
      economicPrincipalRecovered: '80000.00', capitalizedYieldRecovered: '0.00',
    });
  });

  it('carries old yield once through A to B to C and consumes yield FIFO after all economic capital', () => {
    const facts: EconomicProvenanceFacts = {
      loans: [
        loan('A', '100.00', '20.00', 'REFINANCED', 'LOAN_DISBURSEMENT', '100.00', '2026-09-01'),
        loan('B', '110.00', '10.00', 'REFINANCED', 'REFINANCING_NEW_MONEY_DISBURSEMENT', '50.00', '2026-09-10'),
        loan('C', '80.00', '0.00', 'ACTIVE', 'REFINANCING_NEW_MONEY_DISBURSEMENT', '30.00', '2026-09-20'),
      ],
      refinancings: [
        refinancing('A-B', 'A', 'B', '2026-09-10', '40.00', '20.00', '50.00', '110.00'),
        refinancing('B-C', 'B', 'C', '2026-09-20', '40.00', '10.00', '30.00', '80.00'),
      ],
      payments: [payment('p-A', 'A', '2026-09-05', '60.00'), payment('p-B', 'B', '2026-09-15', '70.00'),
        payment('p-C', 'C', '2026-09-25', '60.00')],
    };
    const chain = analyzeEconomicPrincipalProvenance(facts, '2026-09-30').chains[0];
    expect(chain).toMatchObject({ totalRealCashDisbursed: '180.00', economicPrincipalRecovered: '180.00',
      economicPrincipalPending: '0.00', capitalizedYieldCreated: '30.00', capitalizedYieldRecovered: '10.00',
      capitalizedYieldPending: '20.00', isComplete: true });
    expect(chain.payments[2]).toMatchObject({ economicPrincipalRecovered: '50.00', capitalizedYieldRecovered: '10.00' });
    expect(chain.payments[2].capitalizedYieldRecoveries).toEqual([{ refinancingId: 'A-B', amount: '10.00' }]);
    expect(chain.capitalizedYieldBuckets).toEqual([
      { refinancingId: 'A-B', createdAt: '2026-09-10', pending: '10.00' },
      { refinancingId: 'B-C', createdAt: '2026-09-20', pending: '10.00' },
    ]);
  });

  it.each([
    ['zero new money', '0.00', '20000.00', '48000.00'],
    ['zero capitalization', '52000.00', '0.00', '80000.00'],
  ])('supports %s without inventing a bucket', (_, newMoney, capitalized, successorPrincipal) => {
    const facts = example();
    facts.loans[0].interestAmount = capitalized; facts.loans[0].totalAmount = `${100000 + Number(capitalized)}.00`;
    facts.loans[1] = loan('B', successorPrincipal, '0.00', 'ACTIVE', newMoney === '0.00' ? null : 'REFINANCING_NEW_MONEY_DISBURSEMENT',
      newMoney === '0.00' ? null : newMoney, '2026-09-10');
    facts.refinancings[0] = refinancing('A-B', 'A', 'B', '2026-09-10', '28000.00', capitalized, newMoney, successorPrincipal);
    facts.payments = [facts.payments[0]];
    const chain = analyzeEconomicPrincipalProvenance(facts, '2026-09-30').chains[0];
    expect(chain).toMatchObject({ totalNewMoneyDisbursed: newMoney, capitalizedYieldCreated: capitalized, isComplete: true });
  });

  it('reverses the exact economic slices of an annulled payment', () => {
    const facts: EconomicProvenanceFacts = { loans: [loan('A', '100.00', '0.00', 'ACTIVE', 'LOAN_DISBURSEMENT', '100.00', '2026-09-01')],
      refinancings: [], payments: [payment('p1', 'A', '2026-09-05', '40.00', '0.00', { status: 'ANNULLED',
        annulmentId: 'annulment-1', reversalId: 'reversal-1', reversalAmount: '40.00', reversalDate: '2026-09-08',
        reversalCreatedAt: '2026-09-08T12:00:00.000Z', reversalMethodId: 'cash', reversalDirection: 'OUTFLOW', reversalConcept: 'REVERSAL' })] };
    const result = analyzeEconomicPrincipalProvenance(facts, '2026-09-30');
    expect(result.chains[0]).toMatchObject({ economicPrincipalRecovered: '0.00', economicPrincipalPending: '100.00',
      totalPaymentsReceived: '0.00', payments: [], isComplete: true });
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-09-05', capitalRecovered: '40.00' }),
      expect.objectContaining({ date: '2026-09-08', adjustments: '40.00' }),
    ]));
    expect(result.gainEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ paymentId: 'p1', eventType: 'PAYMENT', economicGainContribution: '0.00' }),
      expect.objectContaining({ paymentId: 'p1', eventType: 'REVERSAL', economicGainContribution: '0.00' }),
    ]));
  });

  it('dates chain gain when the payment realizes it rather than when refinancing was created', () => {
    const facts = example();
    facts.loans[1].cancelledDate = '2026-10-20';
    facts.payments[1] = payment('payment-B', 'B', '2026-10-20', '100000.00', '20000.00');
    const septemberFacts = { ...facts, payments: [facts.payments[0]] };
    const september = analyzeEconomicPrincipalProvenance(septemberFacts, '2026-09-30');
    const october = analyzeEconomicPrincipalProvenance(facts, '2026-10-31');
    expect(september.gainEvents.filter((item) => item.date.startsWith('2026-09'))
      .reduce((sum, item) => sum + Number(item.economicGainContribution), 0)).toBe(0);
    expect(october.gainEvents.filter((item) => item.date.startsWith('2026-10'))).toEqual([
      expect.objectContaining({ paymentId: 'payment-B', economicGainContribution: '40000.00' }),
    ]);
  });

  it('removes a valid annulled-loan disbursement without a false principal mismatch', () => {
    const root = loan('A', '100.00', '0.00', 'ANNULLED', 'LOAN_DISBURSEMENT', '100.00', '2026-09-01', {
      annulledDate: '2026-09-08', reversalId: 'reversal-disbursement', reversalAmount: '100.00',
      reversalDate: '2026-09-08', reversalMethodId: 'cash', reversalDirection: 'INFLOW', reversalConcept: 'REVERSAL',
    });
    const result = analyzeEconomicPrincipalProvenance({ loans: [root], refinancings: [], payments: [] }, '2026-09-30');
    expect(result.warnings).toEqual([]);
    expect(result.chains[0]).toMatchObject({ economicPrincipalPending: '0.00', isComplete: true });
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-09-01', realDisbursements: '100.00' }),
      expect.objectContaining({ date: '2026-09-08', adjustments: '-100.00' }),
    ]));
  });

  it('rejects successor recovery before the refinancing creates its principal', () => {
    const facts = example();
    facts.payments[1] = payment('payment-B', 'B', '2026-09-09', '10.00');
    const chain = analyzeEconomicPrincipalProvenance(facts, '2026-09-30').chains[0];
    expect(chain.isComplete).toBe(false);
    expect(chain.warnings.join(' ')).toContain('no concilia con su contrato');
  });

  it('rejects a non-LIFO payment reversal instead of preserving invalid yield attribution', () => {
    const annulled = payment('p1', 'A', '2026-09-05', '40.00', '0.00', { status: 'ANNULLED', annulmentId: 'a1',
      reversalId: 'r1', reversalAmount: '40.00', reversalDate: '2026-09-08',
      reversalCreatedAt: '2026-09-08T12:00:00.000Z', reversalMethodId: 'cash', reversalDirection: 'OUTFLOW', reversalConcept: 'REVERSAL' });
    const facts: EconomicProvenanceFacts = {
      loans: [loan('A', '100.00', '0.00', 'ACTIVE', 'LOAN_DISBURSEMENT', '100.00', '2026-09-01')],
      refinancings: [], payments: [annulled, payment('p2', 'A', '2026-09-06', '10.00')],
    };
    const chain = analyzeEconomicPrincipalProvenance(facts, '2026-09-30').chains[0];
    expect(chain.isComplete).toBe(false);
    expect(chain.warnings.join(' ')).toContain('orden contractual de anulaciones');
  });

  it('marks incomplete authoritative evidence instead of guessing legacy provenance', () => {
    const facts = example(); facts.loans[0].cashId = null;
    const result = analyzeEconomicPrincipalProvenance(facts, '2026-09-30');
    expect(result.chains[0]).toMatchObject({ isComplete: false, integrityStatus: 'INCONSISTENT' });
    expect(result.warnings.join(' ')).toContain('evidencia de Caja confiable');
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('never silently clamps an over-consumed contractual principal', () => {
    const facts: EconomicProvenanceFacts = { loans: [loan('A', '100.00', '0.00', 'ACTIVE', 'LOAN_DISBURSEMENT', '100.00', '2026-09-01')],
      refinancings: [], payments: [payment('p1', 'A', '2026-09-05', '101.00')] };
    const chain = analyzeEconomicPrincipalProvenance(facts, '2026-09-30').chains[0];
    expect(chain).toMatchObject({ isComplete: false, economicPrincipalPending: '100.00' });
    expect(chain.warnings.join(' ')).toContain('excede');
  });

  it('feeds capital rotation with economic recovery instead of all contractual principal', () => {
    const provenance = analyzeEconomicPrincipalProvenance(example(), '2026-09-30');
    const result = calculateEconomicCapital('2026-09', {
      opening: { date: '2026-01-01', initialPortfolio: '0.00' }, events: provenance.events, warnings: provenance.warnings,
    }, '2026-10-01');
    expect(result).toMatchObject({ realCapitalDisbursed: '152000.00', recoveredCapital: '152000.00',
      closingEconomicBalance: '0.00', dataStatus: 'COMPLETE' });
    expect(provenance.chains[0].payments.reduce((sum, item) => sum + Number(item.principalAppliedContractual), 0)).toBe(172000);
  });

  it('reconstructs a later month opening from all economic events since the financial opening', () => {
    const facts: EconomicProvenanceFacts = {
      loans: [loan('A', '100.00', '0.00', 'ACTIVE', 'LOAN_DISBURSEMENT', '100.00', '2026-02-01')],
      refinancings: [], payments: [payment('p1', 'A', '2026-03-01', '30.00')],
    };
    const provenance = analyzeEconomicPrincipalProvenance(facts, '2026-09-30');
    const result = calculateEconomicCapital('2026-09', {
      opening: { date: '2026-01-01', initialPortfolio: '50.00' }, events: provenance.events, warnings: provenance.warnings,
    }, '2026-10-01');
    expect(result).toMatchObject({ openingEconomicBalance: '120.00', closingEconomicBalance: '120.00',
      realCapitalDisbursed: '0.00', recoveredCapital: '0.00', dataStatus: 'COMPLETE' });
  });
});
