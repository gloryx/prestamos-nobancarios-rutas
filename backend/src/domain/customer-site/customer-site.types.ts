export type SiteUpdateScope = 'LOCATION' | 'PHOTO' | 'LOCATION_AND_PHOTO';
export type CustomerRouteAssignment = { id: string; customerId: string; routeId: string; assignedByUserId: string; assignedAt: Date; endedAt: Date | null };
export type CollectorRouteAssignment = { id: string; collectorUserId: string; routeId: string; assignedByUserId: string; assignedAt: Date; endedAt: Date | null };
export type CustomerSiteUpdateAuthorization = { id: string; customerId: string; collectorUserId: string; scope: SiteUpdateScope; reason: string; authorizedByUserId: string; authorizedAt: Date; expiresAt: Date; usedAt: Date | null; revokedAt: Date | null };
