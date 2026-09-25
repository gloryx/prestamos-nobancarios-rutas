export type SiteUpdateScope = 'LOCATION' | 'PHOTO' | 'LOCATION_AND_PHOTO';

export type CustomerSite = {
  latitude: number | null;
  longitude: number | null;
  hasPropertyPhoto: boolean;
  siteDataUpdatedAt: string | null;
  siteDataUpdatedBy: { id: string; fullName: string } | null;
  activeAuthorization?: SiteAuthorization;
};

export type AssignedCustomer = {
  id: string;
  identification: string;
  fullName: string;
  isActive: boolean;
  latitude: number | null;
  longitude: number | null;
  hasPropertyPhoto: boolean;
  siteDataUpdatedAt: string | null;
  route: { id: string; name: string };
};

export type AssignedCollector = {
  id: string;
  fullName: string;
  username: string;
};

export type SiteAuthorization = {
  id: string;
  customerId: string;
  collectorUserId: string;
  scope: SiteUpdateScope;
  reason: string;
  authorizedByUserId: string;
  authorizedAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  status?: 'ACTIVE' | 'REVOKED' | 'USED' | 'EXPIRED';
};
