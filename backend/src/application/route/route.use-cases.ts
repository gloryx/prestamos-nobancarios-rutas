import { RouteNotFoundError } from '../../domain/route/route.errors';
import type { Route } from '../../domain/route/route.types';
import type { CreateRoute, RouteRepository, UpdateRoute } from './route.repository';

export class ListRoutesUseCase { constructor(private readonly repository: RouteRepository) {} execute(): Promise<Route[]> { return this.repository.findAll(); } }
export class GetRouteUseCase {
  constructor(private readonly repository: RouteRepository) {}
  async execute(id: string): Promise<Route> { const item = await this.repository.findById(id); if (!item) throw new RouteNotFoundError(id); return item; }
}
export class CreateRouteUseCase { constructor(private readonly repository: RouteRepository) {} execute(input: CreateRoute): Promise<Route> { return this.repository.create({ name: input.name.trim() }); } }
export class UpdateRouteUseCase {
  constructor(private readonly repository: RouteRepository) {}
  async execute(id: string, input: UpdateRoute): Promise<Route> { const item = await this.repository.update(id, { ...input, name: input.name?.trim() }); if (!item) throw new RouteNotFoundError(id); return item; }
}
export class ChangeRouteStatusUseCase {
  constructor(private readonly repository: RouteRepository) {}
  async execute(id: string, isActive: boolean): Promise<Route> { const item = await this.repository.updateStatus(id, isActive); if (!item) throw new RouteNotFoundError(id); return item; }
}
