export type FinancialOpening = {
  id: string;
  openingDate: string;
  initialAvailableAmount: string;
  initialPortfolio: string;
  initialUncollectibleAmount: string;
  historicalSeedCapital: string;
  observations: string | null;
  openedByUserId: string;
  openedAt: Date;
  openedBy: { id: string; fullName: string };
};
