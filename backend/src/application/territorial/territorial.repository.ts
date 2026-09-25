import type { Canton, District, Province } from '../../domain/territorial/territorial.types';

export type TerritorialFilters = { provinceCode?: number; cantonCode?: number };

export interface TerritorialRepository {
  findProvinces(): Promise<Province[]>;
  findCantons(filters?: Pick<TerritorialFilters, 'provinceCode'>): Promise<Canton[]>;
  findDistricts(filters?: TerritorialFilters): Promise<District[]>;
}

export const TERRITORIAL_REPOSITORY = Symbol('TERRITORIAL_REPOSITORY');
