import { CustomerFinancialAnalysisController } from '../application/use-cases/customer-financial-analysis-controller';
import { costaRicaDateOnly } from '../shared/utils/date';
import { customerUseCases } from './customers';

export function createCustomerFinancialAnalysis(customerId: string, initialAsOf = costaRicaDateOnly()): CustomerFinancialAnalysisController {
  return new CustomerFinancialAnalysisController({
    load: (id, asOf) => customerUseCases.financialAnalysis.execute(id, asOf),
  }, customerId, initialAsOf, costaRicaDateOnly);
}
