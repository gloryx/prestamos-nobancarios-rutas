import type { FinancialCloseDetail, FinancialCloseIssue, FinancialCloseListItem, FinancialClosePreview,
  FinancialCloseSection, FinancialCloseSectionKey, FinancialCloseValue } from '../../domain/entities/financial-close';
import { apiClient } from './api-client';

type RawConcept = { code?: string; label?: string; amount?: FinancialCloseValue };
type RawSection = { code?: string; status?: FinancialCloseSection['status']; concepts?: RawConcept[];
  values?: Record<string, FinancialCloseValue> };
type RawClose = Omit<Partial<FinancialCloseDetail>, 'confirmedBy' | 'sections'> & {
  integrity?: { status?: string; blockingIssues?: string[]; warnings?: string[] };
  sections?: RawSection[] | FinancialClosePreview['sections'];
  confirmedBy?: string | { fullName?: string } | null;
};

const sectionKeys: FinancialCloseSectionKey[] = ['liquidity', 'contractualPortfolio', 'economicCapital',
  'refinancings', 'profitability', 'reconciliations'];
const sectionMap: Record<string, FinancialCloseSectionKey> = {
  CASH: 'liquidity', LIQUIDITY: 'liquidity', CONTRACTUAL_PORTFOLIO: 'contractualPortfolio',
  EXPOSURE: 'contractualPortfolio', ECONOMIC_CAPITAL: 'economicCapital', REFINANCINGS: 'refinancings',
  PROFITABILITY: 'profitability', RECONCILIATION: 'reconciliations', RECONCILIATIONS: 'reconciliations',
};
const issue = (message: string): FinancialCloseIssue => ({ message });
const emptySections = () => Object.fromEntries(sectionKeys.map((key) => [key, { values: {} }])) as
  Record<FinancialCloseSectionKey, FinancialCloseSection>;

function normalizePreview(raw: RawClose): FinancialClosePreview {
  const normalized = emptySections();
  if (Array.isArray(raw.sections)) for (const section of raw.sections) {
    const key = sectionMap[section.code ?? ''];
    if (!key) continue;
    normalized[key] = { status: section.status, values: section.values ?? Object.fromEntries(
      (section.concepts ?? []).map((concept) => [concept.label ?? concept.code ?? 'Valor', concept.amount ?? null])) };
  } else if (raw.sections) for (const key of sectionKeys) normalized[key] = raw.sections[key] ?? normalized[key];
  const errors = raw.errors ?? raw.integrity?.blockingIssues?.map(issue) ?? [];
  const warnings = raw.warnings ?? raw.integrity?.warnings?.map(issue) ?? [];
  return { period: raw.period ?? '', generatedAt: raw.generatedAt, errors, warnings, sections: normalized };
}

function normalizeDetail(raw: RawClose): FinancialCloseDetail {
  const confirmedBy = typeof raw.confirmedBy === 'object' ? raw.confirmedBy?.fullName : raw.confirmedBy;
  return { ...normalizePreview(raw), id: raw.id ?? '', confirmedAt: raw.confirmedAt ?? '', confirmedBy };
}

export const financialCloseApi = {
  preview: async (period: string) => normalizePreview(await apiClient.request<RawClose>(
    `/financial-closes/preview?${new URLSearchParams({ period })}`, { cache: 'no-store' })),
  confirm: async (period: string) => normalizeDetail(await apiClient.request<RawClose>('/financial-closes', {
    method: 'POST', body: JSON.stringify({ period }),
  })),
  list: async () => {
    const result = await apiClient.request<RawClose[] | { items: RawClose[] }>('/financial-closes', { cache: 'no-store' });
    return (Array.isArray(result) ? result : result.items).map((item): FinancialCloseListItem => ({ id: item.id ?? '',
      period: item.period ?? '', confirmedAt: item.confirmedAt ?? '', confirmedBy: typeof item.confirmedBy === 'object'
        ? item.confirmedBy?.fullName : item.confirmedBy }));
  },
  detail: async (id: string) => normalizeDetail(await apiClient.request<RawClose>(
    `/financial-closes/${encodeURIComponent(id)}`, { cache: 'no-store' })),
};
