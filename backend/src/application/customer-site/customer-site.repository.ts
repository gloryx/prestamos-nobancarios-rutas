import type { CustomerSiteUpdateAuthorization, SiteUpdateScope } from '../../domain/customer-site/customer-site.types';
export type AssignmentInput = { customerId: string; routeId: string; collectorUserId?: string };
export type AssignedCustomer = { id: string; identification: string; fullName: string; isActive: boolean; latitude: number | null; longitude: number | null; hasPropertyPhoto: boolean; siteDataUpdatedAt: Date | null; route: { id: string; name: string } };
export type AssignedCollector = { id: string; fullName: string; username: string };
export type RouteAssignmentOptions = {
  customers: Array<{ id: string; fullName: string; identification: string }>;
  routes: Array<{ id: string; name: string }>;
  collectors: Array<{ id: string; fullName: string; username: string }>;
};
export type CustomerSiteData = {
  latitude: number | null;
  longitude: number | null;
  hasPropertyPhoto: boolean;
  siteDataUpdatedAt: Date | null;
  siteDataUpdatedBy: { id: string; fullName: string } | null;
  activeAuthorization?: CustomerSiteUpdateAuthorization & { status: 'ACTIVE' };
};
export interface CustomerSiteRepository {
  hasCollectorAccess(customerId: string, collectorUserId: string): Promise<boolean>;
  listAssignedCustomers(collectorUserId: string): Promise<AssignedCustomer[]>;
  listAssignedCollectors(customerId: string): Promise<AssignedCollector[]>;
  listRouteAssignmentOptions(): Promise<RouteAssignmentOptions>;
  createCustomerAssignment(input: { customerId: string; routeId: string; assignedByUserId: string }): Promise<unknown>;
  createCollectorAssignment(input: { routeId: string; collectorUserId: string; assignedByUserId: string }): Promise<unknown>;
  endCustomerAssignment(id: string, endedAt: Date): Promise<void>;
  endCollectorAssignment(id: string, endedAt: Date): Promise<void>;
  validateAuthorizationTarget(customerId: string, collectorUserId: string): Promise<void>;
  createAuthorization(input: Omit<CustomerSiteUpdateAuthorization, 'id' | 'usedAt' | 'revokedAt'>): Promise<CustomerSiteUpdateAuthorization>;
  listAuthorizations(customerId: string): Promise<CustomerSiteUpdateAuthorization[]>;
  revokeAuthorization(id: string, customerId: string): Promise<void>;
  readSite(customerId: string, collectorUserId?: string): Promise<CustomerSiteData | null>;
  updateSiteAtomically(customerId: string, patch: { latitude?: number; longitude?: number; propertyPhotoFileKey?: string }, actorId: string, authorizationScopes: SiteUpdateScope[], at: Date): Promise<{ oldPropertyPhotoKey?: string }>;
}
export const CUSTOMER_SITE_REPOSITORY = Symbol('CUSTOMER_SITE_REPOSITORY');
