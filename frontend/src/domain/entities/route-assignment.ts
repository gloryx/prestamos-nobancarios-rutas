export type RouteAssignmentOptions = {
  customers: Array<{ id: string; fullName: string; identification: string }>;
  routes: Array<{ id: string; name: string }>;
  collectors: Array<{ id: string; fullName: string; username: string }>;
};

export type CustomerRouteAssignmentInput = { customerId: string; routeId: string };
export type CollectorRouteAssignmentInput = { collectorUserId: string; routeId: string };
