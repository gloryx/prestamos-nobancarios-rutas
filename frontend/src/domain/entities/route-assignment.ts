export type RouteAssignmentOptions = {
  customers: Array<{ id: string; fullName: string; identification: string }>;
  routes: Array<{ id: string; name: string }>;
  collectors: Array<{ id: string; fullName: string; username: string }>;
};

export type CustomerRouteAssignmentInput = { customerId: string; routeId: string };
export type CollectorRouteAssignmentInput = { collectorUserId: string; routeId: string };

export type AssignmentWorkspaceCustomer = {
  customerId: string;
  name: string;
  identification: string;
  phone: string;
  cantonName?: string;
  districtName?: string;
  customerRouteAssignmentId?: string;
};
export type AssignmentWorkspaceRoute = {
  routeId: string;
  routeName: string;
  collectorAssignmentId?: string;
  customers: AssignmentWorkspaceCustomer[];
};
export type AssignmentWorkspaceCollector = {
  collectorId: string;
  collectorUserId: string;
  name: string;
  active: true;
  routes: AssignmentWorkspaceRoute[];
};
export type AssignmentWorkspace = {
  snapshotToken: string;
  collectors: AssignmentWorkspaceCollector[];
  unassignedRoutes: AssignmentWorkspaceRoute[];
  unassignedCustomers: { items: AssignmentWorkspaceCustomer[]; total: number; totalUnassigned: number; page: number; pageSize: 10 | 20 | 50 };
};
export type ActiveLoanFilter = 'ALL' | 'WITH_ACTIVE' | 'WITHOUT_ACTIVE';
export type AssignmentWorkspaceQuery = { search?: string; cantonCode?: number; districtCode?: number; activeLoanFilter?: ActiveLoanFilter; page: number; pageSize: 10 | 20 | 50 };
export type AssignmentBatchOperation =
  | { type: 'ASSIGN_ROUTE_TO_COLLECTOR'; routeId: string; collectorUserId: string }
  | { type: 'MOVE_ROUTE_TO_COLLECTOR'; routeId: string; collectorUserId: string; expectedAssignmentId: string }
  | { type: 'UNASSIGN_ROUTE_FROM_COLLECTOR'; routeId: string; expectedAssignmentId: string }
  | { type: 'ASSIGN_CUSTOMER_TO_ROUTE'; customerId: string; routeId: string }
  | { type: 'MOVE_CUSTOMER_TO_ROUTE'; customerId: string; routeId: string; expectedAssignmentId: string }
  | { type: 'UNASSIGN_CUSTOMER_FROM_ROUTE'; customerId: string; expectedAssignmentId: string };
export type AssignmentBatchRequest = { snapshotToken: string; operations: AssignmentBatchOperation[] };
export type AssignmentBatchResult = { applied: number; snapshotToken: string };
