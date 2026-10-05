import type { PortfolioTrackingRepository } from '../../application/ports/portfolio-tracking.repository';
import type { PortfolioTrackingQuery, PortfolioTrackingResult } from '../../domain/entities/portfolio-tracking';
import { apiClient } from './api-client';

export const portfolioTrackingApi: PortfolioTrackingRepository = {
  locate: (query: PortfolioTrackingQuery) => {
    const params = new URLSearchParams({ position: String(query.position) });
    if (query.search) params.set('search', query.search);
    if (query.status !== 'ALL') params.set('status', query.status);
    if (query.collectionStatus !== 'ALL') params.set('collectionStatus', query.collectionStatus);
    return apiClient.request<PortfolioTrackingResult>(`/payments/portfolio-tracking?${params}`, { cache: 'no-store' });
  },
};
