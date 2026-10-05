import type { PaymentCollectorReportFilters, PaymentCollectorReportResult } from '../../domain/entities/payment-collector-report';

export interface PaymentCollectorReportPort {
  load(filters: PaymentCollectorReportFilters, signal?: AbortSignal): Promise<PaymentCollectorReportResult>;
}

export type PaymentCollectorReportState = Readonly<{
  filters: PaymentCollectorReportFilters;
  data: PaymentCollectorReportResult | null;
  options: PaymentCollectorReportResult['options'] | null;
  loading: boolean;
  error: string;
}>;

export class PaymentCollectorReportController {
  private state: PaymentCollectorReportState;
  private readonly listeners = new Set<() => void>();
  private request?: AbortController;

  constructor(private readonly port: PaymentCollectorReportPort, private readonly today: () => string) {
    this.state = { filters: this.defaults(), data: null, options: null, loading: false, error: '' };
  }

  private defaults(): PaymentCollectorReportFilters {
    const toDate = this.today();
    return { fromDate: `${toDate.slice(0, 7)}-01`, toDate, collectorId: '', paymentMethodId: '' };
  }

  getSnapshot = (): PaymentCollectorReportState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: PaymentCollectorReportState) { this.state = next; this.listeners.forEach((listener) => listener()); }

  setFilter<K extends keyof PaymentCollectorReportFilters>(key: K, value: PaymentCollectorReportFilters[K]) {
    this.publish({ ...this.state, filters: { ...this.state.filters, [key]: value }, error: '' });
  }

  async load(): Promise<void> {
    const { fromDate, toDate } = this.state.filters;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate) {
      this.publish({ ...this.state, data: null, loading: false, error: 'Seleccione un rango de fechas válido.' });
      return;
    }
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.publish({ ...this.state, data: null, loading: true, error: '' });
    try {
      const data = await this.port.load(this.state.filters, request.signal);
      if (this.request === request) this.publish({ ...this.state, data, options: data.options, loading: false });
    } catch (error) {
      if (request.signal.aborted) return;
      if (this.request === request) this.publish({ ...this.state, data: null, loading: false,
        error: error instanceof Error ? error.message : 'No se pudo cargar el reporte.' });
    }
  }

  clear() { this.publish({ ...this.state, filters: this.defaults(), data: null, error: '' }); void this.load(); }
  dispose() { this.request?.abort(); this.listeners.clear(); }
}
