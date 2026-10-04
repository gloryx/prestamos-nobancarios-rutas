import type { CustomerFinancialAnalysis } from '../../domain/entities/customer-financial-analysis';

export interface CustomerFinancialAnalysisPort {
  load(customerId: string, asOf: string): Promise<CustomerFinancialAnalysis>;
}

export type CustomerFinancialAnalysisState = Readonly<{
  customerId: string;
  asOf: string;
  analysis: CustomerFinancialAnalysis | null;
  loading: boolean;
  error: string;
}>;

const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const errorMessage = (cause: unknown): string => {
  if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 403)
    return 'No tienes permiso para consultar el análisis financiero de este cliente.';
  if (cause instanceof TypeError) return 'No se pudo conectar al servidor. Intenta nuevamente.';
  return cause instanceof Error ? cause.message : 'No se pudo cargar el análisis financiero.';
};

export class CustomerFinancialAnalysisController {
  private state: CustomerFinancialAnalysisState;
  private readonly listeners = new Set<() => void>();
  private generation = 0;

  constructor(private readonly api: CustomerFinancialAnalysisPort, customerId: string,
    initialAsOf: string, private readonly today: () => string) {
    this.state = { customerId, asOf: initialAsOf, analysis: null, loading: false, error: '' };
  }

  getSnapshot = (): CustomerFinancialAnalysisState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: CustomerFinancialAnalysisState) { this.state = next; this.listeners.forEach((listener) => listener()); }

  async load(): Promise<void> {
    const token = ++this.generation;
    const { customerId, asOf } = this.state;
    if (!validDate(asOf) || asOf > this.today()) {
      this.publish({ ...this.state, analysis: null, loading: false,
        error: 'La fecha de corte no puede ser futura y debe ser una fecha válida.' });
      return;
    }
    this.publish({ ...this.state, analysis: null, loading: true, error: '' });
    try {
      const analysis = await this.api.load(customerId, asOf);
      if (token === this.generation) this.publish({ ...this.state, analysis, loading: false, error: '' });
    } catch (cause) {
      if (token === this.generation) this.publish({ ...this.state, analysis: null, loading: false, error: errorMessage(cause) });
    }
  }

  setAsOf(value: string) {
    if (value === this.state.asOf) return;
    ++this.generation;
    if (!validDate(value) || value > this.today()) {
      this.publish({ ...this.state, asOf: value, analysis: null, loading: false,
        error: 'La fecha de corte no puede ser futura y debe ser una fecha válida.' });
      return;
    }
    this.publish({ ...this.state, asOf: value, analysis: null, loading: false, error: '' });
    void this.load();
  }
}
