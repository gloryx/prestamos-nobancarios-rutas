import { describe, expect, it } from 'vitest';
import { formatCRC, formatCRCForPdf, formatMoneyInput, normalizeMoney, parseMoneyCents, parseMoneyInput } from './money';

describe('money utilities', () => {
  it('groups CRC amounts without Number precision loss', () => {
    expect(formatCRC('1000')).toBe('₡1.000,00');
    expect(formatCRC('100000')).toBe('₡100.000,00');
    expect(formatCRC('1250000')).toBe('₡1.250.000,00');
  });
  it('formats the PDF alias through the centralized CRC formatter', () => {
    expect(formatCRCForPdf('120000')).toBe('¢120.000,00');
    expect(formatCRCForPdf('240000')).toBe('¢240.000,00');
    expect(formatCRCForPdf('0')).toBe('¢0,00');
    expect(formatCRCForPdf('2000000')).toBe('¢2.000.000,00');
    expect(formatCRCForPdf('120000')).not.toMatch(/[€₡$¡]|CRC/);
  });
  it('accepts currency symbols, spaces and comma decimals', () => {
    expect(normalizeMoney('₡ 100 000')).toBe('100000');
    expect(normalizeMoney('100 000')).toBe('100000');
    expect(normalizeMoney('1.250.000,50')).toBe('1250000.50');
    expect(formatMoneyInput('1250000.5')).toBe('1.250.000,5');
    expect(formatMoneyInput('₡ 1250000.5')).toBe('1.250.000,5');
  });
  it('keeps intermediate edits explicit and never turns invalid text into zero', () => {
    expect(parseMoneyInput('')).toEqual({ kind: 'intermediate', raw: '' });
    expect(parseMoneyInput('12,')).toEqual({ kind: 'intermediate', raw: '12.' });
    expect(parseMoneyInput('12,345')).toMatchObject({ kind: 'invalid' });
    expect(normalizeMoney('abc')).toBe('');
  });
  it('supports zero, two decimals and exact cents', () => {
    expect(normalizeMoney('0')).toBe('0');
    expect(normalizeMoney('0,25')).toBe('0.25');
    expect(parseMoneyCents('1234567890123456.78')).toBe(123456789012345678n);
  });
});
