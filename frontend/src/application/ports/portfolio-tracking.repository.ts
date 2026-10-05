import type { PortfolioTrackingQuery, PortfolioTrackingResult } from '../../domain/entities/portfolio-tracking';

export interface PortfolioTrackingRepository {
  locate(query: PortfolioTrackingQuery): Promise<PortfolioTrackingResult>;
}
