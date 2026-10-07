import type { LoanManagementCustomer, LoanManagementPageSize, LoanManagementQuery, LoanManagementResult, LoanManagementSortDir, LoanManagementSummary, LoanManagementTab, LoanTransitionBody, LoanTransitionReply, OverdueLoan, OverdueLoanSort, UncollectibleLoan, UncollectibleLoanSort } from '../../domain/entities/loan';

export type LoanOperation = 'MARK' | 'REACTIVATE';
export type LoanAttempt = Readonly<{ operation: LoanOperation; selectedLoan: Readonly<{ loanId: string; loanNumber: string; customer: Readonly<LoanManagementCustomer> }>;
  reasonDraft: string; key: string | null; fingerprint: string | null; submitting: boolean; error: string | null }>;
export type LoanManagementState = Readonly<{
  activeTab: LoanManagementTab; search: string; startDate: string; endDate: string; page: number; pageSize: LoanManagementPageSize;
  sorts: Readonly<{ OVERDUE: Readonly<{ sortBy: OverdueLoanSort; sortDir: LoanManagementSortDir }>;
    UNCOLLECTIBLE: Readonly<{ sortBy: UncollectibleLoanSort; sortDir: LoanManagementSortDir }> }>;
  items: ReadonlyArray<OverdueLoan | UncollectibleLoan>; summary: Readonly<LoanManagementSummary> | null; total: number; dataPage: number | null;
  loading: boolean; refreshing: boolean; error: string | null; successMessage: string | null; actionAttempt: LoanAttempt | null;
}>;
export interface LoanManagementPort {
  getOverdueLoans(query: LoanManagementQuery<OverdueLoanSort>): Promise<LoanManagementResult<OverdueLoan>>;
  getUncollectibleLoans(query: LoanManagementQuery<UncollectibleLoanSort>): Promise<LoanManagementResult<UncollectibleLoan>>;
  markLoanUncollectible(id: string, body: LoanTransitionBody): Promise<LoanTransitionReply<'UNCOLLECTIBLE'>>;
  reactivateLoan(id: string, body: LoanTransitionBody): Promise<LoanTransitionReply<'ACTIVE'>>;
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Unable to complete the request.';

export class LoanManagementController {
  private state: LoanManagementState = { activeTab: 'UNCOLLECTIBLE', search: '', startDate: '', endDate: '', page: 1, pageSize: 20,
    sorts: { OVERDUE: { sortBy: 'firstOverdueDueDate', sortDir: 'asc' }, UNCOLLECTIBLE: { sortBy: 'uncollectibleDate', sortDir: 'desc' } },
    items: [], summary: null, total: 0, dataPage: null, loading: false, refreshing: false, error: null, successMessage: null, actionAttempt: null };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private submitting = false;

  constructor(private readonly api: LoanManagementPort, private readonly generateKey: () => string,
    private readonly canAttempt: (operation: LoanOperation) => boolean = () => false) {}

  getSnapshot = (): LoanManagementState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: LoanManagementState): void { this.state = next; this.listeners.forEach((listener) => listener()); }

  private fetch(tab: LoanManagementTab, page: number) {
    const { search, startDate, endDate, pageSize, sorts } = this.state;
    const filters = { page, pageSize, ...(search.trim() ? { search: search.trim() } : {}),
      ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) };
    return tab === 'OVERDUE'
      ? this.api.getOverdueLoans({ ...filters, ...sorts.OVERDUE })
      : this.api.getUncollectibleLoans({ ...filters, ...sorts.UNCOLLECTIBLE });
  }

  private async request(refreshing: boolean): Promise<boolean> {
    const token = ++this.generation;
    const { activeTab, page } = this.state;
    this.publish({ ...this.state, loading: !refreshing, refreshing, error: null });
    try {
      let result = await this.fetch(activeTab, page);
      if (token !== this.generation) return false;
      const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (page > lastPage) {
        this.publish({ ...this.state, page: lastPage });
        result = await this.fetch(activeTab, lastPage);
        if (token !== this.generation) return false;
      }
      if (result.page !== this.state.page || result.page > Math.max(1, Math.ceil(result.total / result.pageSize))) {
        throw new Error('Loan page changed during refresh. Try again.');
      }
      this.publish({ ...this.state, items: result.items, summary: result.summary, total: result.total, dataPage: result.page,
        page: result.page, pageSize: result.pageSize, loading: false, refreshing: false, error: null });
      return token === this.generation;
    } catch (cause) {
      if (token === this.generation) this.publish({ ...this.state, loading: false, refreshing: false, error: message(cause) });
      return false;
    }
  }

  load = (): Promise<boolean> => this.request(false);
  refresh = (): Promise<boolean> => this.request(true);
  setActiveTab(tab: LoanManagementTab): void {
    if (tab === this.state.activeTab) return;
    this.publish({ ...this.state, activeTab: tab, page: 1, items: [], summary: null, total: 0, dataPage: null, successMessage: null });
    void this.load();
  }
  private updateFilters(filters: Partial<Pick<LoanManagementState, 'search' | 'startDate' | 'endDate'>>): void {
    if (Object.entries(filters).every(([key, value]) => this.state[key as keyof typeof filters] === value)) return;
    this.publish({ ...this.state, ...filters, page: 1, successMessage: null });
    void this.load();
  }
  setSearch(value: string): void { this.updateFilters({ search: value }); }
  setStartDate(value: string): void { this.updateFilters({ startDate: value }); }
  setEndDate(value: string): void { this.updateFilters({ endDate: value }); }
  setPage(page: number): void {
    if (!Number.isSafeInteger(page) || page < 1 || page === this.state.page) return;
    this.publish({ ...this.state, page }); void this.load();
  }
  setPageSize(pageSize: LoanManagementPageSize): void {
    if (pageSize === this.state.pageSize) return;
    this.publish({ ...this.state, pageSize, page: 1 }); void this.load();
  }
  sortOverdue(column: OverdueLoanSort): void {
    if (this.state.activeTab !== 'OVERDUE') return;
    const current = this.state.sorts.OVERDUE;
    this.publish({ ...this.state, page: 1, sorts: { ...this.state.sorts,
      OVERDUE: { sortBy: column, sortDir: current.sortBy === column && current.sortDir === 'asc' ? 'desc' : 'asc' } } });
    void this.load();
  }
  sortUncollectible(column: UncollectibleLoanSort): void {
    if (this.state.activeTab !== 'UNCOLLECTIBLE') return;
    const current = this.state.sorts.UNCOLLECTIBLE;
    this.publish({ ...this.state, page: 1, sorts: { ...this.state.sorts,
      UNCOLLECTIBLE: { sortBy: column, sortDir: current.sortBy === column && current.sortDir === 'asc' ? 'desc' : 'asc' } } });
    void this.load();
  }

  beginAttempt(operation: LoanOperation, loan: OverdueLoan | UncollectibleLoan): boolean {
    if (this.submitting || !this.canAttempt(operation) ||
      (operation === 'MARK' ? this.state.activeTab !== 'OVERDUE' || loan.status !== 'ACTIVE' || !loan.canMarkUncollectible
        : this.state.activeTab !== 'UNCOLLECTIBLE' || loan.status !== 'UNCOLLECTIBLE')) return false;
    this.publish({ ...this.state, successMessage: null, actionAttempt: { operation,
      selectedLoan: { loanId: loan.loanId, loanNumber: loan.loanNumber, customer: { ...loan.customer } },
      reasonDraft: '', key: null, fingerprint: null, submitting: false, error: null } });
    return true;
  }
  abandon(): void {
    if (this.submitting || !this.state.actionAttempt) return;
    this.publish({ ...this.state, actionAttempt: null });
  }
  setReason(reasonDraft: string): void {
    const attempt = this.state.actionAttempt;
    if (this.submitting || !attempt) return;
    const changed = reasonDraft.trim() !== attempt.reasonDraft.trim();
    this.publish({ ...this.state, actionAttempt: { ...attempt, reasonDraft,
      key: changed ? null : attempt.key, fingerprint: changed ? null : attempt.fingerprint, error: null } });
  }
  async submit(): Promise<boolean> {
    if (this.submitting) return false;
    const attempt = this.state.actionAttempt;
    if (!attempt || !this.canAttempt(attempt.operation)) return false;
    const reason = attempt.reasonDraft.trim();
    if (!reason) {
      this.publish({ ...this.state, actionAttempt: { ...attempt, error: 'A reason is required.' } });
      return false;
    }
    this.submitting = true;
    const fingerprint = JSON.stringify({ operation: attempt.operation, loanId: attempt.selectedLoan.loanId, reason });
    const key = attempt.fingerprint === fingerprint && attempt.key ? attempt.key : this.generateKey();
    this.publish({ ...this.state, successMessage: null, actionAttempt: { ...attempt, fingerprint, key, submitting: true, error: null } });
    try {
      const body = { reason, idempotencyKey: key };
      if (attempt.operation === 'MARK') await this.api.markLoanUncollectible(attempt.selectedLoan.loanId, body);
      else await this.api.reactivateLoan(attempt.selectedLoan.loanId, body);
      if (!await this.refresh()) {
        this.publish({ ...this.state, actionAttempt: { ...this.state.actionAttempt!, error: 'The transition was received, but the loan list could not be refreshed.' } });
        return false;
      }
      this.publish({ ...this.state, actionAttempt: null,
        successMessage: attempt.operation === 'MARK' ? 'Loan marked uncollectible.' : 'Loan reactivated.' });
      return true;
    } catch (cause) {
      this.publish({ ...this.state, actionAttempt: { ...this.state.actionAttempt!, error: message(cause) } });
      await this.refresh();
      return false;
    } finally {
      this.submitting = false;
      if (this.state.actionAttempt?.submitting) this.publish({ ...this.state,
        actionAttempt: { ...this.state.actionAttempt, submitting: false } });
    }
  }
}
