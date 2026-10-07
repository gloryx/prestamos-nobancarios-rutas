import type { CustomerSiteUpdateAuthorization, SiteUpdateScope } from '../../domain/customer-site/customer-site.types';
export type AssignmentInput = { customerId: string; routeId: string; collectorUserId?: string };
export type AssignedCustomerQuery = { search?: string; routeId?: string; page: number; pageSize: 10 | 20 | 50 };
export type AssignedCustomer = { id: string; identification: string; fullName: string; primaryPhone: string; latitude: number | null; longitude: number | null; hasPropertyPhoto: boolean; siteDataUpdatedAt: Date | null; route: { id: string; name: string } };
export type AssignedCustomerPage = { items: AssignedCustomer[]; total: number; routes: Array<{ id: string; name: string }> };
export type CollectorAccess = { collectorId: string; routeAllowed: boolean };
export type AssignedCollector = { id: string; fullName: string; username: string };
export type RouteAssignmentOptions = {
  customers: Array<{ id: string; fullName: string; identification: string }>;
  routes: Array<{ id: string; name: string }>;
  collectors: Array<{ id: string; fullName: string; username: string }>;
};
export type ActiveLoanFilter = 'ALL' | 'WITH_ACTIVE' | 'WITHOUT_ACTIVE';
export type AssignmentWorkspaceQuery = { search?: string; cantonCode?: number; districtCode?: number; activeLoanFilter?: ActiveLoanFilter; page: number; pageSize: 10 | 20 | 50 };
export type AssignmentWorkspaceCustomer = { customerId: string; name: string; identification: string; phone: string; cantonName?: string; districtName?: string; customerRouteAssignmentId?: string };
export type AssignmentWorkspaceRoute = { routeId: string; routeName: string; collectorAssignmentId?: string; customers: AssignmentWorkspaceCustomer[] };
export type AssignmentWorkspace = {
  snapshotToken: string;
  collectors: Array<{ collectorId: string; collectorUserId: string; name: string; active: true; routes: AssignmentWorkspaceRoute[] }>;
  unassignedRoutes: AssignmentWorkspaceRoute[];
  unassignedCustomers: { items: AssignmentWorkspaceCustomer[]; total: number; totalUnassigned: number; page: number; pageSize: number };
};
export type AssignmentBatchOperation =
  | { type: 'ASSIGN_ROUTE_TO_COLLECTOR'; routeId: string; collectorUserId: string }
  | { type: 'MOVE_ROUTE_TO_COLLECTOR'; routeId: string; collectorUserId: string; expectedAssignmentId: string }
  | { type: 'UNASSIGN_ROUTE_FROM_COLLECTOR'; routeId: string; expectedAssignmentId: string }
  | { type: 'ASSIGN_CUSTOMER_TO_ROUTE'; customerId: string; routeId: string }
  | { type: 'MOVE_CUSTOMER_TO_ROUTE'; customerId: string; routeId: string; expectedAssignmentId: string }
  | { type: 'UNASSIGN_CUSTOMER_FROM_ROUTE'; customerId: string; expectedAssignmentId: string };
export type AssignmentBatchInput = { snapshotToken: string; operations: AssignmentBatchOperation[]; actorId: string };
export type CustomerSiteData = {
  customer: { id: string; fullName: string; identification: string; primaryPhone: string; secondaryPhone: string | null };
  route: { id: string; name: string } | null;
  address: { province: string; canton: string; district: string; exactAddress: string };
  latitude: number | null;
  longitude: number | null;
  hasPropertyPhoto: boolean;
  siteDataUpdatedAt: Date | null;
  siteDataUpdatedBy: { id: string; fullName: string } | null;
  activeAuthorization?: CustomerSiteUpdateAuthorization & { status: 'ACTIVE' };
};
export interface CustomerSiteRepository {
  resolveCollectorAccess(collectorUserId: string, routeId?: string): Promise<CollectorAccess | null>;
  hasCollectorAccess(customerId: string, collectorUserId: string): Promise<boolean>;
  listAssignedCustomers(collectorUserId: string, query: AssignedCustomerQuery): Promise<AssignedCustomerPage>;
  listAssignedCollectors(customerId: string): Promise<AssignedCollector[]>;
  listRouteAssignmentOptions(): Promise<RouteAssignmentOptions>;
  readAssignmentWorkspace(query: AssignmentWorkspaceQuery): Promise<AssignmentWorkspace>;
  applyAssignmentBatch(input: AssignmentBatchInput): Promise<{ applied: number; snapshotToken: string }>;
  createCustomerAssignment(input: { customerId: string; routeId: string; assignedByUserId: string }): Promise<unknown>;
  createCollectorAssignment(input: { routeId: string; collectorUserId: string; assignedByUserId: string }): Promise<unknown>;
  endCustomerAssignment(id: string, endedAt: Date): Promise<void>;
  endCollectorAssignment(id: string, endedAt: Date): Promise<void>;
  validateAuthorizationTarget(customerId: string, collectorUserId: string): Promise<void>;
  createAuthorization(input: Omit<CustomerSiteUpdateAuthorization, 'id' | 'usedAt' | 'revokedAt'>): Promise<CustomerSiteUpdateAuthorization>;
  listAuthorizations(customerId: string): Promise<CustomerSiteUpdateAuthorization[]>;
  revokeAuthorization(id: string, customerId: string): Promise<void>;
  readSite(customerId: string, collectorUserId?: string): Promise<CustomerSiteData | null>;
  readPropertyPhotoKey(customerId: string, collectorUserId?: string): Promise<string | null | undefined>;
  updateSiteAtomically(customerId: string, patch: { latitude?: number; longitude?: number; propertyPhotoFileKey?: string }, actorId: string, authorizationScopes: SiteUpdateScope[], at: Date, enforceCollectorScope: boolean): Promise<{ oldPropertyPhotoKey?: string }>;
}
export const CUSTOMER_SITE_REPOSITORY = Symbol('CUSTOMER_SITE_REPOSITORY');
