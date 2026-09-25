import type { FinancialOpening, FinancialOpeningResponse } from '../../domain/entities/financial-opening';
import type { FinancialOpeningInput, FinancialOpeningRepository } from '../../application/ports/financial-opening.repository';
import { apiClient } from './api-client';
export class FinancialOpeningApi implements FinancialOpeningRepository {
  get(): Promise<FinancialOpeningResponse> { return apiClient.request('/financial-opening'); }
  perform(input: FinancialOpeningInput): Promise<FinancialOpening> { return apiClient.request('/financial-opening', { method: 'POST', body: JSON.stringify(input) }); }
}
