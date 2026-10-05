import type { CustomerStatistics } from '../../domain/entities/customer-statistics';

export interface CustomerStatisticsPort {
  load(year: number, limit: number): Promise<CustomerStatistics>;
}

export const DEFAULT_CUSTOMER_RANKING_LIMIT = 10;

export type CustomerStatisticsState = Readonly<{
  year: number;
  limit: number;
  statistics: CustomerStatistics | null;
  loading: boolean;
  error: string;
}>;

const errorMessage = (cause: unknown): string => {
  if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 403)
    return 'No tienes permiso para consultar estadísticas de clientes.';
  if (cause instanceof TypeError) return 'No se pudo conectar al servidor. Intenta nuevamente.';
  return cause instanceof Error && cause.message ? cause.message : 'No se pudieron cargar las estadísticas de clientes.';
};

export class CustomerStatisticsController {
  private state: CustomerStatisticsState;
  private readonly listeners = new Set<() => void>();
  private generation = 0;

  constructor(private readonly api: CustomerStatisticsPort, initialYear: number, private readonly currentYear: number) {
    this.state = { year: initialYear, limit: DEFAULT_CUSTOMER_RANKING_LIMIT, statistics: null, loading: true, error: '' };
  }

  getSnapshot = (): CustomerStatisticsState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: CustomerStatisticsState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  async load(): Promise<void> {
    const token = ++this.generation;
    const year = this.state.year;
    const limit = this.state.limit;
    this.publish({ ...this.state, statistics: null, loading: true, error: '' });
    try {
      const statistics = await this.api.load(year, limit);
      if (token === this.generation) this.publish({ ...this.state, statistics, loading: false, error: '' });
    } catch (cause) {
      if (token === this.generation) this.publish({ ...this.state, statistics: null, loading: false, error: errorMessage(cause) });
    }
  }

  setYear(year: number): void {
    if (!Number.isSafeInteger(year) || year < 1000 || year > this.currentYear || year === this.state.year) return;
    ++this.generation;
    this.publish({ ...this.state, year, statistics: null, loading: true, error: '' });
    void this.load();
  }

  setLimit(limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit === this.state.limit) return;
    ++this.generation;
    this.publish({ ...this.state, limit, statistics: null, loading: true, error: '' });
    void this.load();
  }

  dispose(): void {
    ++this.generation;
    this.listeners.clear();
  }
}
