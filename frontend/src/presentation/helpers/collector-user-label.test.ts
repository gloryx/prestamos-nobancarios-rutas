import { describe, expect, it } from 'vitest';
import { collectorUserLabel } from './collector-user-label';

describe('collector user label', () => {
  it('shows the linked username without exposing an identifier', () => {
    expect(collectorUserLabel({ user: { fullName: 'Ana Pérez', username: 'ana' } })).toBe('ana');
  });

  it('uses the unlinked label when metadata is absent', () => {
    expect(collectorUserLabel({ user: null })).toBe('SIN VINCULAR');
  });
});
