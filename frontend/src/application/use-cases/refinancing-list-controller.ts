import type { LoanRefinancingList, RefinancingCustomerLookup, RefinancingCustomerOption } from '../ports/loan-refinancing.repository';
import type { RefinancingListResult, RefinancingPageSize } from '../../domain/entities/loan-refinancing';

export type RefinancingListFilters = { search: string; dateFrom: string; dateTo: string };
export type RefinancingListState = {
  filters: RefinancingListFilters;
  selectedCustomer: RefinancingCustomerOption | null;
  page: number;
  pageSize: RefinancingPageSize;
  data: RefinancingListResult | null;
  loading: boolean;
  error: unknown | null;
  customerSearch: string;
  customerPage: number;
  customers: { items: RefinancingCustomerOption[]; total: number } | null;
  loadingCustomers: boolean;
  customerError: unknown | null;
};

export class RefinancingListController {
  private state: RefinancingListState = {
    filters: { search: '', dateFrom: '', dateTo: '' }, selectedCustomer: null,
    page: 1, pageSize: 20, data: null, loading: false, error: null,
    customerSearch: '', customerPage: 1, customers: null, loadingCustomers: false, customerError: null,
  };
  private readonly listeners = new Set<() => void>();
  private listRequest = 0;
  private customerRequest = 0;

  constructor(private readonly repository: LoanRefinancingList, private readonly customerLookup: RefinancingCustomerLookup) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): RefinancingListState => this.state;

  private update(changes: Partial<RefinancingListState>): void {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  get invalidDateRange(): boolean {
    const { dateFrom, dateTo } = this.state.filters;
    return Boolean(dateFrom && dateTo && dateFrom > dateTo);
  }

  private invalidateList(changes: Partial<RefinancingListState>): void {
    ++this.listRequest;
    this.update({ ...changes, data: null, loading: true, error: null });
  }

  setFilter(field: keyof RefinancingListFilters, value: string): void {
    if (this.state.filters[field] === value) return;
    this.invalidateList({ filters: { ...this.state.filters, [field]: value }, page: 1 });
  }

  selectCustomer(customer: RefinancingCustomerOption | null): void {
    if (this.state.selectedCustomer?.id === customer?.id) return;
    this.invalidateList({ selectedCustomer: customer, page: 1 });
    this.closeCustomerSearch();
  }

  setPage(page: number): void {
    if (this.state.page === page) return;
    this.invalidateList({ page });
  }

  setPageSize(pageSize: RefinancingPageSize): void {
    if (this.state.pageSize === pageSize) return;
    this.invalidateList({ pageSize, page: 1 });
  }

  async load(): Promise<void> {
    const request = ++this.listRequest;
    if (this.invalidDateRange) { this.update({ data: null, error: null, loading: false }); return; }
    const { filters, selectedCustomer, page, pageSize } = this.state;
    this.update({ data: null, loading: true, error: null });
    try {
      const data = await this.repository.list({ search: filters.search.trim(),
        ...(selectedCustomer ? { customerId: selectedCustomer.id } : {}),
        ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
        ...(filters.dateTo ? { dateTo: filters.dateTo } : {}), page, pageSize });
      if (request === this.listRequest) this.update({ data, loading: false });
    } catch (error) {
      if (request === this.listRequest) this.update({ error, loading: false });
    }
  }

  openCustomerSearch(): void {
    ++this.customerRequest;
    this.update({ customerSearch: '', customerPage: 1, customers: null, loadingCustomers: true, customerError: null });
  }

  closeCustomerSearch(): void {
    ++this.customerRequest;
    this.update({ customers: null, loadingCustomers: false, customerError: null });
  }

  setCustomerSearch(search: string): void {
    if (this.state.customerSearch === search) return;
    ++this.customerRequest;
    this.update({ customerSearch: search, customerPage: 1, customers: null, loadingCustomers: true, customerError: null });
  }

  setCustomerPage(page: number): void {
    if (this.state.customerPage === page) return;
    ++this.customerRequest;
    this.update({ customerPage: page, customers: null, loadingCustomers: true, customerError: null });
  }

  async loadCustomers(): Promise<void> {
    const request = ++this.customerRequest;
    const { customerSearch, customerPage } = this.state;
    this.update({ customers: null, loadingCustomers: true, customerError: null });
    try {
      const customers = await this.customerLookup.search({ search: customerSearch.trim(), page: customerPage });
      if (request === this.customerRequest) this.update({ customers, loadingCustomers: false });
    } catch (error) {
      if (request === this.customerRequest) this.update({ customerError: error, loadingCustomers: false });
    }
  }

  dispose(): void {
    ++this.listRequest;
    ++this.customerRequest;
    this.listeners.clear();
  }
}
