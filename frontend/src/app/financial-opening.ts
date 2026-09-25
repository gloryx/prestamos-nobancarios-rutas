import { GetFinancialOpening, PerformFinancialOpening } from '../application/use-cases/financial-opening.use-cases';
import { FinancialOpeningApi } from '../infrastructure/api/financial-opening.api';
const repository = new FinancialOpeningApi();
export const financialOpeningUseCases = { get: new GetFinancialOpening(repository), perform: new PerformFinancialOpening(repository) };
