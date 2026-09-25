import { Repository } from 'typeorm';
import { CantonOrmEntity, DistrictOrmEntity, ProvinceOrmEntity } from '../entities';
import type { Canton, District, Province } from '../../../../domain/territorial/territorial.types';
import type { TerritorialFilters, TerritorialRepository } from '../../../../application/territorial/territorial.repository';

export class TerritorialTypeOrmRepository implements TerritorialRepository {
  constructor(
    private readonly provinces: Repository<ProvinceOrmEntity>,
    private readonly cantons: Repository<CantonOrmEntity>,
    private readonly districts: Repository<DistrictOrmEntity>,
  ) {}

  async findProvinces(): Promise<Province[]> {
    const rows = await this.provinces.createQueryBuilder('province').orderBy('province.code', 'ASC').getMany();
    return rows.map(({ code, name }) => ({ code, name }));
  }

  async findCantons(filters: Pick<TerritorialFilters, 'provinceCode'> = {}): Promise<Canton[]> {
    const query = this.cantons.createQueryBuilder('canton').innerJoinAndSelect('canton.province', 'province').orderBy('canton.code', 'ASC');
    if (filters.provinceCode !== undefined) query.andWhere('canton.provinceCode = :provinceCode', { provinceCode: filters.provinceCode });
    const rows = await query.getMany();
    return rows.map((canton) => ({ code: canton.code, name: canton.name, province: { code: canton.province.code, name: canton.province.name } }));
  }

  async findDistricts(filters: TerritorialFilters = {}): Promise<District[]> {
    const query = this.districts.createQueryBuilder('district').innerJoinAndSelect('district.canton', 'canton').innerJoinAndSelect('canton.province', 'province').orderBy('district.code', 'ASC');
    if (filters.provinceCode !== undefined) query.andWhere('province.code = :provinceCode', { provinceCode: filters.provinceCode });
    if (filters.cantonCode !== undefined) query.andWhere('district.cantonCode = :cantonCode', { cantonCode: filters.cantonCode });
    const rows = await query.getMany();
    return rows.map((district) => ({
      code: district.code,
      name: district.name,
      canton: { code: district.canton.code, name: district.canton.name },
      province: { code: district.canton.province.code, name: district.canton.province.name },
    }));
  }
}
