import { describe, expect, it } from 'vitest';
import { formatDateOnlyForDisplay, formatDateTimeForDisplay } from './date';

describe('formatDateOnlyForDisplay', () => {
  it('formats a plain date without changing its calendar day', () => {
    expect(formatDateOnlyForDisplay('2026-09-01')).toBe('01/09/2026');
  });

  it('formats an ISO timestamp without exposing its time or converting its timezone', () => {
    const formatted = formatDateOnlyForDisplay('2026-09-01T06:00:00.000Z');

    expect(formatted).toBe('01/09/2026');
    expect(formatted).not.toContain('T06:00:00.000Z');
  });

  it('uses the empty display convention for invalid values', () => {
    expect(formatDateOnlyForDisplay('')).toBe('—');
    expect(formatDateOnlyForDisplay('not-a-date')).toBe('—');
    expect(formatDateOnlyForDisplay('2026-02-30')).toBe('—');
  });
});

describe('formatDateTimeForDisplay', () => {
  it('formats a timestamp using the Costa Rican date and time presentation', () => {
    expect(formatDateTimeForDisplay('2026-09-25T22:50:00.000Z')).toBe('25/09/2026, 4:50 p. m.');
  });

  it('uses the empty display convention for invalid values', () => {
    expect(formatDateTimeForDisplay('not-a-date')).toBe('—');
  });
});
