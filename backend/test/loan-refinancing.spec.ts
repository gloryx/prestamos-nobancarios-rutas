import { LoanRefinancingUseCase, RefinancingConflictError, RefinancingValidationError, refinancingBaseline,
  type RefinancingRequest } from '../src/application/loan-refinancing/refinancing.use-case';
import type { HistoricalRefinancingPayments, NewRefinancing, RefinancingChainGraph, RefinancingListItem, RefinancingListQuery, RefinancingOperation, RefinancingStore, RefinancingTransaction } from '../src/application/loan-refinancing/refinancing.port';
import type { RefinancingSnapshot } from '../src/domain/loan-refinancing/refinancing-finance';
import { cents } from '../src/domain/loan/loan-financial-integrity';
import { money } from '../src/domain/loan-refinancing/refinancing-finance';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const origin = uuid(1), actor = uuid(2), otherActor = uuid(3), method = uuid(4), frequency = uuid(5);
const baselineLoan = (): RefinancingSnapshot => ({ id: origin, loanNumber: '100', customerId: uuid(6),
  customerName: 'Customer One', identification: '123', status: 'ACTIVE', startDate: '2026-09-01',
  lastValidPaymentDate: '2026-09-10', principal: '150000.00', interestAmount: '30000.00', totalAmount: '180000.00',
  totals: { paidAmount: '30000.00', paidPrincipal: '30000.00', paidInterest: '0.00', invalidCount: 0 },
  plan: [{ id: uuid(7), sequence: 1, dueDate: '2026-10-01', pendingAmount: '150000.00' }] });
const request = (baseline: string, newMoney = '50000.00'): RefinancingRequest => ({ originLoanId: origin,
  refinancingDate: '2026-09-30', newMoney, ...(newMoney === '0.00' ? {} : { disbursementPaymentMethodId: method }),
  newInterestAmount: '40000.00', paymentFrequencyId: frequency, preferredPaymentMethodId: method,
  plan: [{ sequence: 1, dueDate: '2026-10-30', pendingAmount: newMoney === '0.00' ? '190000.00' : '240000.00' }],
  observations: 'Terms agreed', baseline, idempotencyKey: 'refi-key' });

type State = { loans: Record<string, RefinancingSnapshot>; operations: Record<string, RefinancingOperation & { key: string; fingerprint: string }>;
  cash: Array<{ direction: string; concept: string; amount: string }>; disbursements: Array<{ loanId: string; amount: string }>;
  history: Array<{ loanId: string; from: string | null; to: string }>; payments: Array<{ loanId: string; amount: string }> };

class FakeStore implements RefinancingStore {
  state: State = { loans: { [origin]: baselineLoan() }, operations: {}, cash: [], disbursements: [], history: [],
    payments: [{ loanId: origin, amount: '30000.00' }] };
  fail?: 'plan' | 'cash' | 'history';
  historicalPayments?: HistoricalRefinancingPayments;
  rollbacks = 0;
  private queue: Promise<void> = Promise.resolve();
  async list(_query: RefinancingListQuery): Promise<{ items: RefinancingListItem[]; total: number }> {
    return { items: [], total: 0 };
  }
  async search(query: { search?: string; page: number; pageSize: number }) {
    const loans = Object.values(this.state.loans).filter((loan) => loan.status === 'ACTIVE' &&
      (!query.search || [loan.loanNumber, loan.identification, loan.customerName]
        .some((value) => value.toLowerCase().includes(query.search!.toLowerCase()))))
      .sort((left, right) => BigInt(left.loanNumber) < BigInt(right.loanNumber) ? 1 : -1);
    return { items: loans.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map((loan) => ({
      loanId: loan.id, loanNumber: loan.loanNumber, customer: { id: loan.customerId, fullName: loan.customerName,
        identification: loan.identification }, status: 'ACTIVE' as const, startDate: loan.startDate,
      principal: loan.principal, interestAmount: loan.interestAmount, totalAmount: loan.totalAmount,
      paidAmount: loan.totals.paidAmount, financialBalance: money(cents(loan.totalAmount) - cents(loan.totals.paidAmount)),
    })), total: loans.length };
  }
  async preview(id: string) { return structuredClone(this.state.loans[id]); }
  async previewAt(id: string) {
    const current = this.state.loans[id];
    return current ? { current: structuredClone(current), historicalPayments: this.historicalPayments ?? {
      totals: structuredClone(current.totals), lastValidPaymentDate: current.lastValidPaymentDate, laterPaymentCount: 0,
    } } : undefined;
  }
  async detail(id: string) { return this.state.operations[id] ? this.operation(this.state, id) : undefined; }
  async chainsForCustomer(customerId: string): Promise<RefinancingChainGraph | undefined> {
    const customer = Object.values(this.state.loans).find((loan) => loan.customerId === customerId);
    if (!customer) return undefined;
    const operations = Object.values(this.state.operations).filter((row) =>
      this.state.loans[row.originLoanId]?.customerId === customerId || this.state.loans[row.newLoanId]?.customerId === customerId);
    const ids = new Set(operations.flatMap((row) => [row.originLoanId, row.newLoanId]));
    return { customer: { id: customerId, fullName: customer.customerName, identification: customer.identification },
      loans: [...ids].filter((id) => this.state.loans[id]).map((id) => {
        const loan = this.state.loans[id];
        return { loanId: id, loanNumber: loan.loanNumber, customerId: loan.customerId, status: loan.status,
          startDate: loan.startDate, principal: loan.principal, interestAmount: loan.interestAmount,
          totalAmount: loan.totalAmount, ...loan.totals,
          pendingPlanAmount: money(loan.plan.reduce((sum, row) => sum + cents(row.pendingAmount), 0n)),
          rootDisbursedAmount: this.state.disbursements.find((row) => row.loanId === id)?.amount ?? null };
      }),
      transitions: operations.map((row) => ({ refinancingId: row.id, refinancingDate: row.refinancingDate,
        originLoanId: row.originLoanId, newLoanId: row.newLoanId,
        originCustomerId: this.state.loans[row.originLoanId]?.customerId ?? '',
        newCustomerId: this.state.loans[row.newLoanId]?.customerId ?? '',
        outstandingPrincipalTransferred: row.outstandingPrincipalTransferred,
        capitalizedOutstandingInterest: row.capitalizedOutstandingInterest,
        newMoneyDisbursed: row.newMoneyDisbursed, newContractualPrincipal: row.newContractualPrincipal,
        newInterestAmount: row.newInterestAmount, newContractualTotal: row.newContractualTotal })),
    };
  }
  async chainGraphForLoan(loanId: string): Promise<RefinancingChainGraph | undefined> {
    const loan = this.state.loans[loanId];
    return loan ? this.chainsForCustomer(loan.customerId) : undefined;
  }
  private operation(state: State, id: string) {
    const row = state.operations[id];
    return { ...row, originStatus: state.loans[row.originLoanId].status, newStatus: state.loans[row.newLoanId].status };
  }
  async transaction<T>(work: (tx: RefinancingTransaction) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise((resolve) => { release = resolve; });
    await previous;
    const draft = structuredClone(this.state);
    try {
      const tx: RefinancingTransaction = {
        findByKey: async (key) => { const found = Object.values(draft.operations).find((row) => row.key === key);
          return found ? { id: found.id, fingerprint: found.fingerprint } : undefined; },
        lockOrigin: async (id) => draft.loans[id] && structuredClone(draft.loans[id]),
        readSnapshot: async (id) => draft.loans[id] && structuredClone(draft.loans[id]),
        readHistoricalPayments: async (id) => this.historicalPayments ?? {
          totals: structuredClone(draft.loans[id].totals), lastValidPaymentDate: draft.loans[id].lastValidPaymentDate,
          laterPaymentCount: 0,
        },
        openingDate: async () => '2026-01-01',
        activeReferences: async () => true,
        insertLoan: async (input) => { const id = uuid(Object.keys(draft.loans).length + 100);
          draft.loans[id] = { id, loanNumber: String(150 + Object.keys(draft.operations).length * 70), customerId: input.customerId,
            customerName: 'Customer One', identification: '123', status: 'ACTIVE', startDate: input.refinancingDate,
            lastValidPaymentDate: null, principal: input.principal, interestAmount: input.interestAmount, totalAmount: input.totalAmount,
            totals: { paidAmount: '0.00', paidPrincipal: '0.00', paidInterest: '0.00', invalidCount: 0 }, plan: [] };
          return { id, loanNumber: draft.loans[id].loanNumber, createdAt: new Date('2026-09-30T12:00:00Z') }; },
        insertPlan: async (loanId, plan) => { if (this.fail === 'plan') throw new Error('plan failure');
          draft.loans[loanId].plan = plan.map((row, index) => ({ ...row, id: uuid(200 + index) })); },
        insertRefinancing: async (input: NewRefinancing) => {
          if (Object.values(draft.operations).some((row) => row.originLoanId === input.originLoanId ||
            row.newLoanId === input.newLoanId || row.key === input.idempotencyKey)) return undefined;
          const id = uuid(300 + Object.keys(draft.operations).length);
          draft.operations[id] = { ...input, id, key: input.idempotencyKey, fingerprint: input.idempotencyFingerprint,
            originLoanNumber: draft.loans[input.originLoanId].loanNumber, newLoanNumber: draft.loans[input.newLoanId].loanNumber,
            originStartDate: draft.loans[input.originLoanId].startDate, newStartDate: draft.loans[input.newLoanId].startDate,
            customerId: draft.loans[input.newLoanId].customerId, customerName: draft.loans[input.newLoanId].customerName,
            customerIdentification: draft.loans[input.newLoanId].identification, createdByName: 'Actor',
            observations: 'TERMS AGREED',
            paymentFrequencyId: frequency, paymentFrequencyName: 'Monthly', intervalUnit: 'MONTH', intervalValue: 1,
            preferredPaymentMethodId: method, preferredPaymentMethodName: 'Cash',
            disbursementPaymentMethodName: input.newMoneyDisbursed === '0.00' ? null : 'Cash',
            createdAt: new Date('2026-09-30T12:00:00Z'), originStatus: 'ACTIVE', newStatus: 'ACTIVE',
            disbursementId: null, cashMovementId: null, disbursementAmount: null, disbursementDate: null,
            disbursementMethodId: null, cashAmount: null, cashDate: null, cashMethodId: null,
            cashDirection: null, cashConcept: null };
          return id;
        },
        transitionOrigin: async (id) => { if (draft.loans[id].status !== 'ACTIVE') return false;
          draft.loans[id].status = 'REFINANCED'; return true; },
        createStatusHistory: async (originId, newLoan) => { if (this.fail === 'history') throw new Error('history failure');
          draft.history.push({ loanId: originId, from: 'ACTIVE', to: 'REFINANCED' },
            { loanId: newLoan.id, from: null, to: 'ACTIVE' }); },
        disburseNewMoney: async (input) => { draft.disbursements.push({ loanId: input.newLoanId, amount: input.amount });
          if (this.fail === 'cash') throw new Error('cash failure');
          draft.cash.push({ direction: 'OUTFLOW', concept: 'REFINANCING_NEW_MONEY_DISBURSEMENT', amount: input.amount });
          draft.operations[input.refinancingId].disbursementId = uuid(400);
          draft.operations[input.refinancingId].cashMovementId = uuid(401);
          draft.operations[input.refinancingId].disbursementAmount = input.amount;
          draft.operations[input.refinancingId].cashAmount = input.amount;
          draft.operations[input.refinancingId].disbursementDate = input.date;
          draft.operations[input.refinancingId].cashDate = input.date;
          draft.operations[input.refinancingId].disbursementMethodId = input.methodId;
          draft.operations[input.refinancingId].cashMethodId = input.methodId;
          draft.operations[input.refinancingId].cashDirection = 'OUTFLOW';
          draft.operations[input.refinancingId].cashConcept = 'REFINANCING_NEW_MONEY_DISBURSEMENT'; },
        readOperation: async (id) => draft.operations[id] ? this.operation(draft, id) : undefined,
      };
      const result = await work(tx);
      this.state = draft;
      return result;
    } catch (error) { this.rollbacks++; throw error; }
    finally { release(); }
  }
}

describe('loan refinancing financial operation', () => {
  const setup = () => { const store = new FakeStore(); return { store, useCase: new LoanRefinancingUseCase(store) }; };

  it('qualifies by total VALID paid, not interest recovered, and exposes the reconciled baseline', async () => {
    const { useCase } = setup();
    const preview = await useCase.preview(origin);
    expect(preview).toMatchObject({ eligible: true, minimumRequiredPayment: '30000.00', remainingToMinimum: '0.00',
      reasonCode: null, reason: null, paidAmount: '30000.00',
      paidPrincipal: '30000.00', paidInterest: '0.00', outstandingPrincipal: '120000.00',
      outstandingInterest: '30000.00', financialBalance: '150000.00', pendingPlanAmount: '150000.00' });
    expect(preview.baseline).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reports a 10k commercial shortfall without claiming that interest has been paid', async () => {
    const { store, useCase } = setup();
    store.state.loans[origin].totals = { paidAmount: '20000.00', paidPrincipal: '20000.00',
      paidInterest: '0.00', invalidCount: 0 };
    store.state.loans[origin].plan[0].pendingAmount = '160000.00';
    expect(await useCase.preview(origin)).toMatchObject({ paidInterest: '0.00', eligible: false,
      minimumRequiredPayment: '30000.00', remainingToMinimum: '10000.00',
      reasonCode: 'MINIMUM_PAYMENT_NOT_MET', reason: expect.any(String) });
  });

  it('normalizes server-side candidate search, pages and excludes every non-ACTIVE status', async () => {
    const { store, useCase } = setup();
    const second = { ...baselineLoan(), id: uuid(80), loanNumber: '150',
      identification: 'XYZ', customerName: 'Customer Two' };
    store.state.loans[second.id] = second;
    for (const [index, status] of ['CANCELLED', 'REFINANCED', 'UNCOLLECTIBLE', 'ANNULLED'].entries()) {
      const id = uuid(90 + index);
      store.state.loans[id] = { ...baselineLoan(), id, loanNumber: String(900 + index), status };
    }
    const search = jest.spyOn(store, 'search');
    expect((await useCase.search({ search: '  customer   one  ' })).items.map((item) => item.loanId)).toEqual([origin]);
    expect(search).toHaveBeenCalledWith({ search: 'customer one', page: 1, pageSize: 20 });
    expect((await useCase.search({ search: 'xyz' })).items.map((item) => item.loanId)).toEqual([second.id]);
    expect((await useCase.search({ search: '150' })).items.map((item) => item.loanId)).toEqual([second.id]);
    const page = await useCase.search({ page: 1, pageSize: 10 });
    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 10 });
    expect(page.items[0]).toMatchObject({ loanId: second.id, status: 'ACTIVE',
      customer: { fullName: second.customerName }, paidAmount: '30000.00', financialBalance: '150000.00' });
    for (const filters of [{ page: 0 }, { pageSize: 100 }, { search: 'a'.repeat(121) }]) {
      await expect(useCase.search(filters)).rejects.toBeInstanceOf(RefinancingValidationError);
    }
  });

  it.each([
    ['minimum', (s: State) => { s.loans[origin].totals = { paidAmount: '29999.99', paidPrincipal: '29999.99', paidInterest: '0.00', invalidCount: 0 }; s.loans[origin].plan[0].pendingAmount = '150000.01'; }, 'MINIMUM_PAYMENT_NOT_MET'],
    ['status', (s: State) => { s.loans[origin].status = 'UNCOLLECTIBLE'; }, 'LOAN_NOT_ACTIVE'],
    ['balance', (s: State) => { s.loans[origin].plan[0].pendingAmount = '149999.99'; }, 'FINANCIAL_INTEGRITY_ERROR'],
  ])('rejects ineligible %s origin without changing state', async (_, change, reason) => {
    const { store, useCase } = setup(); change(store.state);
    const preview = await useCase.preview(origin);
    expect(preview.eligible).toBe(false); expect(preview.reasons).toContain(reason);
    const before = structuredClone(store.state);
    await expect(useCase.confirm(request(preview.baseline), actor)).rejects.toBeInstanceOf(RefinancingConflictError);
    expect(store.state).toEqual(before);
  });

  it('capitalizes old interest without realizing it and disburses ONLY 50k', async () => {
    const { store, useCase } = setup(); const before = structuredClone(store.state);
    const created = await useCase.confirm(request((await useCase.preview(origin)).baseline), actor);
    expect(created).toMatchObject({ outstandingPrincipalTransferred: '120000.00', capitalizedOutstandingInterest: '30000.00',
      newMoneyDisbursed: '50000.00', newContractualPrincipal: '200000.00', newInterestAmount: '40000.00',
      newContractualTotal: '240000.00', originStatus: 'REFINANCED', newStatus: 'ACTIVE' });
    expect(store.state.cash).toEqual([{ direction: 'OUTFLOW', concept: 'REFINANCING_NEW_MONEY_DISBURSEMENT', amount: '50000.00' }]);
    expect(store.state.disbursements).toEqual([{ loanId: created.newLoanId, amount: '50000.00' }]);
    expect(store.state.cash).not.toEqual(expect.arrayContaining([expect.objectContaining({ amount: '200000.00' })]));
    expect(store.state.loans[origin]).toEqual({ ...before.loans[origin], status: 'REFINANCED' });
    expect(store.state.payments).toEqual(before.payments);
    expect(store.state.loans[created.newLoanId].plan).toEqual([{ ...request('').plan[0], id: uuid(200) }]);
    expect(store.state.loans[created.newLoanId].totals.paidInterest).toBe('0.00');
    expect(store.state.cash.some((row) => row.direction === 'INFLOW')).toBe(false);
    expect(store.state.history).toEqual([{ loanId: origin, from: 'ACTIVE', to: 'REFINANCED' },
      { loanId: created.newLoanId, from: null, to: 'ACTIVE' }]);
    expect(await useCase.detail(created.id)).toMatchObject({ id: created.id, capitalizedOutstandingInterest: '30000.00' });
  });

  it('uses a payment annulled later when confirming at the earlier economic date', async () => {
    const { store, useCase } = setup();
    store.historicalPayments = { totals: { paidAmount: '30040.00', paidPrincipal: '30040.00',
      paidInterest: '0.00', invalidCount: 0 }, lastValidPaymentDate: '2026-09-10', laterPaymentCount: 0 };
    const body = request((await useCase.preview(origin)).baseline);
    body.plan[0].pendingAmount = '239960.00';
    const created = await useCase.confirm(body, actor);
    expect(created).toMatchObject({ outstandingPrincipalTransferred: '119960.00',
      capitalizedOutstandingInterest: '30000.00', newContractualPrincipal: '199960.00',
      newContractualTotal: '239960.00' });
  });

  it('distinguishes a current-balance plan from malformed input and accepts the last payment date', async () => {
    const { store, useCase } = setup();
    store.state.loans[origin] = { ...baselineLoan(), principal: '500000.00', interestAmount: '100000.00',
      totalAmount: '600000.00', lastValidPaymentDate: '2026-09-26',
      totals: { paidAmount: '440000.00', paidPrincipal: '440000.00', paidInterest: '0.00', invalidCount: 0 },
      plan: [{ id: uuid(7), sequence: 1, dueDate: '2026-10-01', pendingAmount: '160000.00' }] };
    store.historicalPayments = { totals: { paidAmount: '440040.00', paidPrincipal: '440040.00',
      paidInterest: '0.00', invalidCount: 0 }, lastValidPaymentDate: '2026-09-26', laterPaymentCount: 0 };
    const preview = await useCase.preview(origin);
    const historicalPreview = await useCase.preview(origin, '2026-09-26');
    expect(historicalPreview).toMatchObject({ paidAmount: '440040.00', paidPrincipal: '440040.00',
      outstandingPrincipal: '59960.00', outstandingInterest: '100000.00', financialBalance: '159960.00',
      pendingPlanAmount: '159960.00', baseline: preview.baseline });
    const body = { ...request(preview.baseline, '340000.00'), refinancingDate: '2026-09-26',
      newInterestAmount: '100000.00', plan: [{ sequence: 1, dueDate: '2026-09-28', pendingAmount: '600000.00' }] };
    await expect(useCase.confirm(body, actor)).rejects.toMatchObject({ reasonCode: 'HISTORICAL_BALANCE_CONFLICT' });
    body.plan[0].pendingAmount = '599960.00';
    await expect(useCase.confirm(body, actor)).resolves.toMatchObject({ outstandingPrincipalTransferred: '59960.00',
      capitalizedOutstandingInterest: '100000.00', newMoneyDisbursed: '340000.00',
      newContractualPrincipal: '499960.00', newContractualTotal: '599960.00' });
  });

  it('rejects a retroactive refinancing when the origin has later economic payments', async () => {
    const { store, useCase } = setup();
    store.historicalPayments = { totals: structuredClone(store.state.loans[origin].totals),
      lastValidPaymentDate: '2026-09-10', laterPaymentCount: 1 };
    await expect(useCase.preview(origin, '2026-09-30'))
      .rejects.toMatchObject({ reasonCode: 'HISTORICAL_STATE_CONFLICT' });
    await expect(useCase.confirm(request((await useCase.preview(origin)).baseline), actor))
      .rejects.toMatchObject({ reasonCode: 'HISTORICAL_STATE_CONFLICT' });
    expect(store.state.loans[origin].status).toBe('ACTIVE');
  });

  it('rejects malformed or out-of-range historical preview dates before confirmation', async () => {
    const { useCase } = setup();
    await expect(useCase.preview(origin, '2026-02-30')).rejects.toBeInstanceOf(RefinancingValidationError);
    await expect(useCase.preview(origin, '2026-08-31')).rejects.toBeInstanceOf(RefinancingValidationError);
  });

  it('permits zero new money without a disbursement or cash entry', async () => {
    const { store, useCase } = setup();
    const created = await useCase.confirm(request((await useCase.preview(origin)).baseline, '0.00'), actor);
    expect(created).toMatchObject({ newMoneyDisbursed: '0.00', newContractualPrincipal: '150000.00',
      newContractualTotal: '190000.00', disbursementId: null, cashMovementId: null });
    expect(store.state.disbursements).toEqual([]); expect(store.state.cash).toEqual([]);
    expect(store.state.loans[created.newLoanId].plan[0].pendingAmount).toBe('190000.00');
  });

  it.each(['plan', 'cash', 'history'] as const)('rolls back the entire operation if %s fails', async (point) => {
    const { store, useCase } = setup(); store.fail = point;
    const before = structuredClone(store.state);
    await expect(useCase.confirm(request((await useCase.preview(origin)).baseline), actor)).rejects.toThrow();
    expect(store.state).toEqual(before); expect(store.rollbacks).toBe(1);
  });

  it('returns a durable replay for the same normalized request; a different payload or key conflicts', async () => {
    const { store, useCase } = setup(); const body = request((await useCase.preview(origin)).baseline);
    const first = await useCase.confirm(body, actor);
    expect(await useCase.confirm({ ...body, newMoney: '50000' }, actor)).toEqual(first);
    expect(Object.keys(store.state.operations)).toHaveLength(1);
    await expect(useCase.confirm({ ...body, newInterestAmount: '40000.01' }, actor)).rejects.toBeInstanceOf(RefinancingConflictError);
    await expect(useCase.confirm({ ...body, idempotencyKey: 'other-key' }, otherActor)).rejects.toBeInstanceOf(RefinancingConflictError);
    expect(Object.keys(store.state.operations)).toHaveLength(1);
  });

  it('serializes simultaneous attempts by different users and prevents a second successor', async () => {
    const { store, useCase } = setup(); const body = request((await useCase.preview(origin)).baseline);
    const outcomes = await Promise.allSettled([useCase.confirm(body, actor),
      useCase.confirm({ ...body, idempotencyKey: 'another-key' }, otherActor)]);
    expect(outcomes.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(Object.values(store.state.operations)).toHaveLength(1);
    const sameKey = await Promise.all([useCase.confirm(body, actor), useCase.confirm(body, actor)]);
    expect(sameKey[0].id).toBe(sameKey[1].id);
  });

  it('rejects a payment or plan edit after preview rather than silently using stale amounts', async () => {
    const { store, useCase } = setup(); const preview = await useCase.preview(origin);
    store.state.loans[origin].totals.paidAmount = '40000.00';
    store.state.loans[origin].totals.paidPrincipal = '40000.00';
    store.state.loans[origin].plan[0].pendingAmount = '140000.00';
    await expect(useCase.confirm(request(preview.baseline), actor)).rejects.toThrow('changed since the preview');
    await expect(useCase.confirm(request(preview.baseline), actor)).rejects.toMatchObject({ reasonCode: 'STALE_DATA' });
    expect(store.state.loans[origin].status).toBe('ACTIVE');
    store.state.loans[origin] = baselineLoan();
    store.state.loans[origin].plan[0].dueDate = '2026-10-02';
    await expect(useCase.confirm(request(preview.baseline), actor)).rejects.toThrow('changed since the preview');
    store.state.loans[origin].totals = { paidAmount: '20000.00', paidPrincipal: '20000.00', paidInterest: '0.00', invalidCount: 0 };
    store.state.loans[origin].plan[0].pendingAmount = '160000.00';
    await expect(useCase.confirm(request(preview.baseline), actor)).rejects.toMatchObject({ reasonCode: 'STALE_DATA' });
  });

  it('supports A → B → C and rejects a cycle', async () => {
    const { store, useCase } = setup();
    const first = await useCase.confirm(request((await useCase.preview(origin)).baseline), actor);
    const secondOrigin = store.state.loans[first.newLoanId];
    secondOrigin.totals = { paidAmount: '40000.00', paidPrincipal: '40000.00', paidInterest: '0.00', invalidCount: 0 };
    secondOrigin.plan[0].pendingAmount = '200000.00';
    secondOrigin.lastValidPaymentDate = '2026-09-30';
    const second = await useCase.confirm({ ...request((await useCase.preview(secondOrigin.id)).baseline, '0.00'),
      originLoanId: secondOrigin.id, idempotencyKey: 'chain-next', plan: [{ sequence: 1, dueDate: '2026-10-30', pendingAmount: '240000.00' }] }, actor);
    expect((await useCase.chain(first.newLoanId)).loans.map((item) => item.loanId)).toEqual([origin, first.newLoanId, second.newLoanId]);
    const chain = await useCase.chain(second.newLoanId);
    expect(chain.loans.map((item) => item.loanId)).toEqual([origin, first.newLoanId, second.newLoanId]);
    expect(chain.loans[1]).toMatchObject({ startDate: '2026-09-30', status: 'REFINANCED' });
    expect(chain.transitions[0]).toMatchObject({ refinancingId: first.id,
      capitalizedOutstandingInterest: '30000.00', newMoneyDisbursed: '50000.00' });
    expect(chain.transitions[1]).toMatchObject({ refinancingId: second.id, newMoneyDisbursed: '0.00' });
    await expect(useCase.confirm({ ...request((await useCase.preview(origin)).baseline), idempotencyKey: 'second-origin' }, actor)).rejects.toBeInstanceOf(RefinancingConflictError);
    store.state.operations[uuid(999)] = { ...store.state.operations[second.id], id: uuid(999), originLoanId: second.newLoanId,
      newLoanId: origin, key: 'corrupt-cycle' };
    await expect(useCase.chain(origin)).rejects.toBeInstanceOf(RefinancingConflictError);
  });

  it('rejects a mismatched plan, invalid method contract and changed idempotency actor', async () => {
    const { useCase } = setup(); const body = request((await useCase.preview(origin)).baseline);
    for (const invalid of [{ ...body, plan: [{ ...body.plan[0], pendingAmount: '239999.99' }] },
      { ...body, newMoney: '0.00' }, { ...body, plan: [{ ...body.plan[0], dueDate: body.refinancingDate }] }]) {
      await expect(useCase.confirm(invalid, actor)).rejects.toBeInstanceOf(RefinancingValidationError);
    }
    await useCase.confirm(body, actor);
    await expect(useCase.confirm(body, otherActor)).rejects.toBeInstanceOf(RefinancingConflictError);
  });

  it('computes the same baseline for normalized monetary values', () => {
    const original = baselineLoan(); const normalized = baselineLoan(); normalized.principal = '150000';
    expect(refinancingBaseline(original)).toBe(refinancingBaseline(normalized));
    expect(refinancingBaseline({ ...original, id: uuid(99) })).not.toBe(refinancingBaseline(original));
  });
});
