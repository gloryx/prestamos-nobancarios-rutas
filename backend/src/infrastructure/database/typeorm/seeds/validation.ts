import { CantonSeed, DistrictSeed, ProvinceSeed } from './data/costa-rica-dta-2026.data';

export interface DtaSeedData {
  readonly provinces: readonly ProvinceSeed[];
  readonly cantons: readonly CantonSeed[];
  readonly districts: readonly DistrictSeed[];
}

const assertUnique = (kind: string, values: readonly number[]): void => {
  if (new Set(values).size !== values.length) throw new Error(`${kind} codes must be unique`);
};

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

export function validateDta2026(data: DtaSeedData): void {
  if (data.provinces.length !== 7) throw new Error(`Expected 7 provinces, received ${data.provinces.length}`);
  if (data.cantons.length !== 84) throw new Error(`Expected 84 cantons, received ${data.cantons.length}`);
  if (data.districts.length !== 494) throw new Error(`Expected 494 districts, received ${data.districts.length}`);
  const provinces = new Set(data.provinces.map((item) => item.code));
  const cantons = new Set(data.cantons.map((item) => item.code));
  assertUnique('Province', data.provinces.map((item) => item.code));
  assertUnique('Canton', data.cantons.map((item) => item.code));
  assertUnique('District', data.districts.map((item) => item.code));
  for (const item of data.provinces) {
    if (!isPositiveInteger(item.code) || !item.name.trim()) throw new Error(`Invalid province ${item.code}`);
  }
  for (const item of data.cantons) {
    if (!isPositiveInteger(item.code) || !isPositiveInteger(item.provinceCode) || !item.name.trim() || !provinces.has(item.provinceCode) || !String(item.code).startsWith(String(item.provinceCode))) {
      throw new Error(`Invalid canton hierarchy ${item.code}`);
    }
  }
  for (const item of data.districts) {
    if (!isPositiveInteger(item.code) || !isPositiveInteger(item.cantonCode) || !item.name.trim() || !cantons.has(item.cantonCode) || !String(item.code).startsWith(String(item.cantonCode))) {
      throw new Error(`Invalid district hierarchy ${item.code}`);
    }
  }
}

export function mergeVerifiedDistrictAdditions(base: readonly DistrictSeed[]): readonly DistrictSeed[] {
  if (base.some((item) => item.code === 50405 || item.code === 60310)) {
    throw new Error('Base district source must not contain verified additions 50405 or 60310');
  }
  return [...base, { code: 50405, name: 'Pijije', cantonCode: 504 }, { code: 60310, name: 'Cabagra', cantonCode: 603 }];
}
