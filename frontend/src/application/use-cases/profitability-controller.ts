import type {
  EconomicCapitalSeries, ProfitabilityDetailKind, ProfitabilityDetailRow, ProfitabilityLoanStatus, ProfitabilityNormalRow,
  ProfitabilityPage, ProfitabilityPaymentFilters, ProfitabilityPaymentRow, ProfitabilityRefinancingRow,
  ProfitabilitySummary, ProfitabilityZoomFilters,
} from '../../domain/entities/profitability';

export interface ProfitabilityPort {
  summary(period: string): Promise<ProfitabilitySummary>;
  capitalSeries(period: string): Promise<EconomicCapitalSeries>;
  normal(period: string, page: number, pageSize: 10 | 20 | 50,
    status?: ProfitabilityLoanStatus): Promise<ProfitabilityPage<ProfitabilityNormalRow>>;
  refinancings(period: string, page: number, pageSize: 10 | 20 | 50,
    terminalStatus?: ProfitabilityLoanStatus): Promise<ProfitabilityPage<ProfitabilityRefinancingRow>>;
  payments(period: string, page: number, pageSize: 10 | 20 | 50,
    filters?: ProfitabilityPaymentFilters): Promise<ProfitabilityPage<ProfitabilityPaymentRow>>;
}

export type ProfitabilityDetailState = Readonly<{
  kind: ProfitabilityDetailKind;
  title: string;
  page: number;
  pageSize: 10 | 20 | 50;
  filters: ProfitabilityZoomFilters;
  data: ProfitabilityPage<ProfitabilityDetailRow> | null;
  loading: boolean;
  error: string;
}>;

export type ProfitabilityState = Readonly<{
  period: string;
  summary: ProfitabilitySummary | null;
  capitalSeries: EconomicCapitalSeries | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  seriesError: string;
  detail: ProfitabilityDetailState | null;
}>;

const errorMessage = (cause: unknown) => {
  if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 403)
    return 'No tienes permiso para consultar la rentabilidad integral.';
  if (cause instanceof TypeError) return 'No se pudo conectar al servidor. Intenta nuevamente.';
  return cause instanceof Error ? cause.message : 'No se pudieron cargar los datos.';
};
const validPeriod = (value: string) => /^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(value);

export class ProfitabilityController {
  private state: ProfitabilityState;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private detailGeneration = 0;

  constructor(private readonly api: ProfitabilityPort, initialPeriod: string) {
    this.state = { period: initialPeriod, summary: null, capitalSeries: null, loading: false,
      refreshing: false, error: '', seriesError: '', detail: null };
  }

  getSnapshot = (): ProfitabilityState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: ProfitabilityState) { this.state = next; this.listeners.forEach((listener) => listener()); }

  async load(): Promise<void> {
    const token = ++this.generation;
    const period = this.state.period;
    const initial = this.state.summary === null;
    this.publish({ ...this.state, loading: initial, refreshing: !initial, error: '', seriesError: '' });
    const [summary, series] = await Promise.allSettled([this.api.summary(period), this.api.capitalSeries(period)]);
    if (token !== this.generation) return;
    this.publish({ ...this.state,
      summary: summary.status === 'fulfilled' ? summary.value : null,
      capitalSeries: series.status === 'fulfilled' ? series.value : null,
      error: summary.status === 'rejected' ? errorMessage(summary.reason) : '',
      seriesError: series.status === 'rejected' ? errorMessage(series.reason) : '',
      loading: false, refreshing: false });
  }

  setPeriod(value: string) {
    if (!validPeriod(value) || value === this.state.period) return;
    ++this.detailGeneration;
    this.publish({ ...this.state, period: value, summary: null, capitalSeries: null, detail: null,
      error: '', seriesError: '' });
    void this.load();
  }

  openNormal() { this.openDetail('normal', 'Ganancia normal'); }
  openRefinancings() { this.openDetail('refinancings', 'Ganancia por refinanciamientos'); }
  openPayments(filters: ProfitabilityPaymentFilters = {}, title = 'Pagos que aportaron ganancia') {
    this.openDetail('payments', title, filters);
  }

  closeDetail() { ++this.detailGeneration; this.publish({ ...this.state, detail: null }); }

  setDetailPage(page: number) {
    const detail = this.state.detail;
    if (!detail || !Number.isSafeInteger(page) || page < 1 || page === detail.page) return;
    this.publish({ ...this.state, detail: { ...detail, page } });
    void this.loadDetail();
  }

  retryDetail() { if (this.state.detail) void this.loadDetail(); }

  setDetailStatus(status: ProfitabilityLoanStatus | '') {
    const detail = this.state.detail;
    if (!detail || detail.kind === 'payments') return;
    const filters = detail.kind === 'normal'
      ? { ...detail.filters, status: status || undefined }
      : { ...detail.filters, terminalStatus: status || undefined };
    this.publish({ ...this.state, detail: { ...detail, page: 1, filters, data: null, error: '' } });
    void this.loadDetail();
  }

  private openDetail(kind: ProfitabilityDetailKind, title: string, filters: ProfitabilityPaymentFilters = {}) {
    this.publish({ ...this.state, detail: { kind, title, filters, page: 1, pageSize: 20,
      data: null, loading: false, error: '' } });
    void this.loadDetail();
  }

  private async loadDetail() {
    const detail = this.state.detail;
    if (!detail) return;
    const token = ++this.detailGeneration;
    this.publish({ ...this.state, detail: { ...detail, loading: true, error: '' } });
    try {
      const data = detail.kind === 'normal'
        ? await this.api.normal(this.state.period, detail.page, detail.pageSize, detail.filters.status)
        : detail.kind === 'refinancings'
          ? await this.api.refinancings(this.state.period, detail.page, detail.pageSize, detail.filters.terminalStatus)
          : await this.api.payments(this.state.period, detail.page, detail.pageSize, detail.filters);
      if (token === this.detailGeneration && this.state.detail)
        this.publish({ ...this.state, detail: { ...this.state.detail, data, loading: false } });
    } catch (cause) {
      if (token === this.detailGeneration && this.state.detail)
        this.publish({ ...this.state, detail: { ...this.state.detail, loading: false, error: errorMessage(cause) } });
    }
  }
}
