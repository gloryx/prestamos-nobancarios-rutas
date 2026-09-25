import type { FinancialOpening } from '../../domain/financial-opening/financial-opening.types';

export const FINANCIAL_OPENING_REPOSITORY = Symbol('FINANCIAL_OPENING_REPOSITORY');
export type CreateFinancialOpening = Omit<FinancialOpening, 'id' | 'openedAt' | 'openedBy'>;
export interface FinancialOpeningRepository {
  find(): Promise<FinancialOpening | null>;
  create(input: CreateFinancialOpening): Promise<FinancialOpening>;
}
