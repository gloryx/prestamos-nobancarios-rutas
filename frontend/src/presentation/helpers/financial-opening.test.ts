import { describe, expect, it } from 'vitest';
import { canPerformOpening, financialOpeningAmountFields, financialOpeningConfirmationSummary, formatCRC, normalizeAmount, validateFinancialOpeningAmounts } from './financial-opening';
describe('financial opening helpers', () => {
  it('keeps the four concepts separate and validates zero', () => { expect(financialOpeningAmountFields).toHaveLength(4); expect(validateFinancialOpeningAmounts({ initialPortfolio: '0', initialUncollectibleAmount: '0.00', initialAvailableAmount: '12.50', historicalSeedCapital: '1' })).toEqual([]); });
  it('normalizes plain decimals and formats CRC only for presentation', () => { expect(normalizeAmount(' 12.5 ')).toBe('12.5'); expect(formatCRC('12.50')).toContain('12,50'); });
  it('formats the largest supported amount without Number precision loss', () => { expect(normalizeAmount('1234567890123456.78')).toBe('1234567890123456.78'); expect(formatCRC('1234567890123456.78')).toBe('₡1.234.567.890.123.456,78'); });
  it('rejects negative, over-precise, and over-sized amounts', () => { expect(normalizeAmount('-1')).toBe(''); expect(normalizeAmount('1.234')).toBe(''); expect(normalizeAmount('12345678901234567.89')).toBe(''); });
  it('checks submit permission and summary labels', () => { expect(canPerformOpening((code) => code === 'financial-opening.perform')).toBe(true); expect(financialOpeningConfirmationSummary({ openingDate: '2026-01-01', initialPortfolio: '1', initialUncollectibleAmount: '2', initialAvailableAmount: '3', historicalSeedCapital: '4', observations: null })).toHaveLength(5); });
});
