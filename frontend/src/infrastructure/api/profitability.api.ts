import type {
  EconomicCapitalSeries, ProfitabilityLoanStatus, ProfitabilityNormalRow, ProfitabilityPage, ProfitabilityPaymentFilters,
  ProfitabilityPaymentRow, ProfitabilityRefinancingRow, ProfitabilitySummary,
} from '../../domain/entities/profitability';
import { apiClient } from './api-client';

const query = (values: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(values)
  .filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]));

export const profitabilityApi = {
  summary: (period: string) => apiClient.request<ProfitabilitySummary>(
    `/cash-movements/profitability?${query({ period })}`, { cache: 'no-store' }),
  capitalSeries: (period: string) => apiClient.request<EconomicCapitalSeries>(
    `/cash-movements/capital-rotation?${query({ period })}`, { cache: 'no-store' }),
  normal: (period: string, page: number, pageSize: 10 | 20 | 50, status?: ProfitabilityLoanStatus) =>
    apiClient.request<ProfitabilityPage<ProfitabilityNormalRow>>(
      `/cash-movements/profitability/normal?${query({ period, page, pageSize, status })}`, { cache: 'no-store' }),
  refinancings: (period: string, page: number, pageSize: 10 | 20 | 50, terminalStatus?: ProfitabilityLoanStatus) =>
    apiClient.request<ProfitabilityPage<ProfitabilityRefinancingRow>>(
      `/cash-movements/profitability/refinancings?${query({ period, page, pageSize, terminalStatus })}`, { cache: 'no-store' }),
  payments: (period: string, page: number, pageSize: 10 | 20 | 50, filters: ProfitabilityPaymentFilters = {}) =>
    apiClient.request<ProfitabilityPage<ProfitabilityPaymentRow>>(
      `/cash-movements/profitability/payments?${query({ period, page, pageSize, ...filters })}`, { cache: 'no-store' }),
};
