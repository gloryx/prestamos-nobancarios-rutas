import { costaRicaDta2026Cantons, costaRicaDta2026Districts, costaRicaDta2026Provinces } from '../src/infrastructure/database/typeorm/seeds/data/costa-rica-dta-2026.data';
import { mergeVerifiedDistrictAdditions, validateDta2026 } from '../src/infrastructure/database/typeorm/seeds/validation';

describe('Costa Rica DTA 2026 catalog', () => {
  it('contains the exact validated totals and hierarchy', () => {
    expect(() => validateDta2026({ provinces: costaRicaDta2026Provinces, cantons: costaRicaDta2026Cantons, districts: costaRicaDta2026Districts })).not.toThrow();
    expect(costaRicaDta2026Provinces).toHaveLength(7);
    expect(costaRicaDta2026Cantons).toHaveLength(84);
    expect(costaRicaDta2026Districts).toHaveLength(494);
  });

  it('contains known Guanacaste codes and verified additions exactly once', () => {
    expect(costaRicaDta2026Provinces).toContainEqual({ code: 5, name: 'Guanacaste' });
    expect(costaRicaDta2026Cantons).toContainEqual({ code: 503, name: 'Santa Cruz', provinceCode: 5 });
    expect(costaRicaDta2026Districts).toContainEqual({ code: 50301, name: 'Santa Cruz', cantonCode: 503 });
    expect(costaRicaDta2026Districts.filter((item) => item.code === 50405)).toEqual([{ code: 50405, name: 'Pijije', cantonCode: 504 }]);
    expect(costaRicaDta2026Districts.filter((item) => item.code === 60310)).toEqual([{ code: 60310, name: 'Cabagra', cantonCode: 603 }]);
  });

  it('rejects blank fields, duplicate codes, and broken references', () => {
    expect(() => validateDta2026({ provinces: [...costaRicaDta2026Provinces, { code: 0, name: '' }], cantons: costaRicaDta2026Cantons, districts: costaRicaDta2026Districts })).toThrow();
    expect(() => validateDta2026({ provinces: costaRicaDta2026Provinces, cantons: costaRicaDta2026Cantons.map((item, index) => index === 1 ? { ...item, code: costaRicaDta2026Cantons[0].code } : item), districts: costaRicaDta2026Districts })).toThrow('codes must be unique');
    expect(() => validateDta2026({ provinces: costaRicaDta2026Provinces, cantons: costaRicaDta2026Cantons.map((item, index) => index === 0 ? { ...item, provinceCode: 9 } : item), districts: costaRicaDta2026Districts })).toThrow();
    expect(() => validateDta2026({ provinces: costaRicaDta2026Provinces, cantons: costaRicaDta2026Cantons, districts: costaRicaDta2026Districts.map((item, index) => index === 0 ? { ...item, cantonCode: 999 } : item) })).toThrow();
  });

  it('merges only the two additions into the 492-record base', () => {
    const base = costaRicaDta2026Districts.filter((item) => item.code !== 50405 && item.code !== 60310);
    expect(base).toHaveLength(492);
    const merged = mergeVerifiedDistrictAdditions(base);
    expect(merged).toHaveLength(494);
    expect(() => mergeVerifiedDistrictAdditions(costaRicaDta2026Districts)).toThrow('must not contain verified additions');
  });
});
