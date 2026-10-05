import type { AssignmentBatchRequest, AssignmentWorkspaceQuery, CollectorRouteAssignmentInput, CustomerRouteAssignmentInput } from '../../domain/entities/route-assignment';
import type { RouteAssignmentRepository } from '../ports/route-assignment.repository';

export class GetRouteAssignmentOptions { constructor(private readonly repository: RouteAssignmentRepository) {} execute() { return this.repository.options(); } }
export class AssignCustomerToRoute { constructor(private readonly repository: RouteAssignmentRepository) {} execute(input: CustomerRouteAssignmentInput) { return this.repository.assignCustomer(input); } }
export class AssignCollectorToRoute { constructor(private readonly repository: RouteAssignmentRepository) {} execute(input: CollectorRouteAssignmentInput) { return this.repository.assignCollector(input); } }
export class GetRouteAssignmentWorkspace { constructor(private readonly repository: RouteAssignmentRepository) {} execute(query: AssignmentWorkspaceQuery) { return this.repository.workspace(query); } }
export class SaveRouteAssignmentWorkspace { constructor(private readonly repository: RouteAssignmentRepository) {} execute(request: AssignmentBatchRequest) { return this.repository.batch(request); } }
