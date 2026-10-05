import type { PortfolioTrackingRepository } from '../ports/portfolio-tracking.repository';
import type { PortfolioTrackingFilters, PortfolioTrackingResult } from '../../domain/entities/portfolio-tracking';

export type PortfolioTrackingState = {
  filters: PortfolioTrackingFilters;
  position: number;
  data: PortfolioTrackingResult | null;
  loading: boolean;
  error: unknown | null;
};

export class PortfolioTrackingController {
  private state: PortfolioTrackingState = {
    filters: { search: '', status: 'ALL', collectionStatus: 'ALL' },
    position: 1,
    data: null,
    loading: false,
    error: null,
  };
  private readonly listeners = new Set<() => void>();
  private request = 0;

  constructor(private readonly repository: PortfolioTrackingRepository) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): PortfolioTrackingState => this.state;

  private update(changes: Partial<PortfolioTrackingState>): void {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  setFilter<K extends keyof PortfolioTrackingFilters>(field: K, value: PortfolioTrackingFilters[K]): void {
    if (this.state.filters[field] === value) return;
    ++this.request;
    this.update({ filters: { ...this.state.filters, [field]: value }, position: 1, data: null, loading: true, error: null });
  }

  setPosition(position: number): void {
    const total = this.state.data?.total ?? 0;
    const next = Math.max(1, total ? Math.min(position, total) : 1);
    if (next === this.state.position) return;
    ++this.request;
    this.update({ position: next, data: null, loading: true, error: null });
  }

  async load(): Promise<void> {
    const request = ++this.request;
    const { filters, position } = this.state;
    this.update({ data: null, loading: true, error: null });
    try {
      const data = await this.repository.locate({ ...filters, search: filters.search.trim(), position });
      if (request !== this.request) return;
      this.update({ data, position: data.position || 1, loading: false });
    } catch (error) {
      if (request === this.request) this.update({ data: null, error, loading: false });
    }
  }

  dispose(): void {
    ++this.request;
    this.listeners.clear();
  }
}
