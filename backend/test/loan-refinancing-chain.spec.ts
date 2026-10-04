import { LoanRefinancingUseCase, RefinancingConflictError, RefinancingNotFoundError, RefinancingValidationError } from '../src/application/loan-refinancing/refinancing.use-case';
import { buildRefinancingChains } from '../src/application/loan-refinancing/refinancing-chain';
import type { RefinancingChainGraph, RefinancingChainLoanRow, RefinancingChainTransitionRow, RefinancingStore } from '../src/application/loan-refinancing/refinancing.port';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const customer = { id: uuid(90), fullName: 'TEST REFINANCING CUSTOMER', identification: 'TEST-101' };
const loan = (n: number, overrides: Partial<RefinancingChainLoanRow> = {}): RefinancingChainLoanRow => ({
  loanId: uuid(n), loanNumber: String(n), customerId: customer.id, status: n === 1 ? 'REFINANCED' : 'CANCELLED',
  startDate: n === 1 ? '2026-09-01' : '2026-09-02', principal: '100000.00', interestAmount: '20000.00',
  totalAmount: '120000.00', paidAmount: n === 1 ? '72000.00' : '120000.00',
  paidPrincipal: n === 1 ? '72000.00' : '100000.00', paidInterest: n === 1 ? '0.00' : '20000.00',
  pendingPlanAmount: n === 1 ? '48000.00' : '0.00', invalidCount: 0,
  rootDisbursedAmount: n === 1 ? '100000.00' : null, ...overrides,
});
const edge = (n: number, origin = uuid(1), successor = uuid(2),
  overrides: Partial<RefinancingChainTransitionRow> = {}): RefinancingChainTransitionRow => ({
  refinancingId: uuid(n), refinancingDate: '2026-09-02', originLoanId: origin, newLoanId: successor,
  originCustomerId: customer.id, newCustomerId: customer.id,
  outstandingPrincipalTransferred: '28000.00', capitalizedOutstandingInterest: '20000.00',
  newMoneyDisbursed: '52000.00', newContractualPrincipal: '100000.00',
  newInterestAmount: '20000.00', newContractualTotal: '120000.00', ...overrides,
});
const graph = (): RefinancingChainGraph => ({ customer, loans: [loan(1), loan(2)], transitions: [edge(50)] });
const service = (value: RefinancingChainGraph | null = graph()) => {
  const chainGraphForLoan = jest.fn(async () => value ?? undefined);
  const chainsForCustomer = jest.fn(async () => value ?? undefined);
  return { chainGraphForLoan, chainsForCustomer, useCase: new LoanRefinancingUseCase({
    chainGraphForLoan, chainsForCustomer,
  } as unknown as RefinancingStore) };
};

describe('refinancing chain reconstruction from persisted operation facts', () => {
  it('keeps capital-first payments separate from capitalized interest on a CANCELLED terminal', async () => {
    const { useCase } = service();
    const chain = await useCase.chain(uuid(2));
    expect(chain).toMatchObject({ rootLoanId: uuid(1), terminalLoanId: uuid(2), customer,
      startedAt: '2026-09-01', lastRefinancingDate: '2026-09-02',
      loans: [
        { loanId: uuid(1), status: 'REFINANCED', paidAmount: '72000.00', paidPrincipal: '72000.00', paidInterest: '0.00',
          outstandingPrincipal: '28000.00', outstandingInterest: '20000.00', financialBalance: '48000.00', isRoot: true, isTerminal: false },
        { loanId: uuid(2), status: 'CANCELLED', paidAmount: '120000.00', paidPrincipal: '100000.00', paidInterest: '20000.00',
          outstandingPrincipal: '0.00', outstandingInterest: '0.00', financialBalance: '0.00', isRoot: false, isTerminal: true },
      ],
      transitions: [{ refinancingId: uuid(50), originLoanId: uuid(1), newLoanId: uuid(2),
        outstandingPrincipalTransferred: '28000.00', capitalizedOutstandingInterest: '20000.00',
        newMoneyDisbursed: '52000.00', newContractualPrincipal: '100000.00',
        newInterestAmount: '20000.00', newContractualTotal: '120000.00' }],
      summary: { loanCount: 2, refinancingCount: 1, totalOutstandingPrincipalTransferred: '28000.00',
        totalCapitalizedOutstandingInterest: '20000.00', totalNewMoneyDisbursed: '52000.00',
        totalNewInterestContracted: '20000.00', totalPaymentsReceived: '192000.00',
        totalPrincipalApplied: '172000.00', totalInterestApplied: '20000.00',
        rootDisbursedAmount: '100000.00', totalCashActuallyDisbursed: '152000.00' } });
    expect(chain.loans[0].paidInterest).toBe('0.00');
    expect(chain.loans[1].paidInterest).toBe('20000.00');
    expect(JSON.stringify(chain)).not.toMatch(/profit|rentability|daysGained|chainId|netCashRecovered/);
  });

  it('returns the identical ordered four-loan chain from root, intermediate nodes and terminal', async () => {
    const nodes = [loan(1, { paidAmount: '0.00', paidPrincipal: '0.00', pendingPlanAmount: '120000.00' }),
      loan(2, { status: 'REFINANCED', principal: '120000.00', interestAmount: '0.00', totalAmount: '120000.00',
        paidAmount: '20000.00', paidPrincipal: '20000.00', paidInterest: '0.00',
        pendingPlanAmount: '100000.00', rootDisbursedAmount: null }),
      loan(3, { status: 'REFINANCED', principal: '120000.00', interestAmount: '0.00', totalAmount: '120000.00',
        paidAmount: '0.00', paidPrincipal: '0.00', paidInterest: '0.00', pendingPlanAmount: '120000.00' }),
      loan(4, { status: 'ACTIVE', principal: '120000.00', interestAmount: '0.00', totalAmount: '120000.00',
        paidAmount: '0.00', paidPrincipal: '0.00', paidInterest: '0.00', pendingPlanAmount: '120000.00' })];
    const transitions = [edge(51, uuid(1), uuid(2), { outstandingPrincipalTransferred: '100000.00',
      newMoneyDisbursed: '0.00', newContractualPrincipal: '120000.00', newInterestAmount: '0.00' }),
    edge(52, uuid(2), uuid(3), { refinancingDate: '2026-09-03', outstandingPrincipalTransferred: '100000.00',
      capitalizedOutstandingInterest: '0.00', newMoneyDisbursed: '20000.00',
      newContractualPrincipal: '120000.00', newInterestAmount: '0.00' }),
    edge(53, uuid(3), uuid(4), { refinancingDate: '2026-09-04', outstandingPrincipalTransferred: '120000.00',
      capitalizedOutstandingInterest: '0.00', newMoneyDisbursed: '0.00', newContractualPrincipal: '120000.00', newInterestAmount: '0.00' })];
    const input = { customer, loans: [...nodes].reverse(), transitions: [...transitions].reverse() };
    const { useCase, chainGraphForLoan } = service(input);
    const results = await Promise.all([1, 2, 3, 4].map((id) => useCase.chain(uuid(id))));
    for (const chain of results) {
      expect(chain.loans.map((row) => row.loanId)).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)]);
      expect(chain.transitions.map((row) => row.refinancingId)).toEqual([uuid(51), uuid(52), uuid(53)]);
      expect(chain.summary).toMatchObject({ loanCount: 4, refinancingCount: 3 });
    }
    expect(results[0]).toEqual(results[3]);
    expect(chainGraphForLoan).toHaveBeenCalledTimes(4);
  });

  it('returns separate chains for one customer without mixing another customer or independent loans', async () => {
    const secondRoot = loan(10, { status: 'REFINANCED', paidAmount: '0.00', paidPrincipal: '0.00',
      paidInterest: '0.00', pendingPlanAmount: '120000.00', rootDisbursedAmount: '100000.00' });
    const secondSuccessor = loan(11, { status: 'ACTIVE', principal: '120000.00', interestAmount: '0.00',
      totalAmount: '120000.00', paidAmount: '0.00', paidPrincipal: '0.00', paidInterest: '0.00', pendingPlanAmount: '120000.00' });
    const input: RefinancingChainGraph = { customer, loans: [secondSuccessor, loan(2), secondRoot, loan(1)],
      transitions: [edge(51, uuid(10), uuid(11), { outstandingPrincipalTransferred: '100000.00',
        newMoneyDisbursed: '0.00', newContractualPrincipal: '120000.00', newInterestAmount: '0.00' }), edge(50)] };
    const { useCase } = service(input);
    const customerChains = await useCase.chainsForCustomer(customer.id);
    expect(customerChains.customer).toEqual(customer);
    expect(customerChains.chains.map((chain) => chain.loans.map((row) => row.loanId))).toEqual([
      [uuid(1), uuid(2)], [uuid(10), uuid(11)],
    ]);
    expect((await useCase.chain(uuid(11))).loans.map((row) => row.loanId)).toEqual([uuid(10), uuid(11)]);
    const otherCustomer = uuid(99);
    const distinct: RefinancingChainGraph = { customer: { id: otherCustomer, fullName: 'Other', identification: 'OTHER' },
      loans: input.loans.map((node) => ({ ...node, customerId: otherCustomer })),
      transitions: input.transitions.map((transition) => ({ ...transition,
        originCustomerId: otherCustomer, newCustomerId: otherCustomer })) };
    const separate = service(distinct);
    expect((await separate.useCase.chainsForCustomer(otherCustomer)).customer.id).toBe(otherCustomer);
    expect(customerChains.chains.every((chain) => chain.customer.id === customer.id)).toBe(true);
    await expect(service(distinct).useCase.chainsForCustomer(customer.id)).rejects.toMatchObject({
      reasonCode: 'CHAIN_INTEGRITY_ERROR',
    });
  });

  it('distinguishes an unknown loan/customer from an independent loan and an empty customer history', async () => {
    await expect(service(null).useCase.chain(uuid(1))).rejects.toBeInstanceOf(RefinancingNotFoundError);
    await expect(service(null).useCase.chainsForCustomer(customer.id)).rejects.toBeInstanceOf(RefinancingNotFoundError);
    const empty = { customer, loans: [], transitions: [] };
    expect(await service(empty).useCase.chainsForCustomer(customer.id)).toEqual({ customer, chains: [] });
    await expect(service(empty).useCase.chain(uuid(1))).rejects.toBeInstanceOf(RefinancingNotFoundError);
    await expect(service().useCase.chain(uuid(99))).rejects.toBeInstanceOf(RefinancingNotFoundError);
    await expect(service().useCase.chain('invalid')).rejects.toBeInstanceOf(RefinancingValidationError);
    await expect(service().useCase.chainsForCustomer('invalid')).rejects.toBeInstanceOf(RefinancingValidationError);
  });

  it('does not invent initial cash when root has no recorded loan disbursement', async () => {
    const input = graph(); input.loans[0].rootDisbursedAmount = null;
    const chain = await service(input).useCase.chain(uuid(1));
    expect(chain.summary).toMatchObject({ rootDisbursedAmount: null, totalCashActuallyDisbursed: null,
      totalNewMoneyDisbursed: '52000.00' });
  });

  it.each([
    ['wrong customer edge', (input: RefinancingChainGraph) => { input.transitions[0].newCustomerId = uuid(99); }],
    ['wrong loan customer', (input: RefinancingChainGraph) => { input.loans[1].customerId = uuid(99); }],
    ['duplicate successor', (input: RefinancingChainGraph) => { input.transitions.push(edge(52, uuid(3), uuid(2))); input.loans.push(loan(3, { status: 'REFINANCED', paidAmount: '0.00', paidPrincipal: '0.00', paidInterest: '0.00', pendingPlanAmount: '120000.00' })); }],
    ['branch', (input: RefinancingChainGraph) => { input.transitions.push(edge(52, uuid(1), uuid(3))); input.loans.push(loan(3, { status: 'ACTIVE', paidAmount: '0.00', paidPrincipal: '0.00', paidInterest: '0.00', pendingPlanAmount: '120000.00' })); }],
    ['cycle', (input: RefinancingChainGraph) => { input.loans[1].status = 'REFINANCED'; input.transitions.push(edge(52, uuid(2), uuid(1))); }],
    ['duplicate operation', (input: RefinancingChainGraph) => { input.transitions.push({ ...input.transitions[0] }); }],
    ['missing loan', (input: RefinancingChainGraph) => { input.loans.pop(); }],
    ['corrupt financials', (input: RefinancingChainGraph) => { input.loans[0].paidInterest = '30000.00'; }],
    ['wrong origin status', (input: RefinancingChainGraph) => { input.loans[0].status = 'ACTIVE'; }],
    ['wrong successor principal', (input: RefinancingChainGraph) => { input.loans[1].principal = '99999.00'; }],
  ] as Array<[string, (input: RefinancingChainGraph) => void]>)('rejects %s with a controlled integrity conflict', async (_, change) => {
    const input = graph(); change(input);
    await expect(service(input).useCase.chainsForCustomer(customer.id)).rejects.toMatchObject({
      reasonCode: 'CHAIN_INTEGRITY_ERROR',
    });
  });

  it('caps chain length and the customer graph size without unbounded traversals', async () => {
    const long: RefinancingChainGraph = { customer, loans: [], transitions: [] };
    for (let i = 0; i <= 128; i++) {
      long.loans.push(loan(i + 100, { status: i === 128 ? 'ACTIVE' : 'REFINANCED',
        principal: '100.00', interestAmount: '0.00', totalAmount: '100.00', paidAmount: '0.00',
        paidPrincipal: '0.00', paidInterest: '0.00', pendingPlanAmount: '100.00' }));
      if (i) long.transitions.push(edge(i + 300, uuid(i + 99), uuid(i + 100), {
        outstandingPrincipalTransferred: '100.00', capitalizedOutstandingInterest: '0.00',
        newMoneyDisbursed: '0.00', newContractualPrincipal: '100.00',
        newInterestAmount: '0.00', newContractualTotal: '100.00' }));
    }
    await expect(service(long).useCase.chain(uuid(100))).rejects.toMatchObject({ reasonCode: 'CHAIN_INTEGRITY_ERROR' });
    const huge: RefinancingChainGraph = { customer, loans: [], transitions: Array.from({ length: 2049 }, () => edge(50)) };
    expect(() => buildRefinancingChains(huge)).toThrow('exceeds the safe limit');
  });
});
