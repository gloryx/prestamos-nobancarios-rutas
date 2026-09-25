import type { Canton, District, Province } from '../../domain/entities/territorial';
import type { TerritorialRepository } from '../ports/territorial.repository';

export class ListProvinces {
  constructor(private readonly repository: TerritorialRepository) {}
  execute(): Promise<Province[]> { return this.repository.getProvinces(); }
}

export class ListCantons {
  constructor(private readonly repository: TerritorialRepository) {}
  execute(provinceCode?: number): Promise<Canton[]> { return this.repository.getCantons(provinceCode); }
}

export class ListDistricts {
  constructor(private readonly repository: TerritorialRepository) {}
  execute(filters?: { provinceCode?: number; cantonCode?: number }): Promise<District[]> { return this.repository.getDistricts(filters); }
}
