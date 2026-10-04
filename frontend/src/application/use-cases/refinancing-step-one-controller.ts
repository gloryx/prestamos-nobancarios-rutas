import type { LoanRefinancingLookup } from '../ports/loan-refinancing.repository';
import type { RefinancingLoanSearchResponse, RefinancingPageSize, RefinancingPreview } from '../../domain/entities/loan-refinancing';

export type RefinancingStepOneState = {
  step: 'ORIGIN' | 'CONDITIONS' | 'CONFIRMATION';
  search: string;
  page: number;
  pageSize: RefinancingPageSize;
  list: RefinancingLoanSearchResponse | null;
  loadingList: boolean;
  listError: unknown | null;
  originLoanId: string | null;
  originPreview: RefinancingPreview | null;
  loadingPreview: boolean;
  previewError: unknown | null;
};

export class RefinancingStepOneController {
  private state: RefinancingStepOneState = {
    step: 'ORIGIN', search: '', page: 1, pageSize: 20, list: null, loadingList: false, listError: null,
    originLoanId: null, originPreview: null, loadingPreview: false, previewError: null,
  };
  private readonly listeners = new Set<() => void>();
  private listRequest = 0;
  private previewRequest = 0;

  constructor(private readonly lookup: LoanRefinancingLookup) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): RefinancingStepOneState => this.state;

  private update(changes: Partial<RefinancingStepOneState>): void {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  setSearch(search: string): void {
    if (search === this.state.search) return;
    ++this.listRequest;
    this.update({ search, page: 1, list: null, loadingList: true, listError: null });
  }

  setPage(page: number): void {
    if (page === this.state.page) return;
    ++this.listRequest;
    this.update({ page, list: null, loadingList: true, listError: null });
  }

  setPageSize(pageSize: RefinancingPageSize): void {
    if (pageSize === this.state.pageSize) return;
    ++this.listRequest;
    this.update({ pageSize, page: 1, list: null, loadingList: true, listError: null });
  }

  async load(): Promise<void> {
    const request = ++this.listRequest;
    const { search, page, pageSize } = this.state;
    this.update({ list: null, loadingList: true, listError: null });
    try {
      const result = await this.lookup.search({ search, page, pageSize });
      if (request === this.listRequest) this.update({ list: result, loadingList: false });
    } catch (error) {
      if (request === this.listRequest) this.update({ listError: error, loadingList: false });
    }
  }

  async select(loanId: string): Promise<void> {
    const request = ++this.previewRequest;
    this.update({ step: 'ORIGIN', originLoanId: loanId, originPreview: null, loadingPreview: true, previewError: null });
    try {
      const preview = await this.lookup.preview(loanId);
      if (request !== this.previewRequest) return;
      if (preview.loanId.toLowerCase() !== loanId.toLowerCase()) throw new Error('Preview loan mismatch.');
      this.update({ originPreview: preview, loadingPreview: false });
    } catch (error) {
      if (request === this.previewRequest) this.update({ originPreview: null, previewError: error, loadingPreview: false });
    }
  }

  clearSelection(): void {
    ++this.previewRequest;
    this.update({ step: 'ORIGIN', originLoanId: null, originPreview: null, previewError: null, loadingPreview: false, listError: null });
  }

  canContinue(): boolean {
    return this.state.originLoanId !== null && this.state.originLoanId === this.state.originPreview?.loanId &&
      this.state.originPreview.eligible === true && !this.state.loadingPreview && this.state.previewError === null;
  }

  goToConditions(): void {
    if (this.state.step === 'ORIGIN' && this.canContinue()) this.update({ step: 'CONDITIONS' });
  }

  goToConfirmation(): void {
    if (this.state.step === 'CONDITIONS' && this.canContinue()) this.update({ step: 'CONFIRMATION' });
  }

  backToConditions(): void {
    if (this.state.step === 'CONFIRMATION') this.update({ step: 'CONDITIONS' });
  }

  goToOrigin(): void {
    if (this.state.step === 'ORIGIN') return;
    this.update({ step: 'ORIGIN' });
    if (this.state.originLoanId) void this.select(this.state.originLoanId);
  }

  reset(): void {
    ++this.listRequest;
    ++this.previewRequest;
    this.state = { step: 'ORIGIN', search: '', page: 1, pageSize: 20, list: null, loadingList: false,
      listError: null, originLoanId: null, originPreview: null, loadingPreview: false, previewError: null };
    this.listeners.forEach((listener) => listener());
  }

  dispose(): void {
    ++this.listRequest;
    ++this.previewRequest;
    this.listeners.clear();
  }
}
