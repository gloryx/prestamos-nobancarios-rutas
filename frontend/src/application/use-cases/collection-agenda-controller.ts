import type { CollectionAgendaFilters, CollectionAgendaPeriod, CollectionAgendaResult } from '../../domain/entities/collection-agenda';
import { formatDateOnlyForDisplay, shiftDateOnly } from '../../shared/utils/date';

export interface CollectionAgendaPort { load(filters: CollectionAgendaFilters, signal?: AbortSignal): Promise<CollectionAgendaResult>; }
export type CollectionAgendaOption = { id: string; name: string; collectorId?: string };
export type CollectionAgendaState = Readonly<{
  filters: CollectionAgendaFilters;
  data: CollectionAgendaResult | null;
  collectors: CollectionAgendaOption[];
  routes: CollectionAgendaOption[];
  loading: boolean;
  error: string;
}>;

const weekEnd = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftDateOnly(date, weekday === 0 ? 0 : 7 - weekday);
};
const message = (cause: unknown): string => {
  if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 403)
    return 'No tienes permiso para consultar la agenda de cobros.';
  if (cause instanceof TypeError) return 'No se pudo conectar al servidor. Intenta nuevamente.';
  return cause instanceof Error && cause.message ? cause.message : 'No se pudo cargar la agenda de cobros.';
};
const mergeOptions = (current: CollectionAgendaOption[], discovered: CollectionAgendaOption[]) => {
  const options = new Map(current.map((item) => [item.id, item]));
  for (const item of discovered) options.set(item.id, item);
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
};

export class CollectionAgendaController {
  private state: CollectionAgendaState;
  private readonly listeners = new Set<() => void>();
  private request?: AbortController;

  constructor(private readonly port: CollectionAgendaPort, private readonly today: () => string) {
    const referenceDate = today();
    this.state = { filters: { period: 'TODAY', referenceDate, fromDate: '', toDate: referenceDate, collectorId: '', routeId: '', collectionStatus: 'ALL', search: '', page: 1, pageSize: 20 },
      data: null, collectors: [], routes: [], loading: true, error: '' };
  }

  getSnapshot = (): CollectionAgendaState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: CollectionAgendaState) { this.state = next; this.listeners.forEach((listener) => listener()); }

  async load(): Promise<void> {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.publish({ ...this.state, data: null, loading: true, error: '' });
    try {
      const data = await this.port.load(this.state.filters, request.signal);
      if (this.request !== request) return;
      const collectorOptions = data.collectors.map((collector) => ({ id: collector.collectorId, name: collector.collectorName }));
      const assignedRoutes = data.collectors.flatMap((collector) => collector.routes.map((route) => ({ id: route.routeId, name: route.routeName, collectorId: collector.collectorId })));
      const problemRoutes = [...data.unassigned.withoutCollector, ...data.unassigned.invalidCollector, ...data.unassigned.invalidRoute]
        .map((route) => ({ id: route.routeId, name: route.routeName, collectorId: route.collectorId }));
      this.publish({ ...this.state, data, collectors: mergeOptions(this.state.collectors, collectorOptions), routes: mergeOptions(this.state.routes, [...assignedRoutes, ...problemRoutes]), loading: false, error: '' });
    } catch (cause) {
      if (request.signal.aborted) return;
      if (this.request === request) this.publish({ ...this.state, data: null, loading: false, error: message(cause) });
    } finally { if (this.request === request) this.request = undefined; }
  }

  setPeriod(period: CollectionAgendaPeriod): void {
    const referenceDate = this.today();
    const tomorrow = shiftDateOnly(referenceDate, 1);
    const ranges = {
      TODAY: { fromDate: '', toDate: referenceDate },
      TOMORROW: { fromDate: tomorrow, toDate: tomorrow },
      WEEK: { fromDate: '', toDate: weekEnd(referenceDate) },
      CUSTOM: { fromDate: this.state.filters.fromDate || referenceDate, toDate: this.state.filters.toDate || referenceDate },
    };
    this.change({ period, referenceDate, ...ranges[period], page: 1 });
  }

  setCustomDate(field: 'fromDate' | 'toDate', value: string): void {
    if (formatDateOnlyForDisplay(value) === '—') return;
    const filters = { ...this.state.filters, period: 'CUSTOM' as const, [field]: value, page: 1 };
    if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
      this.publish({ ...this.state, filters, data: null, loading: false, error: 'Selecciona un rango de fechas válido.' });
      return;
    }
    this.change(filters);
  }

  setFilter<K extends 'collectorId' | 'routeId' | 'collectionStatus' | 'search'>(field: K, value: CollectionAgendaFilters[K]): void {
    const filters = { ...this.state.filters, [field]: value, page: 1 };
    if (field === 'collectorId') filters.routeId = '';
    this.publish({ ...this.state, filters, error: '' });
    void this.load();
  }

  setPage(page: number): void {
    if (!Number.isSafeInteger(page) || page < 1 || page === this.state.filters.page) return;
    this.change({ page });
  }

  retry(): void { void this.load(); }
  dispose(): void { this.request?.abort(); this.request = undefined; this.listeners.clear(); }

  private change(patch: Partial<CollectionAgendaFilters>): void {
    this.publish({ ...this.state, filters: { ...this.state.filters, ...patch }, error: '' });
    void this.load();
  }
}
