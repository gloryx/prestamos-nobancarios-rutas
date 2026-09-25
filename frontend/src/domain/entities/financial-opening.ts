export type FinancialOpening = {
  id: string;
  openingDate: string;
  initialAvailableAmount: string;
  initialPortfolio: string;
  initialUncollectibleAmount: string;
  historicalSeedCapital: string;
  observations: string | null;
  openedBy: { id: string; fullName: string };
  openedAt: string;
};
export type FinancialOpeningResponse = { configured: boolean; opening: FinancialOpening | null };
