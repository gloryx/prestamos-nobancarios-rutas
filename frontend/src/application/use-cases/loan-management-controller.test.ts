import { describe, expect, it, vi } from 'vitest';
import type { LoanManagementResult, LoanManagementRow, OverdueLoan, UncollectibleLoan } from '../../domain/entities/loan';
import { LoanManagementController, type LoanManagementPort, type LoanOperation } from './loan-management-controller';

const base: LoanManagementRow = { loanId: 'loan-1', loanNumber: '42', customer: { id: 'c', identification: '123', fullName: 'Ana' },
  startDate: '2026-01-01', principal: '99.00', interestAmount: '1.00', totalAmount: '100.00', recoveredAmount: '10.00', financialBalance: '90.00' };
const overdue: OverdueLoan = { ...base, firstOverdueDueDate: '2026-02-01', firstOverdueAmount: '20.00', status: 'ACTIVE', canMarkUncollectible: true };
const uncollectible: UncollectibleLoan = { ...base, uncollectibleAt: '2026-03-01T01:00:00.000000Z', uncollectibleBusinessDate: '2026-02-28',
  uncollectibleReason: 'Review', changedByUserId: 'user-1', status: 'UNCOLLECTIBLE' };
const summary = { total: 31, lentAmount: '99999999999999999.01', recoveredAmount: '17.02', pendingAmount: '44.03' };
const page = <Row extends LoanManagementRow>(items: Row[], total = 31, number = 1): LoanManagementResult<Row> =>
  ({ items, total, page: number, pageSize: 20, summary });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(canAttempt: (operation: LoanOperation) => boolean = () => true) {
  const api = {
    getOverdueLoans: vi.fn<LoanManagementPort['getOverdueLoans']>(async (query) => page([overdue], 31, query.page)),
    getUncollectibleLoans: vi.fn<LoanManagementPort['getUncollectibleLoans']>(async (query) => page([uncollectible], 31, query.page)),
    markLoanUncollectible: vi.fn<LoanManagementPort['markLoanUncollectible']>(async () => ({ loanId: 'loan-1', status: 'UNCOLLECTIBLE', event: { id: 'event', sequence: 2, changedAt: 'now' } })),
    reactivateLoan: vi.fn<LoanManagementPort['reactivateLoan']>(async () => ({ loanId: 'loan-1', status: 'ACTIVE', event: { id: 'event', sequence: 3, changedAt: 'now' } })),
  };
  let keys = 0;
  const controller = new LoanManagementController(api, () => `key-${++keys}`, canAttempt);
  return { api, controller };
}
async function loadOverdue(controller: LoanManagementController) {
  controller.setActiveTab('OVERDUE');
  await tick();
}

describe('loan management controller', () => {
  it('starts on uncollectible, fetches only the active endpoint, publishes immutable snapshots and requires injected permission', async () => {
    const { controller, api } = setup(() => false);
    const initial = controller.getSnapshot(); const listener = vi.fn(); const unsubscribe = controller.subscribe(listener);
    expect(api.getOverdueLoans).not.toHaveBeenCalled(); expect(api.getUncollectibleLoans).not.toHaveBeenCalled();
    expect(initial).toMatchObject({ activeTab: 'UNCOLLECTIBLE', page: 1, pageSize: 20, loading: false,
      sorts: { OVERDUE: { sortBy: 'firstOverdueDueDate', sortDir: 'asc' }, UNCOLLECTIBLE: { sortBy: 'uncollectibleDate', sortDir: 'desc' } } });
    expect(controller.beginAttempt('REACTIVATE', uncollectible)).toBe(false);
    expect(await controller.load()).toBe(true);
    expect(api.getUncollectibleLoans).toHaveBeenCalledWith({ page: 1, pageSize: 20, sortBy: 'uncollectibleDate', sortDir: 'desc' });
    expect(api.getOverdueLoans).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ items: [uncollectible], summary, total: 31, dataPage: 1 });
    expect(initial.items).toEqual([]); expect(initial.summary).toBeNull(); expect(listener).toHaveBeenCalled();
    unsubscribe(); listener.mockClear(); controller.setSearch('other'); await tick(); expect(listener).not.toHaveBeenCalled();
  });

  it('uses server filters, pages and tab-specific sort state without recomputing backend totals', async () => {
    const { controller, api } = setup();
    await loadOverdue(controller); controller.setSearch(' Ana '); await tick(); controller.setStartDate('2026-01-01'); await tick();
    controller.setEndDate('2026-09-29'); await tick(); controller.setPage(2); await tick();
    expect(api.getOverdueLoans).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, search: 'Ana', startDate: '2026-01-01', endDate: '2026-09-29', sortBy: 'firstOverdueDueDate', sortDir: 'asc' });
    expect(controller.getSnapshot()).toMatchObject({ total: 31, summary, page: 2 });
    controller.sortOverdue('principal'); await tick(); expect(controller.getSnapshot().page).toBe(1);
    controller.sortOverdue('principal'); await tick(); expect(controller.getSnapshot().sorts.OVERDUE).toEqual({ sortBy: 'principal', sortDir: 'desc' });
    controller.setActiveTab('UNCOLLECTIBLE'); await tick();
    expect(api.getUncollectibleLoans).toHaveBeenCalledWith({ page: 1, pageSize: 20, search: 'Ana', startDate: '2026-01-01', endDate: '2026-09-29', sortBy: 'uncollectibleDate', sortDir: 'desc' });
    controller.sortUncollectible('uncollectibleDate'); await tick();
    expect(api.getUncollectibleLoans).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'uncollectibleDate', sortDir: 'asc' }));
    controller.setPageSize(50); await tick(); expect(api.getUncollectibleLoans).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50, page: 1 }));
    controller.setActiveTab('OVERDUE'); await tick();
    expect(api.getOverdueLoans).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'principal', sortDir: 'desc', pageSize: 20 }));
    expect(controller.getSnapshot().summary).toBe(summary);
  });

  it('refreshes the current query independently, keeping the last complete snapshot on failure', async () => {
    const { controller, api } = setup(); await loadOverdue(controller); controller.setPage(2); await tick();
    const last = controller.getSnapshot(); const pending = deferred<LoanManagementResult<OverdueLoan>>();
    api.getOverdueLoans.mockImplementationOnce(() => pending.promise);
    const refreshing = controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({ loading: false, refreshing: true, items: last.items, summary, total: 31 });
    expect(api.getOverdueLoans).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, sortDir: 'asc' }));
    pending.reject(new Error('Refresh unavailable'));
    expect(await refreshing).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ loading: false, refreshing: false, error: 'Refresh unavailable', items: last.items, summary, total: 31, dataPage: 2 });
    expect(await controller.refresh()).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ error: null, summary, total: 31 });
    expect(api.getOverdueLoans).toHaveBeenCalledTimes(4);
  });

  it('clamps a vanished page once without publishing the invalid response; second-fetch failure retains the last complete data', async () => {
    const { controller, api } = setup(); await loadOverdue(controller); const last = controller.getSnapshot();
    const retry = deferred<LoanManagementResult<OverdueLoan>>();
    api.getOverdueLoans.mockResolvedValueOnce(page([], 0, 30)).mockImplementationOnce(() => retry.promise);
    controller.setPage(30); await tick();
    expect(controller.getSnapshot()).toMatchObject({ page: 1, dataPage: 1, items: last.items, summary, total: 31, loading: true });
    expect(api.getOverdueLoans.mock.calls.slice(-2).map(([query]) => query.page)).toEqual([30, 1]);
    retry.reject(new Error('Second GET failed')); await tick();
    expect(controller.getSnapshot()).toMatchObject({ page: 1, dataPage: 1, items: last.items, summary, total: 31, loading: false, error: 'Second GET failed' });
    expect(api.getOverdueLoans).toHaveBeenCalledTimes(3);
    api.getOverdueLoans.mockResolvedValueOnce(page([], 31, 30)).mockResolvedValueOnce(page([overdue], 31, 2));
    controller.setPage(30); await tick();
    expect(controller.getSnapshot()).toMatchObject({ page: 2, dataPage: 2, items: [overdue], total: 31 });
    expect(api.getOverdueLoans).toHaveBeenCalledTimes(5);
  });

  it('refetches only page one for an emptied filtered result, and stops after a second shrink', async () => {
    const { controller, api } = setup(); await loadOverdue(controller);
    api.getOverdueLoans.mockResolvedValueOnce(page([], 0, 30)).mockResolvedValueOnce(page([], 0, 1));
    controller.setPage(30); await tick();
    expect(controller.getSnapshot()).toMatchObject({ page: 1, dataPage: 1, total: 0, items: [], summary, error: null });
    expect(api.getOverdueLoans.mock.calls.slice(-2).map(([query]) => query.page)).toEqual([30, 1]);
    api.getOverdueLoans.mockResolvedValueOnce(page([], 31, 30)).mockResolvedValueOnce(page([], 0, 2));
    controller.setPage(30); await tick();
    expect(controller.getSnapshot()).toMatchObject({ error: 'Loan page changed during refresh. Try again.', dataPage: 1, total: 0 });
    expect(api.getOverdueLoans).toHaveBeenCalledTimes(5);
  });

  it('ignores stale results and stale errors after tab or filter changes', async () => {
    const { controller, api } = setup();
    await loadOverdue(controller);
    const late = deferred<LoanManagementResult<OverdueLoan>>(); api.getOverdueLoans.mockImplementationOnce(() => late.promise);
    const first = controller.load(); controller.setActiveTab('UNCOLLECTIBLE'); await tick();
    late.resolve(page([overdue])); expect(await first).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ activeTab: 'UNCOLLECTIBLE', items: [uncollectible], summary });
    const stale = deferred<LoanManagementResult<UncollectibleLoan>>(); api.getUncollectibleLoans.mockImplementationOnce(() => stale.promise);
    const refresh = controller.refresh(); controller.setSearch('new filter'); await tick();
    stale.reject(new Error('Old failure')); expect(await refresh).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ activeTab: 'UNCOLLECTIBLE', search: 'new filter', error: null, items: [uncollectible] });
  });

  it('requires trimmed reason, locks duplicate submissions synchronously, and changes rows only from a refreshed backend reply', async () => {
    const { controller, api } = setup((operation) => operation === 'MARK'); await loadOverdue(controller);
    expect(controller.beginAttempt('MARK', overdue)).toBe(true); controller.setReason('   ');
    expect(await controller.submit()).toBe(false); expect(api.markLoanUncollectible).not.toHaveBeenCalled();
    expect(controller.getSnapshot().actionAttempt?.error).toBe('A reason is required.');
    controller.setReason('  Review  ');
    const pending = deferred<LoanManagementResult<OverdueLoan>>();
    api.getOverdueLoans.mockImplementationOnce(() => pending.promise);
    const first = controller.submit(); expect(controller.getSnapshot().actionAttempt?.submitting).toBe(true);
    expect(await controller.submit()).toBe(false); expect(controller.beginAttempt('MARK', overdue)).toBe(false);
    await tick(); expect(controller.getSnapshot().items).toEqual([overdue]); expect(controller.getSnapshot().successMessage).toBeNull();
    pending.resolve(page([], 0)); expect(await first).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ items: [], total: 0, summary, actionAttempt: null, successMessage: 'Loan marked uncollectible.' });
    expect(api.markLoanUncollectible).toHaveBeenCalledTimes(1);
    expect(api.markLoanUncollectible).toHaveBeenCalledWith('loan-1', { reason: 'Review', idempotencyKey: 'key-1' });
    controller.setActiveTab('UNCOLLECTIBLE'); await tick(); expect(controller.beginAttempt('REACTIVATE', uncollectible)).toBe(false);
  });

  it('retains the key after an ambiguous POST, but changes it for a different reason, attempt or operation', async () => {
    const { controller, api } = setup(); await loadOverdue(controller); controller.beginAttempt('MARK', overdue); controller.setReason(' Review ');
    api.markLoanUncollectible.mockRejectedValueOnce(new TypeError('Network failed'));
    expect(await controller.submit()).toBe(false);
    expect(controller.getSnapshot().actionAttempt).toMatchObject({ key: 'key-1', error: 'Network failed', submitting: false });
    expect(api.getOverdueLoans).toHaveBeenCalledTimes(2);
    controller.setReason('Review   '); expect(await controller.submit()).toBe(true);
    expect(api.markLoanUncollectible.mock.calls.map(([, body]) => body)).toEqual([
      { reason: 'Review', idempotencyKey: 'key-1' }, { reason: 'Review', idempotencyKey: 'key-1' },
    ]);
    controller.beginAttempt('MARK', overdue); controller.setReason('Other'); await controller.submit();
    expect(api.markLoanUncollectible.mock.lastCall?.[1].idempotencyKey).toBe('key-2');
    controller.setActiveTab('UNCOLLECTIBLE'); await tick(); controller.beginAttempt('REACTIVATE', uncollectible);
    controller.setReason('Other'); await controller.submit();
    expect(api.reactivateLoan.mock.lastCall?.[1]).toEqual({ reason: 'Other', idempotencyKey: 'key-3' });
    controller.beginAttempt('REACTIVATE', uncollectible); controller.setReason('A');
    api.reactivateLoan.mockRejectedValueOnce(new TypeError('Lost reply')); await controller.submit();
    controller.setReason('B'); expect(controller.getSnapshot().actionAttempt?.key).toBeNull();
    await controller.submit(); expect(api.reactivateLoan.mock.lastCall?.[1].idempotencyKey).toBe('key-5');
    controller.beginAttempt('REACTIVATE', uncollectible); controller.setReason('C'); controller.abandon();
    expect(controller.getSnapshot().actionAttempt).toBeNull();
    controller.setActiveTab('OVERDUE'); await tick();
    controller.beginAttempt('MARK', { ...overdue, loanId: 'loan-2' }); controller.setReason('Other'); await controller.submit();
    expect(api.markLoanUncollectible.mock.lastCall).toEqual(['loan-2', { reason: 'Other', idempotencyKey: 'key-6' }]);
  });

  it('retains an accepted POST attempt after failed GET, then reuses its key on retry without false success', async () => {
    const { controller, api } = setup(); await loadOverdue(controller); controller.beginAttempt('MARK', overdue); controller.setReason('Review');
    api.getOverdueLoans.mockRejectedValueOnce(new Error('List unavailable'));
    expect(await controller.submit()).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ items: [overdue], summary, total: 31, error: 'List unavailable', successMessage: null,
      actionAttempt: { key: 'key-1', submitting: false, error: 'The transition was received, but the loan list could not be refreshed.' } });
    api.getOverdueLoans.mockResolvedValueOnce(page([], 0));
    expect(await controller.submit()).toBe(true);
    expect(api.markLoanUncollectible.mock.calls.map(([, body]) => body.idempotencyKey)).toEqual(['key-1', 'key-1']);
    expect(controller.getSnapshot()).toMatchObject({ items: [], summary, total: 0, actionAttempt: null, successMessage: 'Loan marked uncollectible.' });
  });

  it('keeps a controlled POST rejection visible and refreshes the CURRENT tab even across an in-flight action race', async () => {
    const { controller, api } = setup(); await loadOverdue(controller); controller.beginAttempt('MARK', overdue); controller.setReason('Review');
    const pending = deferred<Awaited<ReturnType<LoanManagementPort['markLoanUncollectible']>>>();
    api.markLoanUncollectible.mockImplementationOnce(() => pending.promise);
    const submission = controller.submit(); controller.setActiveTab('UNCOLLECTIBLE'); await tick();
    api.getUncollectibleLoans.mockResolvedValueOnce(page([], 0));
    pending.reject(new Error('The loan changed during the operation.'));
    expect(await submission).toBe(false);
    expect(api.getUncollectibleLoans).toHaveBeenCalledTimes(2);
    expect(api.getOverdueLoans).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ activeTab: 'UNCOLLECTIBLE', items: [], total: 0, successMessage: null,
      actionAttempt: { key: 'key-1', error: 'The loan changed during the operation.', submitting: false } });
    expect(await controller.submit()).toBe(true);
    expect(api.markLoanUncollectible.mock.calls.map(([, body]) => body.idempotencyKey)).toEqual(['key-1', 'key-1']);
  });

  it('refreshes the newly active tab when a pending POST is accepted after switching tabs', async () => {
    const { controller, api } = setup(); await loadOverdue(controller); controller.beginAttempt('MARK', overdue); controller.setReason('Review');
    const pending = deferred<Awaited<ReturnType<LoanManagementPort['markLoanUncollectible']>>>();
    api.markLoanUncollectible.mockImplementationOnce(() => pending.promise);
    const submission = controller.submit(); controller.setActiveTab('UNCOLLECTIBLE'); await tick();
    pending.resolve({ loanId: 'loan-1', status: 'UNCOLLECTIBLE', event: { id: 'event', sequence: 2, changedAt: 'now' } });
    expect(await submission).toBe(true);
    expect(api.getOverdueLoans).toHaveBeenCalledTimes(1); expect(api.getUncollectibleLoans).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({ activeTab: 'UNCOLLECTIBLE', items: [uncollectible], summary, actionAttempt: null,
      successMessage: 'Loan marked uncollectible.' });
  });

  it('preserves a rejected POST message if its recovery GET also fails', async () => {
    const { controller, api } = setup(); await loadOverdue(controller); controller.beginAttempt('MARK', overdue); controller.setReason('Review');
    api.markLoanUncollectible.mockRejectedValueOnce(new Error('Backend conflict'));
    api.getOverdueLoans.mockRejectedValueOnce(new Error('GET unavailable'));
    expect(await controller.submit()).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ items: [overdue], summary, error: 'GET unavailable', successMessage: null,
      actionAttempt: { key: 'key-1', error: 'Backend conflict', submitting: false } });
  });

  it('does not report success when a successful POST refresh is superseded by a tab change', async () => {
    const { controller, api } = setup(); await loadOverdue(controller); controller.beginAttempt('MARK', overdue); controller.setReason('Review');
    const pending = deferred<LoanManagementResult<OverdueLoan>>(); api.getOverdueLoans.mockImplementationOnce(() => pending.promise);
    const submission = controller.submit(); await tick();
    expect(controller.getSnapshot()).toMatchObject({ activeTab: 'OVERDUE', refreshing: true, items: [overdue], successMessage: null });
    controller.setActiveTab('UNCOLLECTIBLE'); await tick();
    pending.resolve(page([], 0)); expect(await submission).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ activeTab: 'UNCOLLECTIBLE', items: [uncollectible], successMessage: null,
      actionAttempt: { key: 'key-1', submitting: false } });
    expect(api.getUncollectibleLoans).toHaveBeenCalledTimes(1);
  });
});
