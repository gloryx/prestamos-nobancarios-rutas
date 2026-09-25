import type { RouteAssignmentRepository } from '../../application/ports/route-assignment.repository';
import type { CollectorRouteAssignmentInput, CustomerRouteAssignmentInput, RouteAssignmentOptions } from '../../domain/entities/route-assignment';
import { apiClient } from './api-client';

export class RouteAssignmentApi implements RouteAssignmentRepository {
  options(): Promise<RouteAssignmentOptions> { return apiClient.request('/route-assignments/options'); }
  assignCustomer(input: CustomerRouteAssignmentInput): Promise<unknown> { return apiClient.request('/route-assignments/customers', { method: 'POST', body: JSON.stringify(input) }); }
  assignCollector(input: CollectorRouteAssignmentInput): Promise<unknown> { return apiClient.request('/route-assignments/collectors', { method: 'POST', body: JSON.stringify(input) }); }
}
