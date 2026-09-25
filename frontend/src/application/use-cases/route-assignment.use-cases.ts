import type { CollectorRouteAssignmentInput, CustomerRouteAssignmentInput } from '../../domain/entities/route-assignment';
import type { RouteAssignmentRepository } from '../ports/route-assignment.repository';

export class GetRouteAssignmentOptions { constructor(private readonly repository: RouteAssignmentRepository) {} execute() { return this.repository.options(); } }
export class AssignCustomerToRoute { constructor(private readonly repository: RouteAssignmentRepository) {} execute(input: CustomerRouteAssignmentInput) { return this.repository.assignCustomer(input); } }
export class AssignCollectorToRoute { constructor(private readonly repository: RouteAssignmentRepository) {} execute(input: CollectorRouteAssignmentInput) { return this.repository.assignCollector(input); } }
