import type { DailyCollectionsPage, DailyCollectionsQuery, DailyCollectionsSummary, DailyDueItem, DailyReceivedItem } from '../../domain/entities/daily-collections';
import { formatDateOnlyForDisplay, shiftDateOnly } from '../../shared/utils/date';

export interface DailyCollectionsPort {
  summary(date: string): Promise<DailyCollectionsSummary>;
  due(query: DailyCollectionsQuery): Promise<DailyCollectionsPage<DailyDueItem>>;
  received(query: DailyCollectionsQuery): Promise<DailyCollectionsPage<DailyReceivedItem>>;
}
type Section = 'summary' | 'due' | 'received';
export type DailyCollectionsState = Readonly<{
  date: string; search: string; duePage: number; receivedPage: number; pageSize: number;
  summary: DailyCollectionsSummary | null; due: DailyCollectionsPage<DailyDueItem> | null;
  received: DailyCollectionsPage<DailyReceivedItem> | null; errors: Record<Section, string>;
  loading: boolean; refreshing: boolean;
}>;

export class DailyCollectionsController {
  private state: DailyCollectionsState;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  constructor(private readonly api: DailyCollectionsPort, private readonly today: () => string) {
    this.state = { date: today(), search: '', duePage: 1, receivedPage: 1, pageSize: 20,
      summary: null, due: null, received: null, errors: { summary: '', due: '', received: '' }, loading: false, refreshing: false };
  }
  getSnapshot = (): DailyCollectionsState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: DailyCollectionsState) { this.state = next; this.listeners.forEach((listener) => listener()); }
  async load(): Promise<void> {
    const token = ++this.generation;
    const { date, search, duePage, receivedPage, pageSize } = this.state;
    const initial = !this.state.summary && !this.state.due && !this.state.received;
    this.publish({ ...this.state, loading: initial, refreshing: !initial, errors: { summary: '', due: '', received: '' } });
    const request = async <Key extends Section>(section: Key, promise: Promise<DailyCollectionsState[Key]>) => {
      try {
        const result = await promise;
        if (token === this.generation) this.publish({ ...this.state, [section]: result });
      } catch (cause) {
        if (token === this.generation) this.publish({ ...this.state, errors: { ...this.state.errors,
          [section]: cause instanceof Error ? cause.message : 'No se pudieron cargar los datos.' } });
      }
    };
    const filters = { date, ...(search.trim() ? { search: search.trim() } : {}), pageSize };
    await Promise.all([
      request('summary', this.api.summary(date)),
      request('due', this.api.due({ ...filters, page: duePage })),
      request('received', this.api.received({ ...filters, page: receivedPage })),
    ]);
    if (token === this.generation) this.publish({ ...this.state, loading: false, refreshing: false });
  }
  setDate(value: string) {
    if (formatDateOnlyForDisplay(value) === '—' || value === this.state.date) return;
    this.publish({ ...this.state, date: value, duePage: 1, receivedPage: 1,
      summary: null, due: null, received: null }); void this.load();
  }
  previous() { this.setDate(shiftDateOnly(this.state.date, -1)); }
  next() { this.setDate(shiftDateOnly(this.state.date, 1)); }
  resetToday() { this.setDate(this.today()); }
  setSearch(value: string) {
    if (value === this.state.search) return;
    this.publish({ ...this.state, search: value, duePage: 1, receivedPage: 1 }); void this.load();
  }
  setPage(section: 'due' | 'received', page: number) {
    if (!Number.isSafeInteger(page) || page < 1 || page === this.state[`${section}Page`]) return;
    this.publish({ ...this.state, [`${section}Page`]: page }); void this.load();
  }
}
