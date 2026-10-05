import type { AssignmentBatchRequest, AssignmentBatchResult, AssignmentWorkspace, AssignmentWorkspaceQuery, CollectorRouteAssignmentInput, CustomerRouteAssignmentInput, RouteAssignmentOptions } from '../../domain/entities/route-assignment';

export type RouteAssignmentFailure = 'CONFLICT' | 'FORBIDDEN' | 'NETWORK' | 'SERVER';
export class RouteAssignmentRepositoryError extends Error {
  constructor(readonly reason: RouteAssignmentFailure, message: string) { super(message); this.name = 'RouteAssignmentRepositoryError'; }
}

export interface RouteAssignmentRepository {
  options(): Promise<RouteAssignmentOptions>;
  assignCustomer(input: CustomerRouteAssignmentInput): Promise<unknown>;
  assignCollector(input: CollectorRouteAssignmentInput): Promise<unknown>;
  workspace(query: AssignmentWorkspaceQuery): Promise<AssignmentWorkspace>;
  batch(request: AssignmentBatchRequest): Promise<AssignmentBatchResult>;
}
