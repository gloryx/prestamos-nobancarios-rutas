import { EntityManager } from 'typeorm';
import { CantonOrmEntity, DistrictOrmEntity, ProvinceOrmEntity } from '../entities';
import { costaRicaDta2026Cantons, costaRicaDta2026Districts, costaRicaDta2026Provinces } from './data/costa-rica-dta-2026.data';
import { validateDta2026 } from './validation';

export async function seedCostaRicaDta2026(manager: EntityManager): Promise<void> {
  validateDta2026({ provinces: costaRicaDta2026Provinces, cantons: costaRicaDta2026Cantons, districts: costaRicaDta2026Districts });
  const provinces = manager.getRepository(ProvinceOrmEntity);
  const cantons = manager.getRepository(CantonOrmEntity);
  const districts = manager.getRepository(DistrictOrmEntity);
  await provinces.upsert(costaRicaDta2026Provinces.map(({ code, name }) => ({ code, name })), ['code']);
  await cantons.upsert(costaRicaDta2026Cantons.map(({ code, name, provinceCode }) => ({ code, name, provinceCode })), ['code']);
  await districts.upsert(costaRicaDta2026Districts.map(({ code, name, cantonCode }) => ({ code, name, cantonCode })), ['code']);
}
