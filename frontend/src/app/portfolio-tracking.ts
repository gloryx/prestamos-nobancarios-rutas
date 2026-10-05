import { PortfolioTrackingController } from '../application/use-cases/portfolio-tracking-controller';
import { portfolioTrackingApi } from '../infrastructure/api/portfolio-tracking.api';

export const createPortfolioTracking = () => new PortfolioTrackingController(portfolioTrackingApi);
