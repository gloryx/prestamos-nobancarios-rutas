import { describe, expect, it } from 'vitest';
import { formatCRC, formatCRCAggregate, formatCRCForPdf, formatMoneyInput, normalizeMoney, parseMoneyCents, parseMoneyInput } from './money';

describe('money utilities', () => {
  it('groups CRC amounts without Number precision loss', () => {
    expect(formatCRC(0)).toBe('₡0');
    expect(formatCRC(500)).toBe('₡500');
    expect(formatCRC('1000')).toBe('₡1.000');
    expect(formatCRC(12500)).toBe('₡12.500');
    expect(formatCRC('100000')).toBe('₡100.000');
    expect(formatCRC(1250000)).toBe('₡1.250.000');
    expect(formatCRC(126435950)).toBe('₡126.435.950');
    expect(formatCRC('126435950.00')).toBe('₡126.435.950');
    expect(formatCRC(-25000)).toBe('-₡25.000');
    expect(formatCRC(1250.5)).toBe('₡1.250,50');
    expect(formatCRC(null)).toBe('—');
    expect(formatCRC(undefined)).toBe('—');
    expect(formatCRC('-0.00')).toBe('₡0');
  });
  it('formats the PDF alias through the centralized CRC formatter', () => {
    expect(formatCRCForPdf('120000')).toBe('¢120.000');
    expect(formatCRCForPdf('240000')).toBe('¢240.000');
    expect(formatCRCForPdf('0')).toBe('¢0');
    expect(formatCRCForPdf('2000000')).toBe('¢2.000.000');
    expect(formatCRCForPdf('-25000.50')).toBe('-¢25.000,50');
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
  it('formats large read-only totals without weakening the 16-digit editable input limit', () => {
    expect(formatCRCAggregate('30000000000000000.25')).toBe('₡30.000.000.000.000.000,25');
    expect(formatCRCAggregate('0.00')).toBe('₡0');
    expect(formatCRCAggregate('undefined')).toBe('—');
    expect(formatCRCAggregate('100.999')).toBe('—');
    expect(normalizeMoney('30000000000000000.25')).toBe('');
  });
});
