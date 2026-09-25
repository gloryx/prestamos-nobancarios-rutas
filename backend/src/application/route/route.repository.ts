import type { Route } from '../../domain/route/route.types';

export type CreateRoute = { name: string };
export type UpdateRoute = Partial<CreateRoute>;

export interface RouteRepository {
  findAll(): Promise<Route[]>;
  findById(id: string): Promise<Route | null>;
  create(input: CreateRoute): Promise<Route>;
  update(id: string, input: UpdateRoute): Promise<Route | null>;
  updateStatus(id: string, isActive: boolean): Promise<Route | null>;
}

export const ROUTE_REPOSITORY = Symbol('ROUTE_REPOSITORY');
