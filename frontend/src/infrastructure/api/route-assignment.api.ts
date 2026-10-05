import { RouteAssignmentRepositoryError, type RouteAssignmentRepository } from '../../application/ports/route-assignment.repository';
import type { AssignmentBatchRequest, AssignmentBatchResult, AssignmentWorkspace, AssignmentWorkspaceQuery, CollectorRouteAssignmentInput, CustomerRouteAssignmentInput, RouteAssignmentOptions } from '../../domain/entities/route-assignment';
import { apiClient, HttpApiError } from './api-client';

const mapError = (error: unknown): never => {
  if (error instanceof HttpApiError) throw new RouteAssignmentRepositoryError(error.status === 409 ? 'CONFLICT' : error.status === 403 ? 'FORBIDDEN' : 'SERVER', error.message);
  if (error instanceof TypeError) throw new RouteAssignmentRepositoryError('NETWORK', 'No fue posible conectar con el servidor.');
  throw error;
};

export class RouteAssignmentApi implements RouteAssignmentRepository {
  options(): Promise<RouteAssignmentOptions> { return apiClient.request('/route-assignments/options'); }
  assignCustomer(input: CustomerRouteAssignmentInput): Promise<unknown> { return apiClient.request('/route-assignments/customers', { method: 'POST', body: JSON.stringify(input) }); }
  assignCollector(input: CollectorRouteAssignmentInput): Promise<unknown> { return apiClient.request('/route-assignments/collectors', { method: 'POST', body: JSON.stringify(input) }); }
  workspace(query: AssignmentWorkspaceQuery): Promise<AssignmentWorkspace> {
    const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
    if (query.search?.trim()) params.set('search', query.search.trim());
    if (query.cantonCode !== undefined) params.set('cantonCode', String(query.cantonCode));
    if (query.districtCode !== undefined) params.set('districtCode', String(query.districtCode));
    return apiClient.request<AssignmentWorkspace>(`/route-assignments/workspace?${params}`).catch(mapError);
  }
  batch(request: AssignmentBatchRequest): Promise<AssignmentBatchResult> {
    return apiClient.request<AssignmentBatchResult>('/route-assignments/batch', { method: 'POST', body: JSON.stringify(request) }).catch(mapError);
  }
}
