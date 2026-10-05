import { FinancialCloseController } from '../application/use-cases/financial-close-controller';
import { financialCloseApi } from '../infrastructure/api/financial-close.api';
import { costaRicaDateOnly } from '../shared/utils/date';

const previousMonth = (date: string) => {
  const [year, month] = date.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
};

export const createFinancialClose = () => new FinancialCloseController(financialCloseApi, previousMonth(costaRicaDateOnly()));
