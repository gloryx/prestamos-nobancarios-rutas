import type { AssignmentBatchOperation, AssignmentWorkspace, AssignmentWorkspaceCustomer, AssignmentWorkspaceQuery, AssignmentWorkspaceRoute } from '../../domain/entities/route-assignment';
import { RouteAssignmentRepositoryError } from '../ports/route-assignment.repository';

export const cloneAssignmentWorkspace = (workspace: AssignmentWorkspace): AssignmentWorkspace => structuredClone(workspace);

export function updateAssignmentWorkspaceFilters(current: AssignmentWorkspaceQuery, patch: Partial<Pick<AssignmentWorkspaceQuery, 'search' | 'cantonCode' | 'districtCode'>>): AssignmentWorkspaceQuery {
  const next = { ...current, ...patch, page: 1 };
  if (Object.hasOwn(patch, 'cantonCode') && patch.cantonCode !== current.cantonCode) next.districtCode = undefined;
  return next;
}

const routes = (workspace: AssignmentWorkspace): AssignmentWorkspaceRoute[] => [
  ...workspace.collectors.flatMap((collector) => collector.routes),
  ...workspace.unassignedRoutes,
];

export const routeOwner = (workspace: AssignmentWorkspace, routeId: string): string | null | undefined => {
  const collector = workspace.collectors.find((item) => item.routes.some((route) => route.routeId === routeId));
  if (collector) return collector.collectorUserId;
  return workspace.unassignedRoutes.some((route) => route.routeId === routeId) ? null : undefined;
};

export const customerRoute = (workspace: AssignmentWorkspace, customerId: string): string | null | undefined => {
  const route = routes(workspace).find((item) => item.customers.some((customer) => customer.customerId === customerId));
  if (route) return route.routeId;
  return workspace.unassignedCustomers.items.some((customer) => customer.customerId === customerId) ? null : undefined;
};

export function moveRoute(workspace: AssignmentWorkspace, routeId: string, collectorUserId: string | null): AssignmentWorkspace {
  if (routeOwner(workspace, routeId) === collectorUserId) return workspace;
  const next = cloneAssignmentWorkspace(workspace);
  let moving: AssignmentWorkspaceRoute | undefined;
  for (const collector of next.collectors) {
    const index = collector.routes.findIndex((route) => route.routeId === routeId);
    if (index >= 0) [moving] = collector.routes.splice(index, 1);
  }
  const unassignedIndex = next.unassignedRoutes.findIndex((route) => route.routeId === routeId);
  if (unassignedIndex >= 0) [moving] = next.unassignedRoutes.splice(unassignedIndex, 1);
  if (!moving) return workspace;
  if (collectorUserId === null) next.unassignedRoutes.push(moving);
  else {
    const collector = next.collectors.find((item) => item.collectorUserId === collectorUserId);
    if (!collector) return workspace;
    collector.routes.push(moving);
  }
  return next;
}

export function moveCustomer(workspace: AssignmentWorkspace, customerId: string, routeId: string | null): AssignmentWorkspace {
  if (customerRoute(workspace, customerId) === routeId) return workspace;
  const next = cloneAssignmentWorkspace(workspace);
  let moving: AssignmentWorkspaceCustomer | undefined;
  for (const route of routes(next)) {
    const index = route.customers.findIndex((customer) => customer.customerId === customerId);
    if (index >= 0) [moving] = route.customers.splice(index, 1);
  }
  const unassignedIndex = next.unassignedCustomers.items.findIndex((customer) => customer.customerId === customerId);
  if (unassignedIndex >= 0) {
    [moving] = next.unassignedCustomers.items.splice(unassignedIndex, 1);
    next.unassignedCustomers.total -= 1;
    next.unassignedCustomers.totalUnassigned -= 1;
  }
  if (!moving) return workspace;
  if (routeId === null) {
    next.unassignedCustomers.items.unshift(moving);
    next.unassignedCustomers.total += 1;
    next.unassignedCustomers.totalUnassigned += 1;
  } else {
    const target = routes(next).find((route) => route.routeId === routeId);
    if (!target) return workspace;
    target.customers.push(moving);
  }
  return next;
}

type RoutePosition = { collectorUserId: string | null; assignmentId?: string };
type CustomerPosition = { routeId: string | null; assignmentId?: string };
const routePositions = (workspace: AssignmentWorkspace): Map<string, RoutePosition> => {
  const positions = new Map<string, RoutePosition>();
  for (const collector of workspace.collectors) for (const route of collector.routes) positions.set(route.routeId, { collectorUserId: collector.collectorUserId, assignmentId: route.collectorAssignmentId });
  for (const route of workspace.unassignedRoutes) positions.set(route.routeId, { collectorUserId: null, assignmentId: route.collectorAssignmentId });
  return positions;
};
const customerPositions = (workspace: AssignmentWorkspace): Map<string, CustomerPosition> => {
  const positions = new Map<string, CustomerPosition>();
  for (const route of routes(workspace)) for (const customer of route.customers) positions.set(customer.customerId, { routeId: route.routeId, assignmentId: customer.customerRouteAssignmentId });
  for (const customer of workspace.unassignedCustomers.items) positions.set(customer.customerId, { routeId: null, assignmentId: customer.customerRouteAssignmentId });
  return positions;
};

export function deriveAssignmentOperations(confirmed: AssignmentWorkspace, working: AssignmentWorkspace): AssignmentBatchOperation[] {
  const operations: AssignmentBatchOperation[] = [];
  const originalRoutes = routePositions(confirmed);
  const currentRoutes = routePositions(working);
  for (const [routeId, original] of originalRoutes) {
    const current = currentRoutes.get(routeId);
    if (!current || original.collectorUserId === current.collectorUserId) continue;
    if (original.collectorUserId === null && current.collectorUserId !== null) operations.push({ type: 'ASSIGN_ROUTE_TO_COLLECTOR', routeId, collectorUserId: current.collectorUserId });
    else if (original.collectorUserId !== null && current.collectorUserId === null) operations.push({ type: 'UNASSIGN_ROUTE_FROM_COLLECTOR', routeId, expectedAssignmentId: original.assignmentId! });
    else operations.push({ type: 'MOVE_ROUTE_TO_COLLECTOR', routeId, collectorUserId: current.collectorUserId!, expectedAssignmentId: original.assignmentId! });
  }
  const originalCustomers = customerPositions(confirmed);
  const currentCustomers = customerPositions(working);
  for (const [customerId, original] of originalCustomers) {
    const current = currentCustomers.get(customerId);
    if (!current || original.routeId === current.routeId) continue;
    if (original.routeId === null && current.routeId !== null) operations.push({ type: 'ASSIGN_CUSTOMER_TO_ROUTE', customerId, routeId: current.routeId });
    else if (original.routeId !== null && current.routeId === null) operations.push({ type: 'UNASSIGN_CUSTOMER_FROM_ROUTE', customerId, expectedAssignmentId: original.assignmentId! });
    else operations.push({ type: 'MOVE_CUSTOMER_TO_ROUTE', customerId, routeId: current.routeId!, expectedAssignmentId: original.assignmentId! });
  }
  return operations;
}

export const pendingAssignmentIds = (operations: AssignmentBatchOperation[]) => ({
  routes: new Set(operations.flatMap((operation) => operation.type === 'ASSIGN_ROUTE_TO_COLLECTOR' || operation.type === 'MOVE_ROUTE_TO_COLLECTOR' || operation.type === 'UNASSIGN_ROUTE_FROM_COLLECTOR' ? [operation.routeId] : [])),
  customers: new Set(operations.flatMap((operation) => operation.type === 'ASSIGN_CUSTOMER_TO_ROUTE' || operation.type === 'MOVE_CUSTOMER_TO_ROUTE' || operation.type === 'UNASSIGN_CUSTOMER_FROM_ROUTE' ? [operation.customerId] : [])),
});

export type SaveAssignmentDraftResult =
  | { status: 'NO_CHANGES'; confirmed: AssignmentWorkspace; working: AssignmentWorkspace }
  | { status: 'SAVED'; confirmed: AssignmentWorkspace; working: AssignmentWorkspace; applied: number }
  | { status: 'CONFLICT' | 'FAILED'; confirmed: AssignmentWorkspace; working: AssignmentWorkspace; error: unknown };

export async function saveAssignmentDraft(confirmed: AssignmentWorkspace, working: AssignmentWorkspace,
  save: (request: { snapshotToken: string; operations: AssignmentBatchOperation[] }) => Promise<{ applied: number; snapshotToken: string }>): Promise<SaveAssignmentDraftResult> {
  const operations = deriveAssignmentOperations(confirmed, working);
  if (!operations.length) return { status: 'NO_CHANGES', confirmed, working };
  try {
    const result = await save({ snapshotToken: confirmed.snapshotToken, operations });
    const saved = { ...cloneAssignmentWorkspace(working), snapshotToken: result.snapshotToken };
    return { status: 'SAVED', confirmed: saved, working: cloneAssignmentWorkspace(saved), applied: result.applied };
  } catch (error) {
    return { status: error instanceof RouteAssignmentRepositoryError && error.reason === 'CONFLICT' ? 'CONFLICT' : 'FAILED', confirmed, working, error };
  }
}
