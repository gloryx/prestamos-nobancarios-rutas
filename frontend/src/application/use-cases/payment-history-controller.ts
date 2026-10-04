import type { PaymentHistoryFilters, PaymentHistoryItem, PaymentHistoryOptions, PaymentHistoryQuery,
  PaymentHistoryResult, PaymentHistorySort } from '../../domain/entities/payment-history';

export interface PaymentHistoryPort {
  list(query: PaymentHistoryQuery): Promise<PaymentHistoryResult>;
  options(): Promise<PaymentHistoryOptions>;
}
export type PaymentHistoryState = Readonly<{ filters: PaymentHistoryFilters; sortBy: PaymentHistorySort;
  sortDir: 'asc' | 'desc'; page: number; pageSize: number; data: PaymentHistoryResult | null;
  options: PaymentHistoryOptions | null; loading: boolean; error: string; optionsError: string }>;
const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo cargar el historial de pagos.';

export async function collectPaymentHistory(port: Pick<PaymentHistoryPort, 'list'>,
  query: Omit<PaymentHistoryQuery, 'page' | 'pageSize'>): Promise<PaymentHistoryItem[]> {
  const first = await port.list({ ...query, page: 1, pageSize: 100 });
  const items = [...first.items];
  for (let page = 2; items.length < first.total; page += 1) {
    const next = await port.list({ ...query, page, pageSize: 100 });
    if (next.total !== first.total || !next.items.length) throw new Error('El historial cambió durante la exportación.');
    items.push(...next.items);
  }
  if (items.length !== first.total || new Set(items.map((item) => item.paymentId)).size !== first.total)
    throw new Error('El historial cambió durante la exportación.');
  return items;
}

export class PaymentHistoryController {
  private state: PaymentHistoryState;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  constructor(private readonly port: PaymentHistoryPort, private readonly today: () => string) {
    this.state = { filters: this.defaults(), sortBy: 'paymentDate', sortDir: 'desc', page: 1, pageSize: 20,
      data: null, options: null, loading: false, error: '', optionsError: '' };
  }
  private defaults(): PaymentHistoryFilters { const endDate = this.today(); return {
    startDate: `${endDate.slice(0, 7)}-01`, endDate, search: '', loanNumber: '', status: '', paymentMethodId: '', collectorId: '' }; }
  getSnapshot = (): PaymentHistoryState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: PaymentHistoryState) { this.state = next; this.listeners.forEach((listener) => listener()); }
  query(): PaymentHistoryQuery { const { filters, sortBy, sortDir, page, pageSize } = this.state;
    return { ...filters, sortBy, sortDir, page, pageSize }; }
  async load(): Promise<void> {
    const token = ++this.generation, query = this.query();
    this.publish({ ...this.state, loading: true, error: '' });
    try { const data = await this.port.list(query); if (token === this.generation)
      this.publish({ ...this.state, data, loading: false }); }
    catch (error) { if (token === this.generation) this.publish({ ...this.state, data: null, loading: false, error: message(error) }); }
  }
  async loadOptions(): Promise<void> {
    try { const options = await this.port.options(); this.publish({ ...this.state, options, optionsError: '' }); }
    catch (error) { this.publish({ ...this.state, options: null, optionsError: message(error) }); }
  }
  setFilter<K extends keyof PaymentHistoryFilters>(key: K, value: PaymentHistoryFilters[K]) {
    if (this.state.filters[key] === value) return;
    this.publish({ ...this.state, filters: { ...this.state.filters, [key]: value }, page: 1, data: null }); void this.load();
  }
  clear() { this.publish({ ...this.state, filters: this.defaults(), page: 1, data: null }); void this.load(); }
  setSort(sortBy: PaymentHistorySort) { const sortDir = this.state.sortBy === sortBy
    ? this.state.sortDir === 'asc' ? 'desc' : 'asc' : sortBy === 'paymentDate' || sortBy === 'amount' ? 'desc' : 'asc';
    this.publish({ ...this.state, sortBy, sortDir, page: 1, data: null }); void this.load(); }
  setPage(page: number) { if (page < 1 || page === this.state.page) return;
    this.publish({ ...this.state, page, data: null }); void this.load(); }
  setPageSize(pageSize: number) { if (![10, 20, 50].includes(pageSize)) return;
    this.publish({ ...this.state, pageSize, page: 1, data: null }); void this.load(); }
  exportItems(query: Omit<PaymentHistoryQuery, 'page' | 'pageSize'>) { return collectPaymentHistory(this.port, query); }
}
