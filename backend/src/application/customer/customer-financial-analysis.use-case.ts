import { analyzeEconomicPrincipalProvenance, type EconomicProvenanceFacts } from '../../domain/cash-movement/economic-principal-provenance';
import { calculateCustomerFinancialAnalysis } from '../../domain/customer/customer-financial-analysis';
import { CustomerNotFoundError, CustomerValidationError } from '../../domain/customer/customer.errors';

export const CUSTOMER_FINANCIAL_ANALYSIS_READER = Symbol('CUSTOMER_FINANCIAL_ANALYSIS_READER');

export type CustomerFinancialAnalysisSnapshot = {
  customer: { id: string; identification: string; fullName: string } | null;
  facts: EconomicProvenanceFacts;
};

export interface CustomerFinancialAnalysisReader {
  read(customerId: string, asOf: string): Promise<CustomerFinancialAnalysisSnapshot>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string): boolean => {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const costaRicaDate = (): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export class CustomerFinancialAnalysisUseCase {
  constructor(private readonly reader: CustomerFinancialAnalysisReader, private readonly today = costaRicaDate) {}

  async execute(customerId: string, requestedAsOf?: string) {
    const asOf = requestedAsOf ?? this.today();
    if (!validDate(asOf))
      throw new CustomerValidationError('La fecha de corte debe tener formato YYYY-MM-DD y ser una fecha válida.');
    if (asOf > this.today()) throw new CustomerValidationError('La fecha de corte no puede ser futura.');
    const snapshot = await this.reader.read(customerId, asOf);
    if (!snapshot.customer) throw new CustomerNotFoundError();
    const provenance = analyzeEconomicPrincipalProvenance(snapshot.facts, asOf);
    return { customer: snapshot.customer, ...calculateCustomerFinancialAnalysis(asOf, provenance, snapshot.facts.loans) };
  }
}
