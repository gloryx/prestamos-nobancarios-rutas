import type { CustomerListResult } from '../ports/customer.repository';

export type CustomerSelectionQuery = {
  search: string;
  status: 'ALL';
  page: number;
  pageSize: 10;
  sortBy: 'name';
  sortOrder: 'asc';
};

export interface CustomerSelectionPort {
  list(query: CustomerSelectionQuery): Promise<CustomerListResult>;
}

export type CustomerSelectionState = Readonly<{
  search: string;
  page: number;
  data: CustomerListResult | null;
  loading: boolean;
  error: unknown | null;
}>;

export class CustomerSelectionController {
  private state: CustomerSelectionState = { search: '', page: 1, data: null, loading: true, error: null };
  private readonly listeners = new Set<() => void>();
  private request = 0;

  constructor(private readonly port: CustomerSelectionPort) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): CustomerSelectionState => this.state;

  private publish(changes: Partial<CustomerSelectionState>): void {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  setSearch(search: string): void {
    if (search === this.state.search) return;
    ++this.request;
    this.publish({ search, page: 1, data: null, loading: true, error: null });
  }

  setPage(page: number): void {
    if (page < 1 || page === this.state.page) return;
    ++this.request;
    this.publish({ page, data: null, loading: true, error: null });
  }

  async load(): Promise<void> {
    const request = ++this.request;
    const { search, page } = this.state;
    this.publish({ data: null, loading: true, error: null });
    try {
      const data = await this.port.list({
        search: search.trim(), status: 'ALL', page, pageSize: 10, sortBy: 'name', sortOrder: 'asc',
      });
      if (request === this.request) this.publish({ data, loading: false });
    } catch (error) {
      if (request === this.request) this.publish({ error, loading: false });
    }
  }

  close(): void {
    ++this.request;
  }

  dispose(): void {
    this.close();
    this.listeners.clear();
  }
}
