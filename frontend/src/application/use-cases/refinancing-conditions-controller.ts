import type { LoanRefinancingOptions } from '../ports/loan-refinancing.repository';
import type { RefinancingPreview } from '../../domain/entities/loan-refinancing';
import type { PaymentFrequency } from '../../domain/entities/payment-frequency';
import type { PaymentMethod } from '../../domain/entities/payment-method';
import type { LoanPlanEntry } from '../../domain/entities/loan';
import { parseMoneyCents } from '../../shared/utils/money';
import { costaRicaDateOnly } from '../../shared/utils/date';
import { evaluateRefinancingConditions, type RefinancingConditions } from './refinancing-conditions';

export type RefinancingConditionsState = {
  preview: RefinancingPreview | null;
  conditions: RefinancingConditions;
  frequencies: PaymentFrequency[];
  methods: PaymentMethod[];
  optionsLoaded: boolean;
  loadingOptions: boolean;
  optionsError: unknown | null;
};

const initialConditions = (): RefinancingConditions => ({
  refinancingDate: costaRicaDateOnly(), newMoney: '0.00', newInterestAmount: '0.00',
  disbursementPaymentMethodId: '', paymentFrequencyId: '', preferredPaymentMethodId: '', observations: '',
  count: '1', mode: 'automatic', customPlan: [],
});

export class RefinancingConditionsController {
  private state: RefinancingConditionsState = { preview: null, conditions: initialConditions(),
    frequencies: [], methods: [], optionsLoaded: false, loadingOptions: false, optionsError: null };
  private readonly listeners = new Set<() => void>();
  private optionsRequest = 0;

  constructor(private readonly options: LoanRefinancingOptions) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): RefinancingConditionsState => this.state;

  private update(changes: Partial<RefinancingConditionsState>): void {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  setPreview(preview: RefinancingPreview): void {
    if (this.state.preview?.loanId === preview.loanId && this.state.preview.baseline === preview.baseline) return;
    this.update({ preview, conditions: initialConditions() });
  }

  resetDraft(): void {
    this.update({ preview: null, conditions: initialConditions() });
  }

  async loadOptions(): Promise<void> {
    if (this.state.optionsLoaded || this.state.loadingOptions) return;
    const request = ++this.optionsRequest;
    this.update({ loadingOptions: true, optionsError: null });
    try {
      const result = await this.options.load();
      if (request === this.optionsRequest) this.update({ frequencies: result.frequencies.filter((item) => item.isActive),
        methods: result.methods.filter((item) => item.isActive), loadingOptions: false, optionsLoaded: true });
    } catch (error) {
      if (request === this.optionsRequest) this.update({ optionsError: error, loadingOptions: false });
    }
  }

  setConditions(changes: Partial<RefinancingConditions>): void {
    const conditions = { ...this.state.conditions, ...changes };
    if (changes.newMoney !== undefined && parseMoneyCents(changes.newMoney) === 0n) conditions.disbursementPaymentMethodId = '';
    this.update({ conditions });
  }

  setMode(mode: RefinancingConditions['mode']): void {
    if (mode === this.state.conditions.mode) return;
    const generated = this.evaluate()?.generated ?? [];
    if (mode === 'personalized' && !generated.length) return;
    this.setConditions({ mode, customPlan: mode === 'personalized' ? generated.map((row) => ({ ...row })) : [] });
  }

  setCustomPlan(customPlan: LoanPlanEntry[]): void {
    if (this.state.conditions.mode === 'personalized') this.setConditions({ customPlan });
  }

  evaluate(today = costaRicaDateOnly()) {
    const { preview, conditions, frequencies, methods } = this.state;
    if (!preview) return null;
    return evaluateRefinancingConditions(preview, conditions,
      frequencies.find((item) => item.id === conditions.paymentFrequencyId), methods.map((item) => item.id), today);
  }

  canProceed(): boolean {
    return this.state.optionsLoaded && !this.state.loadingOptions && this.state.optionsError === null &&
      this.evaluate()?.valid === true;
  }

  dispose(): void {
    ++this.optionsRequest;
    this.listeners.clear();
  }
}
