import type { LoanStatus } from '../../domain/loan/loan.types';
import type { PaymentContextUseCase } from './payment.use-case';
import { PaymentValidationError } from './payment.errors';

export const PORTFOLIO_TRACKING_READER = Symbol('PORTFOLIO_TRACKING_READER');

export const PORTFOLIO_LOAN_STATUSES = ['ACTIVE', 'UNCOLLECTIBLE'] as const;
export const COLLECTION_STATUSES = ['ON_TRACK', 'PENDING', 'OVERDUE', 'TERM_EXPIRED'] as const;
export type PortfolioLoanStatus = Extract<LoanStatus, (typeof PORTFOLIO_LOAN_STATUSES)[number]>;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];
export type PortfolioTrackingQuery = {
  search: string;
  status: PortfolioLoanStatus | 'ALL';
  collectionStatus: CollectionStatus | 'ALL';
  position: number;
};
export type PortfolioTrackingPosition = {
  loanId: string;
  status: PortfolioLoanStatus;
  collectionStatus: CollectionStatus | null;
  startDate: string;
  contractualDueDate: string | null;
  position: number;
  total: number;
};

export interface PortfolioTrackingReader {
  locate(query: PortfolioTrackingQuery): Promise<PortfolioTrackingPosition | null>;
}

export class PortfolioTrackingUseCase {
  constructor(private readonly reader: PortfolioTrackingReader, private readonly paymentContext: Pick<PaymentContextUseCase, 'execute'>) {}

  async execute(query: PortfolioTrackingQuery) {
    const search = query.search.trim();
    if (search.length > 200 || (query.status !== 'ALL' && !PORTFOLIO_LOAN_STATUSES.includes(query.status))
      || (query.collectionStatus !== 'ALL' && !COLLECTION_STATUSES.includes(query.collectionStatus))
      || !Number.isSafeInteger(query.position) || query.position < 1)
      throw new PaymentValidationError('Los criterios de seguimiento de cartera no son válidos.');
    const located = await this.reader.locate({ ...query, search });
    if (!located) return { position: 0, total: 0, hasPrevious: false, hasNext: false, loan: null };
    const context = await this.paymentContext.execute(located.loanId);
    return {
      position: located.position,
      total: located.total,
      hasPrevious: located.position > 1,
      hasNext: located.position < located.total,
      loan: {
        id: located.loanId,
        status: located.status,
        collectionStatus: located.collectionStatus,
        startDate: located.startDate,
        contractualDueDate: located.contractualDueDate,
        context,
      },
    };
  }
}
