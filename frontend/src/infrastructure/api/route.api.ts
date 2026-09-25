import type { Route } from '../../domain/entities/route';
import type { RouteInput, RouteRepository } from '../../application/ports/route.repository';

import { apiClient } from './api-client';
export class RouteApi implements RouteRepository {
  async list(): Promise<Route[]> { return this.request('/routes'); }
  async get(id: string): Promise<Route> { return this.request(`/routes/${id}`); }
  async create(input: RouteInput): Promise<Route> { return this.request('/routes', { method: 'POST', body: JSON.stringify(input) }); }
  async update(id: string, input: RouteInput): Promise<Route> { return this.request(`/routes/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  async changeStatus(id: string, isActive: boolean): Promise<Route> { return this.request(`/routes/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }); }
  private request<T>(path: string, options: RequestInit = {}): Promise<T> { return apiClient.request<T>(path, options); }
}
