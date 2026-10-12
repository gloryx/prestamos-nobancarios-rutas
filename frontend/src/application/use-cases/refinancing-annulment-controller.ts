import type { LoanRefinancingAnnulments } from '../ports/loan-refinancing.repository';
import type { RefinancingAnnulledSort, RefinancingAnnulmentCandidate, RefinancingAnnulmentCandidateSort,
  RefinancingAnnulmentDetail, RefinancingAnnulmentEligibility, RefinancingAnnulmentPaymentMethod,
  RefinancingAnnulmentType, RefinancingPageSize } from '../../domain/entities/loan-refinancing';

export type RefinancingAnnulmentTab = 'ANNULLED' | 'CANDIDATES';
export type RefinancingAnnulmentAttempt = Readonly<{
  candidate: RefinancingAnnulmentCandidate;
  type: RefinancingAnnulmentType | null;
  effectiveDate: string;
  validatedEffectiveDate: string | null;
  eligibility: RefinancingAnnulmentEligibility;
  refundPaymentMethodId: string;
  resolutionConfirmed: boolean;
  reason: string;
  key: string | null;
  validating: boolean;
  submitting: boolean;
  error: string | null;
}>;
export type RefinancingAnnulmentState = Readonly<{
  activeTab: RefinancingAnnulmentTab;
  search: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: RefinancingPageSize;
  sorts: Readonly<{ ANNULLED: { sortBy: RefinancingAnnulledSort; sortDir: 'asc' | 'desc' };
    CANDIDATES: { sortBy: RefinancingAnnulmentCandidateSort; sortDir: 'asc' | 'desc' } }>;
  items: ReadonlyArray<RefinancingAnnulmentDetail | RefinancingAnnulmentCandidate>;
  total: number;
  dataTab: RefinancingAnnulmentTab | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  paymentMethods: RefinancingAnnulmentPaymentMethod[];
  attempt: RefinancingAnnulmentAttempt | null;
  detail: RefinancingAnnulmentDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  feedback: { kind: 'success' | 'error'; message: string } | null;
}>;

const messageFor = (cause: unknown, fallback: string) => {
  const status = cause && typeof cause === 'object' && 'status' in cause ? cause.status : undefined;
  if (status === 403) return 'No tienes permiso para realizar esta operación.';
  if (status === 404) return 'El refinanciamiento ya no está disponible.';
  if (status === 409) return 'La elegibilidad cambió. Revisa los datos actualizados.';
  if (cause instanceof TypeError) return 'No se pudo conectar al servidor. Intenta nuevamente.';
  return fallback;
};

export class RefinancingAnnulmentController {
  private state: RefinancingAnnulmentState = { activeTab: 'ANNULLED', search: '', dateFrom: '', dateTo: '',
    page: 1, pageSize: 20, sorts: { ANNULLED: { sortBy: 'effectiveDate', sortDir: 'desc' },
      CANDIDATES: { sortBy: 'refinancingDate', sortDir: 'desc' } }, items: [], total: 0, dataTab: null,
    loading: false, refreshing: false, error: null, paymentMethods: [], attempt: null, detail: null,
    detailLoading: false, detailError: null, feedback: null };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private submitting = false;
  private paymentMethodsRequest: Promise<RefinancingAnnulmentPaymentMethod[]> | null = null;
  private paymentMethodsCache: RefinancingAnnulmentPaymentMethod[] | null = null;
  constructor(private readonly api: LoanRefinancingAnnulments, private readonly generateKey: () => string,
    private readonly canAnnul: () => boolean) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: RefinancingAnnulmentState) { this.state = next; this.listeners.forEach((listener) => listener()); }
  private loadPaymentMethods() {
    if (this.paymentMethodsCache) return Promise.resolve(this.paymentMethodsCache);
    this.paymentMethodsRequest ??= this.api.paymentMethods().then((methods) => {
      this.paymentMethodsCache = methods; return methods;
    }).finally(() => { this.paymentMethodsRequest = null; });
    return this.paymentMethodsRequest;
  }
  private query(tab: RefinancingAnnulmentTab, page = this.state.page, effectiveDate?: string) {
    const base = { page, pageSize: this.state.pageSize, ...(this.state.search.trim() && { search: this.state.search.trim() }),
      ...(this.state.dateFrom && { dateFrom: this.state.dateFrom }), ...(this.state.dateTo && { dateTo: this.state.dateTo }) };
    return tab === 'ANNULLED' ? this.api.listAnnulled({ ...base, ...this.state.sorts.ANNULLED })
      : this.api.listCandidates({ ...base, ...this.state.sorts.CANDIDATES, ...(effectiveDate && { effectiveDate }) });
  }
  private async request(refreshing: boolean) {
    const token = ++this.generation, tab = this.state.activeTab;
    this.publish({ ...this.state, loading: !refreshing, refreshing, error: null });
    try {
      const [result, methods] = await Promise.all([this.query(tab), tab === 'CANDIDATES'
        ? this.loadPaymentMethods() : Promise.resolve(this.state.paymentMethods)]);
      if (token !== this.generation) return false;
      this.publish({ ...this.state, items: result.items, total: result.total, page: result.page, pageSize: result.pageSize,
        dataTab: tab, paymentMethods: methods, loading: false, refreshing: false, error: null });
      return true;
    } catch (cause) {
      if (token === this.generation) this.publish({ ...this.state, loading: false, refreshing: false,
        error: messageFor(cause, 'No se pudieron cargar los refinanciamientos.') });
      return false;
    }
  }
  load = () => this.request(false);
  refresh = () => this.request(true);
  setActiveTab(tab: RefinancingAnnulmentTab) { if (tab === this.state.activeTab || this.submitting) return;
    this.publish({ ...this.state, activeTab: tab, page: 1, items: [], total: 0, dataTab: null, attempt: null,
      detail: null, feedback: null, error: null }); void this.load(); }
  private filter(field: 'search' | 'dateFrom' | 'dateTo', value: string) { if (this.state[field] === value) return;
    this.publish({ ...this.state, [field]: value, page: 1 }); void this.load(); }
  setSearch(value: string) { this.filter('search', value); }
  setDateFrom(value: string) { this.filter('dateFrom', value); }
  setDateTo(value: string) { this.filter('dateTo', value); }
  setPage(page: number) { if (page < 1 || page === this.state.page) return; this.publish({ ...this.state, page }); void this.load(); }
  setPageSize(pageSize: RefinancingPageSize) { if (pageSize === this.state.pageSize) return;
    this.publish({ ...this.state, pageSize, page: 1 }); void this.load(); }
  sort(column: RefinancingAnnulledSort | RefinancingAnnulmentCandidateSort) {
    const tab = this.state.activeTab, current = this.state.sorts[tab];
    if (tab === 'CANDIDATES' && !['refinancingDate', 'customer', 'originLoan', 'successorLoan', 'newMoneyDisbursed'].includes(column)) return;
    this.publish({ ...this.state, page: 1, sorts: { ...this.state.sorts,
      [tab]: { sortBy: column, sortDir: current.sortBy === column && current.sortDir === 'asc' ? 'desc' : 'asc' } } });
    void this.load();
  }
  begin(candidate: RefinancingAnnulmentCandidate) { if (!this.canAnnul() || this.submitting || !candidate.eligibility.eligible) return false;
    this.publish({ ...this.state, attempt: { candidate, type: null, effectiveDate: '', validatedEffectiveDate: null,
      eligibility: candidate.eligibility, refundPaymentMethodId: '', resolutionConfirmed: false, reason: '', key: null,
      validating: false, submitting: false, error: null }, feedback: null }); return true; }
  abandon() { if (!this.submitting) this.publish({ ...this.state, attempt: null }); }
  private updateAttempt(change: Partial<RefinancingAnnulmentAttempt>, rotate = true) { const attempt = this.state.attempt;
    if (!attempt || this.submitting) return; this.publish({ ...this.state, attempt: { ...attempt, ...change,
      key: rotate ? null : attempt.key, error: null } }); }
  setType(type: RefinancingAnnulmentType) { this.updateAttempt({ type, effectiveDate: '', validatedEffectiveDate: null,
    refundPaymentMethodId: '', resolutionConfirmed: false }); }
  setReason(reason: string) { this.updateAttempt({ reason }); }
  setEffectiveDate(effectiveDate: string) { this.updateAttempt({ effectiveDate, validatedEffectiveDate: null }); }
  setRefundPaymentMethod(id: string) { this.updateAttempt({ refundPaymentMethodId: id }); }
  setResolutionConfirmed(value: boolean) { this.updateAttempt({ resolutionConfirmed: value }); }
  async validateEffectiveDate() {
    const attempt = this.state.attempt;
    if (!attempt || attempt.type !== 'CASH_REFUND' || !attempt.effectiveDate || attempt.validating) return false;
    this.updateAttempt({ validating: true }, false);
    try {
      const result = await this.api.listCandidates({ page: 1, pageSize: 20, search: attempt.candidate.originLoanNumber,
        effectiveDate: attempt.effectiveDate, ...this.state.sorts.CANDIDATES });
      const candidate = result.items.find((item) => item.refinancingId === attempt.candidate.refinancingId);
      if (!candidate) throw Object.assign(new Error(), { status: 409 });
      this.publish({ ...this.state, attempt: { ...this.state.attempt!, candidate, eligibility: candidate.eligibility,
        validatedEffectiveDate: attempt.effectiveDate, validating: false, error: null } });
      return candidate.eligibility.types.CASH_REFUND.eligible;
    } catch (cause) {
      this.publish({ ...this.state, attempt: { ...this.state.attempt!, validatedEffectiveDate: null, validating: false,
        error: messageFor(cause, 'No se pudo validar la fecha efectiva.') } }); return false;
    }
  }
  async openDetail(annulmentId: string) { this.publish({ ...this.state, detail: null, detailLoading: true, detailError: null });
    try { const detail = await this.api.detail(annulmentId); this.publish({ ...this.state, detail, detailLoading: false }); }
    catch (cause) { this.publish({ ...this.state, detailLoading: false,
      detailError: messageFor(cause, 'No se pudo cargar el detalle de la anulación.') }); } }
  closeDetail() { this.publish({ ...this.state, detail: null, detailError: null }); }
  async submit() {
    const attempt = this.state.attempt, reason = attempt?.reason.trim() ?? '';
    if (!attempt || !attempt.type || !this.canAnnul() || this.submitting || reason.length < 8 || reason.length > 500) return false;
    const typeEligibility = attempt.eligibility.types[attempt.type];
    const cash = attempt.type === 'CASH_REFUND', positiveMoney = Number(attempt.candidate.newMoneyDisbursed) > 0;
    if (!typeEligibility.eligible || cash && attempt.validatedEffectiveDate !== attempt.effectiveDate ||
      positiveMoney && (!attempt.resolutionConfirmed || cash && !attempt.refundPaymentMethodId)) return false;
    this.submitting = true; const key = attempt.key ?? this.generateKey();
    this.publish({ ...this.state, attempt: { ...attempt, key, submitting: true, error: null } });
    try {
      await this.api.annul(attempt.candidate.refinancingId, { annulmentType: attempt.type, reason, idempotencyKey: key,
        ...(positiveMoney && { disbursementResolution: cash ? 'RETURNED_IN_FULL' as const : 'NOT_DELIVERED' as const }),
        ...(cash && { effectiveDate: attempt.effectiveDate }),
        ...(cash && positiveMoney && { refundPaymentMethodId: attempt.refundPaymentMethodId }) });
      this.publish({ ...this.state, activeTab: 'ANNULLED', page: 1, items: [], total: 0, dataTab: null, attempt: null,
        feedback: { kind: 'success', message: 'Refinanciamiento anulado correctamente.' } });
      await this.load(); return true;
    } catch (cause) {
      const status = cause && typeof cause === 'object' && 'status' in cause ? cause.status : undefined;
      const message = messageFor(cause, 'No se pudo anular el refinanciamiento.');
      if (status === 404 || status === 403) this.publish({ ...this.state, attempt: null, feedback: { kind: 'error', message } });
      else this.publish({ ...this.state, attempt: { ...this.state.attempt!, error: message } });
      if (status === 404) await this.refresh();
      if (status === 409) { const refreshed = await this.refresh(); const current = refreshed
        ? (this.state.items as RefinancingAnnulmentCandidate[]).find((item) => item.refinancingId === attempt.candidate.refinancingId) : undefined;
        this.publish({ ...this.state, attempt: current ? { ...this.state.attempt!, candidate: current,
          eligibility: current.eligibility, validatedEffectiveDate: null, error: message } : null,
        ...(!current && { feedback: { kind: 'error' as const, message } }) }); }
      return false;
    } finally { this.submitting = false; if (this.state.attempt?.submitting)
      this.publish({ ...this.state, attempt: { ...this.state.attempt, submitting: false } }); }
  }
}
