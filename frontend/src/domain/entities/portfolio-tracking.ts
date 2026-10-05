import type { LoanStatus, PaymentContext } from './payment';

export type PortfolioLoanStatus = Extract<LoanStatus, 'ACTIVE' | 'UNCOLLECTIBLE'>;
export type CollectionStatus = 'ON_TRACK' | 'PENDING' | 'OVERDUE' | 'TERM_EXPIRED';
export type PortfolioTrackingFilters = {
  search: string;
  status: PortfolioLoanStatus | 'ALL';
  collectionStatus: CollectionStatus | 'ALL';
};
export type PortfolioTrackingQuery = PortfolioTrackingFilters & { position: number };
export type PortfolioTrackingResult = {
  position: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  loan: null | {
    id: string;
    status: PortfolioLoanStatus;
    collectionStatus: CollectionStatus | null;
    startDate: string;
    contractualDueDate: string | null;
    context: PaymentContext;
  };
};
