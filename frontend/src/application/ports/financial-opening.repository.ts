import type { FinancialOpening, FinancialOpeningResponse } from '../../domain/entities/financial-opening';
export type FinancialOpeningInput = Omit<FinancialOpening, 'id' | 'openedBy' | 'openedAt'>;
export interface FinancialOpeningRepository { get(): Promise<FinancialOpeningResponse>; perform(input: FinancialOpeningInput): Promise<FinancialOpening>; }
