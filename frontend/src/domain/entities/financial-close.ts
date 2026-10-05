export type FinancialCloseSectionKey =
  | 'liquidity'
  | 'contractualPortfolio'
  | 'economicCapital'
  | 'refinancings'
  | 'profitability'
  | 'reconciliations';

export type FinancialCloseValue = string | number | boolean | null;

export type FinancialCloseSection = Readonly<{
  status?: 'OK' | 'WARNING' | 'ERROR';
  values: Readonly<Record<string, FinancialCloseValue>>;
}>;

export type FinancialCloseIssue = Readonly<{
  code?: string;
  message: string;
  section?: FinancialCloseSectionKey;
}>;

export type FinancialClosePreview = Readonly<{
  period: string;
  generatedAt?: string;
  errors: FinancialCloseIssue[];
  warnings: FinancialCloseIssue[];
  sections: Readonly<Record<FinancialCloseSectionKey, FinancialCloseSection>>;
}>;

export type FinancialCloseListItem = Readonly<{
  id: string;
  period: string;
  confirmedAt: string;
  confirmedBy?: string | null;
}>;

export type FinancialCloseDetail = FinancialClosePreview & Readonly<{
  id: string;
  confirmedAt: string;
  confirmedBy?: string | null;
}>;
