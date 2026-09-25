import { describe, expect, it } from 'vitest';
import { formatNationality } from './nationality';

describe('formatNationality', () => {
  it.each([
    ['COSTA_RICAN', 'Costa Rica'],
    ['NICARAGUAN', 'Nicaragua'],
    ['PANAMANIAN', 'Panamá'],
    ['HONDURAN', 'Honduras'],
    ['OTHER', 'Otro'],
  ] as const)('formats %s as %s', (nationality, label) => {
    expect(formatNationality(nationality)).toBe(label);
  });

  it('preserves custom text for OTHER', () => {
    expect(formatNationality('OTHER', 'Salvadoreña')).toBe('Salvadoreña');
  });
});
