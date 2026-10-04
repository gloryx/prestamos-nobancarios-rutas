import type { LoanRefinancingChains, RefinancingCustomerLookup, RefinancingCustomerOption } from '../ports/loan-refinancing.repository';
import type { CustomerRefinancingChains, RefinancingChain } from '../../domain/entities/loan-refinancing';

export type RefinancingChainState = {
  chain: RefinancingChain | null;
  customerChains: CustomerRefinancingChains | null;
  selectedCustomer: RefinancingCustomerOption | null;
  loading: boolean;
  error: unknown | null;
  customerSearch: string;
  customerPage: number;
  customers: { items: RefinancingCustomerOption[]; total: number } | null;
  loadingCustomers: boolean;
  customerError: unknown | null;
};

export class RefinancingChainController {
  private state: RefinancingChainState = {
    chain: null, customerChains: null, selectedCustomer: null, loading: false, error: null,
    customerSearch: '', customerPage: 1, customers: null, loadingCustomers: false, customerError: null,
  };
  private readonly listeners = new Set<() => void>();
  private chainRequest = 0;
  private customerRequest = 0;

  constructor(private readonly repository: LoanRefinancingChains, private readonly customerLookup: RefinancingCustomerLookup) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): RefinancingChainState => this.state;

  private update(changes: Partial<RefinancingChainState>): void {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  async loadLoan(loanId: string): Promise<void> {
    const request = ++this.chainRequest;
    this.update({ chain: null, customerChains: null, loading: true, error: null });
    try {
      const chain = await this.repository.byLoan(loanId);
      if (request === this.chainRequest) this.update({ chain, loading: false });
    } catch (error) {
      if (request === this.chainRequest) this.update({ error, loading: false });
    }
  }

  selectCustomer(customer: RefinancingCustomerOption | null): void {
    if (this.state.selectedCustomer?.id === customer?.id) return;
    ++this.chainRequest;
    this.update({ selectedCustomer: customer, chain: null, customerChains: null,
      loading: customer !== null, error: null });
    this.closeCustomerSearch();
  }

  async loadCustomer(customerId: string): Promise<void> {
    const request = ++this.chainRequest;
    this.update({ chain: null, customerChains: null, loading: true, error: null });
    try {
      const customerChains = await this.repository.byCustomer(customerId);
      if (request === this.chainRequest) this.update({ customerChains, loading: false });
    } catch (error) {
      if (request === this.chainRequest) this.update({ error, loading: false });
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
    ++this.chainRequest;
    ++this.customerRequest;
    this.listeners.clear();
  }
}
