import type { Route } from '../../domain/entities/route';
import type { RouteInput, RouteRepository } from '../ports/route.repository';

export class ListRoutes { constructor(private readonly repository: RouteRepository) {} execute(): Promise<Route[]> { return this.repository.list(); } }
export class GetRoute { constructor(private readonly repository: RouteRepository) {} execute(id: string): Promise<Route> { return this.repository.get(id); } }
export class CreateRoute { constructor(private readonly repository: RouteRepository) {} execute(input: RouteInput): Promise<Route> { return this.repository.create(input); } }
export class UpdateRoute { constructor(private readonly repository: RouteRepository) {} execute(id: string, input: RouteInput): Promise<Route> { return this.repository.update(id, input); } }
export class ChangeRouteStatus { constructor(private readonly repository: RouteRepository) {} execute(id: string, active: boolean): Promise<Route> { return this.repository.changeStatus(id, active); } }
