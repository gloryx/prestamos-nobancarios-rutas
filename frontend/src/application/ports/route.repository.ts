import type { Route } from '../../domain/entities/route';

export type RouteInput = { name: string };
export interface RouteRepository { list(): Promise<Route[]>; get(id: string): Promise<Route>; create(input: RouteInput): Promise<Route>; update(id: string, input: RouteInput): Promise<Route>; changeStatus(id: string, isActive: boolean): Promise<Route>; }
