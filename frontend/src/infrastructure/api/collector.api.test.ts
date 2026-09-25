import { describe, expect, it } from 'vitest';
import { toCollectorFormData } from './collector.api';

describe('collector API form mapping', () => {
  it('maps scalar fields and photo without exposing absent optional values', () => {
    const photo = new File(['photo'], 'collector.png', { type: 'image/png' });
    const result = toCollectorFormData({ identification: '1-1', firstName: 'Ana', photo });
    expect(result.get('identification')).toBe('1-1');
    expect(result.get('firstName')).toBe('Ana');
    expect(result.get('photo')).toBe(photo);
    expect(result.has('email')).toBe(false);
  });
});
