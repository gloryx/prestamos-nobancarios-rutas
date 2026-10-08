import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoanRefinancingLookup, LoanRefinancingOperations } from '../../application/ports/loan-refinancing.repository';
import { RefinancingStepOneController } from '../../application/use-cases/refinancing-step-one-controller';
import { RefinancingConditionsController } from '../../application/use-cases/refinancing-conditions-controller';
import { RefinancingConfirmationController } from '../../application/use-cases/refinancing-confirmation-controller';
import type { RefinancingPreview, RefinancingResult } from '../../domain/entities/loan-refinancing';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { classifyRefinancingFailure } from '../../infrastructure/api/loan-refinancing.api';
import { NewRefinancingPage } from './NewRefinancingPage';
import { RefinancingResultView } from './RefinancingResultView';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as Array<{ current: unknown }>, effects: [] as Array<() => void | (() => void)>,
  stateIndex: 0, refIndex: 0, navigate: vi.fn(), setSearchParams: vi.fn(), search: '' }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = hooks.stateIndex++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ?
      (value as (previous: unknown) => unknown)(hooks.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ?? (hooks.refs[index] = { current: initial }); },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); }, useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(),
  useNavigate: () => hooks.navigate, useSearchParams: () => [new URLSearchParams(hooks.search), hooks.setSearchParams],
}));

const preview: RefinancingPreview = {
  loanId: '11111111-1111-4111-8111-111111111111', loanNumber: '101',
  customer: { id: 'customer-1', name: 'Ana Solís', identification: '12345' },
  status: 'ACTIVE', startDate: '2026-09-01', principal: '150000.00', interestAmount: '30000.00',
  totalAmount: '180000.00', paidAmount: '30000.00', paidPrincipal: '30000.00', paidInterest: '0.00',
  outstandingPrincipal: '120000.00', outstandingInterest: '30000.00', financialBalance: '150000.00',
  pendingPlanAmount: '150000.00', minimumRequiredPayment: '30000.00', remainingToMinimum: '0.00',
  eligible: true, reasonCode: null, reason: null, reasons: [], baseline: 'a'.repeat(64),
};
const result: RefinancingResult = {
  refinancingId: 'ref-1', refinancingDate: '2026-10-01', createdAt: '2026-10-01T12:00:00Z',
  originLoan: { id: preview.loanId, loanNumber: '101', status: 'REFINANCED', startDate: '2026-09-01' },
  newLoan: { id: 'new-1', loanNumber: '102', status: 'ACTIVE', startDate: '2026-10-01' },
  customer: { id: 'customer-1', fullName: 'Ana Solís', identification: '12345' },
  financialComposition: { outstandingPrincipalTransferred: '120000.00', capitalizedOutstandingInterest: '30000.00',
    newMoneyDisbursed: '20000.00', newContractualPrincipal: '170000.00', newInterestAmount: '10000.00', newContractualTotal: '180000.00' },
  newContract: { paymentFrequency: { id: 'daily', name: 'Diaria', intervalUnit: 'DAY', intervalValue: 1 },
    preferredPaymentMethod: { id: 'cash', name: 'Efectivo' },
    disbursementPaymentMethod: { id: 'transfer', name: 'Transferencia' }, observations: null },
  disbursement: { id: 'disb-1', cashMovementId: 'cash-1' }, createdBy: { id: 'user-1', fullName: 'Admin' },
};

function setup() {
  let latestPreview = preview;
  let historicalPreview: RefinancingPreview | undefined;
  const lookup: LoanRefinancingLookup = {
    search: vi.fn(async (query) => ({ items: [], total: 0, page: query.page, pageSize: query.pageSize })),
    preview: vi.fn(async (_loanId, refinancingDate) => refinancingDate ? historicalPreview ?? latestPreview : latestPreview),
  };
  const operations: LoanRefinancingOperations = { confirm: vi.fn(async () => result), detail: vi.fn(async () => result) };
  const origin = new RefinancingStepOneController(lookup);
  const conditions = new RefinancingConditionsController({ load: vi.fn(async () => ({
    frequencies: [{ id: 'daily', name: 'Diaria', intervalUnit: 'DAY' as const, intervalValue: 1, order: 1, isActive: true }],
    methods: [{ id: 'cash', name: 'Efectivo', order: 1, isActive: true },
      { id: 'transfer', name: 'Transferencia', order: 2, isActive: true }],
  })) }, lookup);
  const keys = vi.fn().mockReturnValueOnce('key-1').mockReturnValueOnce('key-2').mockReturnValueOnce('key-3');
  const confirmation = new RefinancingConfirmationController(operations, keys, classifyRefinancingFailure);
  const page = () => { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effects = [];
    return NewRefinancingPage({ controller: origin, conditionsController: conditions, confirmationController: confirmation }); };
  const wizard = () => page().props as Parameters<typeof NewRefinancingPage>[0] & {
    onContinue: () => void; onContinueToConfirmation: () => void; onBackToConditions: () => void;
    onConfirm: (allowed: boolean) => void; onClearSelection: () => void; notice: string;
  };
  const prepare = async () => {
    await origin.select(preview.loanId);
    wizard().onContinue();
    await vi.waitFor(() => expect(conditions.getSnapshot().optionsLoaded).toBe(true));
    conditions.setConditions({ refinancingDate: '2026-10-01', newMoney: '20000.00', newInterestAmount: '10000.00',
      paymentFrequencyId: 'daily', preferredPaymentMethodId: 'cash', disbursementPaymentMethodId: 'transfer', count: '2' });
    wizard().onContinueToConfirmation();
    expect(origin.getSnapshot().step).toBe('CONFIRMATION');
  };
  return { lookup, operations, origin, conditions, confirmation, keys, page, wizard, prepare,
    changePreview: (next: RefinancingPreview) => { latestPreview = next; },
    changeHistoricalPreview: (next: RefinancingPreview) => { historicalPreview = next; } };
}

describe('refinancing wizard Step 3 transitions', () => {
  beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.effects = []; hooks.search = ''; hooks.navigate.mockReset(); hooks.setSearchParams.mockReset(); });

  it('preloads the linked origin through the existing preview selection flow without searching', async () => {
    const flow = setup();
    hooks.search = `loanId=${preview.loanId.toUpperCase()}`;
    flow.page();
    hooks.effects[0]();
    await vi.waitFor(() => expect(flow.origin.getSnapshot().originPreview).toEqual(preview));
    expect(flow.lookup.preview).toHaveBeenCalledExactlyOnceWith(preview.loanId);
    expect(flow.lookup.search).not.toHaveBeenCalled();
    flow.wizard().onClearSelection();
    expect(hooks.setSearchParams).toHaveBeenCalledWith(new URLSearchParams(), { replace: true });
    expect(flow.origin.getSnapshot().originLoanId).toBeNull();
  });

  it('enters confirmation only after valid Step 2, without POST; back retains data and payload changes rotate the key', async () => {
    const flow = setup(); const { origin, conditions, confirmation, operations, wizard } = flow;
    await origin.select(preview.loanId); wizard().onContinue();
    wizard().onContinueToConfirmation(); expect(origin.getSnapshot().step).toBe('CONDITIONS');
    expect(confirmation.getSnapshot().prepared).toBeNull();
    await vi.waitFor(() => expect(conditions.getSnapshot().optionsLoaded).toBe(true));
    conditions.setConditions({ refinancingDate: '2026-10-01', newMoney: '20000.00', newInterestAmount: '10000.00',
      paymentFrequencyId: 'daily', preferredPaymentMethodId: 'cash', disbursementPaymentMethodId: 'transfer', count: '2' });
    wizard().onContinueToConfirmation();
    expect(origin.getSnapshot().step).toBe('CONFIRMATION');
    expect(operations.confirm).not.toHaveBeenCalled();
    expect(confirmation.getSnapshot().prepared!.request.idempotencyKey).toBe('key-1');
    wizard().onBackToConditions(); expect(origin.getSnapshot().step).toBe('CONDITIONS');
    expect(conditions.getSnapshot().conditions.newMoney).toBe('20000.00');
    wizard().onContinueToConfirmation(); expect(confirmation.getSnapshot().prepared!.request.idempotencyKey).toBe('key-1');
    wizard().onBackToConditions(); conditions.setConditions({ observations: 'cambio contractual' });
    wizard().onContinueToConfirmation(); expect(confirmation.getSnapshot().prepared!.request.idempotencyKey).toBe('key-2');
  });

  it('recalculates and confirms loan 3 from the selected historical date without losing the draft', async () => {
    const flow = setup();
    const current: RefinancingPreview = { ...preview, loanNumber: '3', principal: '500000.00',
      interestAmount: '100000.00', totalAmount: '600000.00', paidAmount: '440000.00',
      paidPrincipal: '440000.00', outstandingPrincipal: '60000.00', outstandingInterest: '100000.00',
      financialBalance: '160000.00', pendingPlanAmount: '160000.00' };
    const historical = { ...current, paidAmount: '440040.00', paidPrincipal: '440040.00',
      outstandingPrincipal: '59960.00', financialBalance: '159960.00', pendingPlanAmount: '159960.00' };
    flow.changePreview(current); flow.changeHistoricalPreview(historical);
    await flow.origin.select(current.loanId); flow.wizard().onContinue();
    await vi.waitFor(() => expect(flow.conditions.getSnapshot().optionsLoaded).toBe(true));
    flow.conditions.setConditions({ newMoney: '340000.00', newInterestAmount: '100000.00',
      paymentFrequencyId: 'daily', preferredPaymentMethodId: 'cash', disbursementPaymentMethodId: 'transfer',
      count: '30', observations: 'Preserve draft' });
    await flow.conditions.setRefinancingDate('2026-09-26');
    expect(flow.conditions.evaluate()).toMatchObject({ principal: '499960.00', total: '599960.00', valid: true });
    flow.wizard().onContinueToConfirmation();
    const request = flow.confirmation.getSnapshot().prepared!.request;
    expect(request).toMatchObject({ refinancingDate: '2026-09-26', newMoney: '340000.00',
      newInterestAmount: '100000.00', observations: 'Preserve draft' });
    expect(request.plan).toHaveLength(30);
    expect(request.plan.reduce((sum, row) => sum + BigInt(row.pendingAmount.replace('.', '')), 0n)).toBe(59996000n);
    expect(request.plan.every((row) => new Date(`${row.dueDate}T00:00:00Z`).getUTCDay() !== 0)).toBe(true);
    flow.wizard().onConfirm(true);
    await vi.waitFor(() => expect(flow.operations.confirm).toHaveBeenCalledWith(request));
  });

  it('only submits from confirmation when permitted, locks double click, and starts a clean wizard after success', async () => {
    const flow = setup(); const { operations, origin, conditions, confirmation, keys, wizard, page, prepare } = flow;
    await prepare();
    wizard().onConfirm(false); expect(operations.confirm).not.toHaveBeenCalled();
    let finish!: (value: RefinancingResult) => void;
    vi.mocked(operations.confirm).mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const tryAgain = wizard().onConfirm;
    tryAgain(true); tryAgain(true);
    expect(operations.confirm).toHaveBeenCalledOnce();
    expect(confirmation.getSnapshot().submitting).toBe(true);
    wizard().onBackToConditions(); expect(origin.getSnapshot().step).toBe('CONFIRMATION');
    finish(result);
    await vi.waitFor(() => expect(confirmation.getSnapshot().result).toEqual(result));
    expect(hooks.navigate).toHaveBeenCalledWith('/loan-refinancings/ref-1', {
      replace: true, state: { createdRefinancing: result },
    });
    const success = page();
    expect(success.type).toBe(RefinancingResultView);
    expect((success.props as { result: RefinancingResult }).result).toBe(result);
    tryAgain(true); expect(operations.confirm).toHaveBeenCalledOnce();
    (success.props as { onNew: () => void }).onNew();
    expect(origin.getSnapshot()).toMatchObject({ step: 'ORIGIN', originLoanId: null, originPreview: null });
    expect(conditions.getSnapshot().conditions).toMatchObject({ newMoney: '0.00', customPlan: [] });
    expect(conditions.getSnapshot().preview).toBeNull();
    expect(confirmation.getSnapshot()).toEqual({ prepared: null, submitting: false, failure: null, result: null });
    expect(keys).toHaveBeenCalledOnce();
    expect(operations.confirm).toHaveBeenCalledOnce();
  });

  it('STALE_DATA fetches a new preview and invalidates the dependent plan/key before review', async () => {
    const flow = setup(); const { origin, conditions, confirmation, operations, changePreview, lookup, wizard, prepare } = flow;
    await prepare();
    conditions.setMode('personalized');
    changePreview({ ...preview, baseline: 'b'.repeat(64), outstandingPrincipal: '110000.00', financialBalance: '140000.00' });
    vi.mocked(operations.confirm).mockRejectedValueOnce(new HttpApiError(409, 'SQL internal', 'STALE_DATA'));
    wizard().onConfirm(true);
    await vi.waitFor(() => expect(origin.getSnapshot().originPreview?.baseline).toBe('b'.repeat(64)));
    expect(origin.getSnapshot().step).toBe('ORIGIN');
    expect(conditions.getSnapshot()).toMatchObject({ preview: null, conditions: { customPlan: [], mode: 'automatic' } });
    expect(confirmation.getSnapshot().prepared).toBeNull();
    expect(wizard().notice).toContain('Actualizamos la información');
    expect(lookup.preview).toHaveBeenCalledTimes(2);
    expect(operations.confirm).toHaveBeenCalledOnce();
  });

  it('ALREADY_REFINANCED clears the operation and returns to the candidate search without retry', async () => {
    const flow = setup(); await flow.prepare();
    vi.mocked(flow.operations.confirm).mockRejectedValueOnce(new HttpApiError(409, 'private', 'ALREADY_REFINANCED'));
    flow.wizard().onConfirm(true);
    await vi.waitFor(() => expect(flow.origin.getSnapshot().originLoanId).toBeNull());
    expect(flow.confirmation.getSnapshot().prepared).toBeNull();
    expect(flow.wizard().notice).toContain('ya fue refinanciado');
    expect(flow.operations.confirm).toHaveBeenCalledOnce();
    expect(flow.lookup.search).toHaveBeenCalledOnce();
  });

  it('CONCURRENT_REFINANCING refreshes context without automatically repeating POST', async () => {
    const flow = setup(); await flow.prepare();
    flow.changePreview({ ...preview, status: 'REFINANCED', eligible: false, baseline: 'b'.repeat(64) });
    vi.mocked(flow.operations.confirm).mockRejectedValueOnce(new HttpApiError(409, 'private', 'CONCURRENT_REFINANCING'));
    flow.wizard().onConfirm(true);
    await vi.waitFor(() => expect(flow.origin.getSnapshot().originPreview?.status).toBe('REFINANCED'));
    expect(flow.origin.canContinue()).toBe(false);
    expect(flow.conditions.getSnapshot().preview).toBeNull();
    expect(flow.confirmation.getSnapshot().prepared).toBeNull();
    expect(flow.operations.confirm).toHaveBeenCalledOnce();
  });

  it('IDEMPOTENCY_CONFLICT keeps the same key and requires explicit review of changed input', async () => {
    const flow = setup(); await flow.prepare();
    vi.mocked(flow.operations.confirm).mockRejectedValueOnce(new HttpApiError(409, 'private', 'IDEMPOTENCY_CONFLICT'));
    flow.wizard().onConfirm(true);
    await vi.waitFor(() => expect(flow.confirmation.getSnapshot().failure).toBe('IDEMPOTENCY_CONFLICT'));
    expect(flow.confirmation.getSnapshot().prepared!.request.idempotencyKey).toBe('key-1');
    expect(flow.operations.confirm).toHaveBeenCalledOnce();
    flow.wizard().onBackToConditions(); flow.wizard().onContinueToConfirmation();
    expect(flow.confirmation.getSnapshot().prepared!.request.idempotencyKey).toBe('key-1');
    expect(flow.keys).toHaveBeenCalledOnce();
  });

  it('404 returns to search; invalid, forbidden, network and server failures keep the prepared request safe', async () => {
    for (const [error, expected] of [
      [new HttpApiError(400, 'private'), 'INVALID'], [new HttpApiError(403, 'private'), 'FORBIDDEN'],
      [new TypeError('offline'), 'NETWORK'], [new HttpApiError(500, 'private'), 'SERVER'],
    ] as const) {
      hooks.values = []; hooks.refs = [];
      const flow = setup(); await flow.prepare();
      vi.mocked(flow.operations.confirm).mockRejectedValueOnce(error);
      flow.wizard().onConfirm(true);
      await vi.waitFor(() => expect(flow.confirmation.getSnapshot().failure).toBe(expected));
      expect(flow.origin.getSnapshot().step).toBe('CONFIRMATION');
      expect(flow.confirmation.getSnapshot().prepared!.request.idempotencyKey).toBe('key-1');
      expect(JSON.stringify(flow.confirmation.getSnapshot())).not.toContain('private');
    }
    hooks.values = []; hooks.refs = [];
    const missing = setup(); await missing.prepare();
    vi.mocked(missing.operations.confirm).mockRejectedValueOnce(new HttpApiError(404, 'private'));
    missing.wizard().onConfirm(true);
    await vi.waitFor(() => expect(missing.origin.getSnapshot().originLoanId).toBeNull());
    expect(missing.wizard().notice).toContain('ya no está disponible');
  });
});
