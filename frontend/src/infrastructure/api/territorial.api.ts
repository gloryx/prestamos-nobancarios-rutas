import type { Canton, District, Province } from '../../domain/entities/territorial';
import type { TerritorialRepository } from '../../application/ports/territorial.repository';

import { apiClient } from './api-client';

export class TerritorialApi implements TerritorialRepository {
  async getProvinces(): Promise<Province[]> { return this.get<Province[]>('/territorial/provinces'); }

  async getCantons(provinceCode?: number): Promise<Canton[]> {
    const query = provinceCode === undefined ? '' : `?provinceCode=${provinceCode}`;
    return this.get<Canton[]>(`/territorial/cantons${query}`);
  }

  async getDistricts(filters: { provinceCode?: number; cantonCode?: number } = {}): Promise<District[]> {
    const params = new URLSearchParams();
    if (filters.provinceCode !== undefined) params.set('provinceCode', String(filters.provinceCode));
    if (filters.cantonCode !== undefined) params.set('cantonCode', String(filters.cantonCode));
    const query = params.toString();
    return this.get<District[]>(`/territorial/districts${query ? `?${query}` : ''}`);
  }

  private async get<T>(path: string): Promise<T> {
    return apiClient.request<T>(path);
  }
}
