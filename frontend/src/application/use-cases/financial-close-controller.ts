import type { FinancialCloseDetail, FinancialCloseListItem, FinancialClosePreview } from '../../domain/entities/financial-close';

export interface FinancialClosePort {
  preview(period: string): Promise<FinancialClosePreview>;
  confirm(period: string): Promise<FinancialCloseDetail>;
  list(): Promise<FinancialCloseListItem[]>;
  detail(id: string): Promise<FinancialCloseDetail>;
}

export type FinancialCloseState = Readonly<{
  period: string;
  preview: FinancialClosePreview | null;
  history: FinancialCloseListItem[];
  detail: FinancialCloseDetail | null;
  loading: boolean;
  confirming: boolean;
  detailLoading: boolean;
  confirmationOpen: boolean;
  error: string;
  detailError: string;
  success: string;
}>;

const validPeriod = (value: string) => /^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(value);
const message = (cause: unknown) => {
  if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 403)
    return 'No tienes permiso para realizar esta acción.';
  if (cause instanceof TypeError) return 'No se pudo conectar al servidor. Intenta nuevamente.';
  return cause instanceof Error ? cause.message : 'No fue posible completar la solicitud.';
};

export class FinancialCloseController {
  private state: FinancialCloseState;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private detailGeneration = 0;

  constructor(private readonly api: FinancialClosePort, initialPeriod: string) {
    this.state = { period: initialPeriod, preview: null, history: [], detail: null, loading: false,
      confirming: false, detailLoading: false, confirmationOpen: false, error: '', detailError: '', success: '' };
  }

  getSnapshot = (): FinancialCloseState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: FinancialCloseState) { this.state = next; this.listeners.forEach((listener) => listener()); }

  async load(): Promise<void> {
    const token = ++this.generation;
    this.publish({ ...this.state, loading: true, error: '', success: '', confirmationOpen: false });
    const [preview, history] = await Promise.allSettled([this.api.preview(this.state.period), this.api.list()]);
    if (token !== this.generation) return;
    const failures = [preview, history].filter((result) => result.status === 'rejected');
    this.publish({ ...this.state,
      preview: preview.status === 'fulfilled' ? preview.value : null,
      history: history.status === 'fulfilled' ? history.value : this.state.history,
      loading: false, error: failures.length ? message((failures[0] as PromiseRejectedResult).reason) : '' });
  }

  setPeriod(period: string) {
    if (!validPeriod(period) || period === this.state.period) return;
    ++this.generation; ++this.detailGeneration;
    this.publish({ ...this.state, period, preview: null, detail: null, confirmationOpen: false,
      error: '', detailError: '', success: '' });
    void this.load();
  }

  requestConfirmation() {
    if (!this.state.preview || this.state.preview.errors.length || this.state.confirming) return;
    this.publish({ ...this.state, confirmationOpen: true, error: '', success: '' });
  }

  cancelConfirmation() { this.publish({ ...this.state, confirmationOpen: false }); }

  async confirm(): Promise<void> {
    if (!this.state.confirmationOpen || !this.state.preview || this.state.preview.errors.length || this.state.confirming) return;
    const period = this.state.period;
    this.publish({ ...this.state, confirming: true, confirmationOpen: false, error: '', success: '' });
    try {
      const detail = await this.api.confirm(period);
      const history = await this.api.list();
      this.publish({ ...this.state, confirming: false, detail, history,
        success: `El cierre de ${period} fue confirmado.`, preview: null });
    } catch (cause) {
      this.publish({ ...this.state, confirming: false, error: message(cause) });
    }
  }

  async openDetail(id: string): Promise<void> {
    const token = ++this.detailGeneration;
    this.publish({ ...this.state, detail: null, detailLoading: true, detailError: '' });
    try {
      const detail = await this.api.detail(id);
      if (token === this.detailGeneration) this.publish({ ...this.state, detail, detailLoading: false });
    } catch (cause) {
      if (token === this.detailGeneration) this.publish({ ...this.state, detailLoading: false, detailError: message(cause) });
    }
  }

  closeDetail() { ++this.detailGeneration; this.publish({ ...this.state, detail: null, detailLoading: false, detailError: '' }); }
}
