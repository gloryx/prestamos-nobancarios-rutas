import type { CollectorRouteAssignmentInput, CustomerRouteAssignmentInput, RouteAssignmentOptions } from '../../domain/entities/route-assignment';

export interface RouteAssignmentRepository {
  options(): Promise<RouteAssignmentOptions>;
  assignCustomer(input: CustomerRouteAssignmentInput): Promise<unknown>;
  assignCollector(input: CollectorRouteAssignmentInput): Promise<unknown>;
}
