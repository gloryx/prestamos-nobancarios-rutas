import type { CollectorStatistics } from '../../domain/entities/collector-statistics';

export interface CollectorStatisticsPort {
  load(year: number, month: number | null, signal?: AbortSignal): Promise<CollectorStatistics>;
}

export type CollectorStatisticsState = Readonly<{
  year: number;
  month: number | null;
  statistics: CollectorStatistics | null;
  loading: boolean;
  error: string;
}>;

const errorMessage = (cause: unknown): string => {
  if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 403)
    return 'No tienes permiso para consultar estadísticas de cobradores.';
  if (cause instanceof TypeError) return 'No se pudo conectar al servidor. Intenta nuevamente.';
  return cause instanceof Error && cause.message ? cause.message : 'No se pudieron cargar las estadísticas de cobradores.';
};

export class CollectorStatisticsController {
  private state: CollectorStatisticsState;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private request: { key: string; promise: Promise<void>; abort: AbortController } | null = null;

  constructor(private readonly api: CollectorStatisticsPort, initialYear: number, private readonly currentYear: number) {
    this.state = { year: initialYear, month: null, statistics: null, loading: true, error: '' };
  }

  getSnapshot = (): CollectorStatisticsState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: CollectorStatisticsState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  load(): Promise<void> {
    const { year, month } = this.state;
    const key = `${year}:${month ?? 'all'}`;
    if (this.request?.key === key) return this.request.promise;
    this.request?.abort.abort();
    const abort = new AbortController();
    const token = ++this.generation;
    this.publish({ ...this.state, statistics: null, loading: true, error: '' });
    const promise = this.api.load(year, month, abort.signal).then((statistics) => {
      if (token === this.generation) this.publish({ ...this.state, statistics, loading: false, error: '' });
    }).catch((cause: unknown) => {
      if (abort.signal.aborted) return;
      if (token === this.generation)
        this.publish({ ...this.state, statistics: null, loading: false, error: errorMessage(cause) });
    }).finally(() => { if (this.request?.abort === abort) this.request = null; });
    this.request = { key, promise, abort };
    return promise;
  }

  setYear(year: number): void {
    if (!Number.isSafeInteger(year) || year < 1000 || year > this.currentYear || year === this.state.year) return;
    this.changePeriod(year, this.state.month);
  }

  setMonth(month: number | null): void {
    if (month !== null && (!Number.isSafeInteger(month) || month < 1 || month > 12)) return;
    if (month === this.state.month) return;
    this.changePeriod(this.state.year, month);
  }

  private changePeriod(year: number, month: number | null): void {
    this.request?.abort.abort();
    this.request = null;
    ++this.generation;
    this.publish({ year, month, statistics: null, loading: true, error: '' });
    void this.load();
  }

  dispose(): void {
    this.request?.abort.abort();
    this.request = null;
    ++this.generation;
    this.listeners.clear();
  }
}
