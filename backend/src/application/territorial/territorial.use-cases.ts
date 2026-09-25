import type { Canton, District, Province } from '../../domain/territorial/territorial.types';
import type { TerritorialRepository } from './territorial.repository';

export class ListProvincesUseCase {
  constructor(private readonly repository: TerritorialRepository) {}
  execute(): Promise<Province[]> { return this.repository.findProvinces(); }
}

export class ListCantonsUseCase {
  constructor(private readonly repository: TerritorialRepository) {}
  execute(provinceCode?: number): Promise<Canton[]> { return this.repository.findCantons({ provinceCode }); }
}

export class ListDistrictsUseCase {
  constructor(private readonly repository: TerritorialRepository) {}
  execute(filters?: { provinceCode?: number; cantonCode?: number }): Promise<District[]> { return this.repository.findDistricts(filters); }
}
