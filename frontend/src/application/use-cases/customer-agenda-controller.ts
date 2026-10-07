import type { CustomerAgendaFilters, CustomerAgendaPageSize, CustomerAgendaResult } from '../../domain/entities/customer-agenda';

export interface CustomerAgendaPort {
  load(filters: CustomerAgendaFilters, signal?: AbortSignal): Promise<CustomerAgendaResult>;
}

export type CustomerAgendaState = Readonly<{
  filters: CustomerAgendaFilters;
  data: CustomerAgendaResult | null;
  loading: boolean;
  error: string;
}>;

const initialFilters = (): CustomerAgendaFilters => ({
  search: '', collectorId: '', routeId: '', provinceCode: '', cantonCode: '', districtCode: '',
  assignmentStatus: 'ALL', page: 1, pageSize: 20,
});

function errorMessage(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 403)
    return 'No tienes permiso para consultar la agenda de clientes.';
  if (cause instanceof TypeError) return 'No se pudo conectar al servidor. Intenta nuevamente.';
  return 'No se pudo cargar la agenda de clientes.';
}

export class CustomerAgendaController {
  private state: CustomerAgendaState = { filters: initialFilters(), data: null, loading: true, error: '' };
  private readonly listeners = new Set<() => void>();
  private request?: AbortController;

  constructor(private readonly port: CustomerAgendaPort) {}

  getSnapshot = (): CustomerAgendaState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: CustomerAgendaState): void { this.state = next; this.listeners.forEach((listener) => listener()); }

  async load(): Promise<void> {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.publish({ ...this.state, loading: true, error: '' });
    try {
      const data = await this.port.load(this.state.filters, request.signal);
      if (this.request === request) this.publish({
        ...this.state,
        filters: { ...this.state.filters, page: data.pagination.page },
        data,
        loading: false,
        error: '',
      });
    } catch (cause) {
      if (!request.signal.aborted && this.request === request)
        this.publish({ ...this.state, data: null, loading: false, error: errorMessage(cause) });
    } finally {
      if (this.request === request) this.request = undefined;
    }
  }

  submitSearch(search: string): void { this.change({ search, page: 1 }); }

  setCollector(value: string): void {
    this.change(value === 'UNASSIGNED'
      ? { collectorId: '', routeId: '', assignmentStatus: 'UNASSIGNED', page: 1 }
      : { collectorId: value, routeId: '', assignmentStatus: 'ALL', page: 1 });
  }

  setFilter(field: 'routeId' | 'provinceCode' | 'cantonCode' | 'districtCode', value: string): void {
    const patch: Partial<CustomerAgendaFilters> = { [field]: value, page: 1 };
    if (field === 'provinceCode') Object.assign(patch, { cantonCode: '', districtCode: '' });
    if (field === 'cantonCode') patch.districtCode = '';
    this.change(patch);
  }

  setPageSize(pageSize: CustomerAgendaPageSize): void { this.change({ pageSize, page: 1 }); }
  setPage(page: number): void {
    if (!Number.isSafeInteger(page) || page < 1 || page === this.state.filters.page) return;
    this.change({ page });
  }
  retry(): void { void this.load(); }
  dispose(): void { this.request?.abort(); this.request = undefined; this.listeners.clear(); }

  private change(patch: Partial<CustomerAgendaFilters>): void {
    this.publish({ ...this.state, filters: { ...this.state.filters, ...patch }, error: '' });
    void this.load();
  }
}
