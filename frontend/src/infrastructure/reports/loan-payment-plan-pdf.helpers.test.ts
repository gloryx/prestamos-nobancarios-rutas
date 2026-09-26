import { describe, expect, it } from 'vitest';
import { getPdfMoneyColor, getPdfMoneyText, PDF_MONEY_ROLES } from './loan-payment-plan-pdf.helpers';

describe('loan payment-plan PDF helpers', () => {
  it('uses the PDF-safe currency symbol in the complete money text', () => {
    expect(getPdfMoneyText('120000')).toBe('¢120.000,00');
    expect(getPdfMoneyText('240000')).toBe('¢240.000,00');
    expect(getPdfMoneyText('0')).toBe('¢0,00');
    expect(getPdfMoneyText('2000000')).toBe('¢2.000.000,00');
    expect(getPdfMoneyText('120000')).not.toMatch(/[€₡$¡]|CRC/);
  });

  it('exposes stable semantic money colors', () => {
    expect(getPdfMoneyColor('scheduled')).toEqual(PDF_MONEY_ROLES.scheduled);
    expect(getPdfMoneyColor('paid')).toEqual(PDF_MONEY_ROLES.paid);
    expect(getPdfMoneyColor('pending')).toEqual(PDF_MONEY_ROLES.pending);
  });
});
