import type { AnnullableLoanItem, AnnulledLoanItem, AnnulmentQuery, AnnulmentResult, AnnulmentSort, AnnulmentSummary, LoanAnnulmentBody, LoanAnnulmentReceipt, LoanManagementPageSize } from '../../domain/entities/loan';

export type AnnulmentTab = 'CANDIDATES' | 'ANNULLED';
export type CandidateSort = Exclude<AnnulmentSort, 'annulledDate'>;
export interface LoanAnnulmentPort {
  getAnnullableLoans(query: AnnulmentQuery<CandidateSort>): Promise<AnnulmentResult<AnnullableLoanItem>>;
  getAnnulledLoans(query: AnnulmentQuery<AnnulmentSort>): Promise<AnnulmentResult<AnnulledLoanItem>>;
  annulLoan(id: string, body: LoanAnnulmentBody): Promise<LoanAnnulmentReceipt>;
}
export type AnnulmentAttempt = Readonly<{ loan: AnnullableLoanItem; reasonDraft: string;
  resolution: LoanAnnulmentBody['disbursementResolution'] | null; key: string | null;
  submitting: boolean; error: string | null }>;
export type LoanAnnulmentState = Readonly<{
  activeTab: AnnulmentTab; search: string; startDate: string; endDate: string; page: number; pageSize: LoanManagementPageSize;
  sorts: Readonly<{ CANDIDATES: Readonly<{ sortBy: CandidateSort; sortDir: 'asc' | 'desc' }>;
    ANNULLED: Readonly<{ sortBy: AnnulmentSort; sortDir: 'asc' | 'desc' }> }>;
  items: ReadonlyArray<AnnullableLoanItem | AnnulledLoanItem>; total: number; summary: AnnulmentSummary | null;
  dataTab: AnnulmentTab | null; dataPage: number | null; loading: boolean; refreshing: boolean; error: string | null;
  attempt: AnnulmentAttempt | null; feedback: { kind: 'success' | 'error'; message: string } | null;
}>;

export class LoanAnnulmentController {
  private state: LoanAnnulmentState = { activeTab: 'CANDIDATES', search: '', startDate: '', endDate: '', page: 1, pageSize: 20,
    sorts: { CANDIDATES: { sortBy: 'loanNumber', sortDir: 'desc' }, ANNULLED: { sortBy: 'annulledDate', sortDir: 'desc' } },
    items: [], total: 0, summary: null, dataTab: null, dataPage: null, loading: false, refreshing: false, error: null,
    attempt: null, feedback: null };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private submitting = false;

  constructor(private readonly api: LoanAnnulmentPort, private readonly generateKey: () => string,
    private readonly canAnnul: () => boolean) {}
  getSnapshot = (): LoanAnnulmentState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: LoanAnnulmentState) { this.state = next; this.listeners.forEach((listener) => listener()); }

  private fetch(tab: AnnulmentTab, page: number) {
    const { search, startDate, endDate, pageSize, sorts } = this.state;
    const filters = { page, pageSize, ...(search.trim() ? { search: search.trim() } : {}),
      ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) };
    return tab === 'CANDIDATES' ? this.api.getAnnullableLoans({ ...filters, ...sorts.CANDIDATES })
      : this.api.getAnnulledLoans({ ...filters, ...sorts.ANNULLED });
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
      this.publish({ ...this.state, items: result.items, total: result.total, summary: result.summary,
        page: result.page, pageSize: result.pageSize, dataPage: result.page, dataTab: activeTab,
        loading: false, refreshing: false, error: null });
      return true;
    } catch (cause) {
      if (token === this.generation) this.publish({ ...this.state, loading: false, refreshing: false,
        error: cause instanceof Error ? cause.message : 'No se pudieron cargar los préstamos.' });
      return false;
    }
  }
  load = () => this.request(false);
  refresh = () => this.request(true);
  setActiveTab(tab: AnnulmentTab) {
    if (tab === this.state.activeTab) return;
    if (this.submitting) return;
    this.publish({ ...this.state, activeTab: tab, page: 1, items: [], total: 0, summary: null, dataTab: null, dataPage: null,
      error: null, attempt: null, feedback: null });
    void this.load();
  }
  private setFilter(field: 'search' | 'startDate' | 'endDate', value: string) {
    if (this.state[field] === value) return;
    this.publish({ ...this.state, [field]: value, page: 1 });
    void this.load();
  }
  setSearch(value: string) { this.setFilter('search', value); }
  setStartDate(value: string) { this.setFilter('startDate', value); }
  setEndDate(value: string) { this.setFilter('endDate', value); }
  setPage(page: number) {
    if (!Number.isSafeInteger(page) || page < 1 || page === this.state.page) return;
    this.publish({ ...this.state, page }); void this.load();
  }
  setPageSize(pageSize: LoanManagementPageSize) {
    if (pageSize === this.state.pageSize) return;
    this.publish({ ...this.state, pageSize, page: 1 }); void this.load();
  }
  sort(column: AnnulmentSort) {
    const { activeTab, sorts } = this.state;
    if (activeTab === 'CANDIDATES') {
      if (column === 'annulledDate') return;
      const current = sorts.CANDIDATES;
      this.publish({ ...this.state, page: 1, sorts: { ...sorts, CANDIDATES: { sortBy: column,
        sortDir: current.sortBy === column && current.sortDir === 'asc' ? 'desc' : 'asc' } } });
    } else {
      const current = sorts.ANNULLED;
      this.publish({ ...this.state, page: 1, sorts: { ...sorts, ANNULLED: { sortBy: column,
        sortDir: current.sortBy === column && current.sortDir === 'asc' ? 'desc' : 'asc' } } });
    }
    void this.load();
  }
  begin(loan: AnnullableLoanItem): boolean {
    if (this.submitting || !this.canAnnul() || this.state.activeTab !== 'CANDIDATES' || loan.status !== 'ACTIVE' ||
      !this.state.items.some((item) => item.loanId === loan.loanId)) return false;
    this.publish({ ...this.state, attempt: { loan, reasonDraft: '', resolution: null, key: null, submitting: false, error: null }, feedback: null });
    return true;
  }
  abandon(): void {
    if (this.submitting || !this.state.attempt) return;
    this.publish({ ...this.state, attempt: null });
  }
  setReason(reasonDraft: string): void {
    const attempt = this.state.attempt;
    if (!attempt || this.submitting) return;
    this.publish({ ...this.state, attempt: { ...attempt, reasonDraft,
      key: attempt.reasonDraft.trim() === reasonDraft.trim() ? attempt.key : null, error: null } });
  }
  setResolution(resolution: AnnulmentAttempt['resolution']): void {
    const attempt = this.state.attempt;
    if (!attempt || this.submitting) return;
    this.publish({ ...this.state, attempt: { ...attempt, resolution,
      key: attempt.resolution === resolution ? attempt.key : null, error: null } });
  }
  async submit(): Promise<boolean> {
    if (this.submitting || !this.canAnnul()) return false;
    const attempt = this.state.attempt;
    const reason = attempt?.reasonDraft.trim() ?? '';
    if (!attempt || this.state.activeTab !== 'CANDIDATES' || !attempt.resolution || !reason || reason.length > 500) return false;
    this.submitting = true;
    const key = attempt.key ?? this.generateKey();
    this.publish({ ...this.state, attempt: { ...attempt, key, submitting: true, error: null }, feedback: null });
    try {
      await this.api.annulLoan(attempt.loan.loanId, { reason, disbursementResolution: attempt.resolution, idempotencyKey: key });
      this.publish({ ...this.state, activeTab: 'ANNULLED', page: 1, items: [], total: 0, summary: null,
        dataTab: null, dataPage: null, attempt: null,
        feedback: { kind: 'success', message: 'Préstamo anulado correctamente.' } });
      await this.load();
      return true;
    } catch (cause) {
      const status = cause && typeof cause === 'object' && 'status' in cause && typeof cause.status === 'number' ? cause.status : 500;
      const message = status === 500 ? 'No se pudo anular el préstamo.'
        : cause instanceof Error ? cause.message : 'No se pudo anular el préstamo.';
      if (status === 404) {
        this.publish({ ...this.state, attempt: null, feedback: { kind: 'error', message } });
        await this.refresh();
      } else {
        this.publish({ ...this.state, attempt: { ...this.state.attempt!, error: message } });
        if (status === 409 && await this.refresh() && !this.state.items.some((row) => row.loanId === attempt.loan.loanId)) {
          this.publish({ ...this.state, attempt: null, feedback: { kind: 'error', message } });
        }
      }
      return false;
    } finally {
      this.submitting = false;
      if (this.state.attempt?.submitting) this.publish({ ...this.state, attempt: { ...this.state.attempt, submitting: false } });
    }
  }
}
