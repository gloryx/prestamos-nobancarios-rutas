export type SiteUpdateScope = 'LOCATION' | 'PHOTO' | 'LOCATION_AND_PHOTO';

export type CustomerSite = {
  customer: { id: string; fullName: string; identification: string; primaryPhone: string; secondaryPhone: string | null };
  route: { id: string; name: string } | null;
  address: { province: string; canton: string; district: string; exactAddress: string };
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
  primaryPhone: string;
  isActive: boolean;
  latitude: number | null;
  longitude: number | null;
  hasPropertyPhoto: boolean;
  siteDataUpdatedAt: string | null;
  route: { id: string; name: string };
};

export type AssignedCustomerQuery = { search?: string; routeId?: string; page: number; pageSize: 10 | 20 | 50 };
export type AssignedCustomerResult = {
  items: AssignedCustomer[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  routes: Array<{ id: string; name: string }>;
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
