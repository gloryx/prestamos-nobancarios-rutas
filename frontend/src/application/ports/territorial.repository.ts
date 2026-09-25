import type { Canton, District, Province } from '../../domain/entities/territorial';

export interface TerritorialRepository {
  getProvinces(): Promise<Province[]>;
  getCantons(provinceCode?: number): Promise<Canton[]>;
  getDistricts(filters?: { provinceCode?: number; cantonCode?: number }): Promise<District[]>;
}
