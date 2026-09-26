import type { FinancialOpeningInput } from '../../application/ports/financial-opening.repository';
import { normalizeMoney } from '../../shared/utils/money';
export { formatCRC } from '../../shared/utils/money';
export const financialOpeningAmountFields = ['initialPortfolio', 'initialUncollectibleAmount', 'initialAvailableAmount', 'historicalSeedCapital'] as const;
export function normalizeAmount(value: string): string { if (/^\s*\d+\.\d{3}\s*$/.test(value)) return ''; return normalizeMoney(value); }
export function validateFinancialOpeningAmounts(input: Pick<FinancialOpeningInput, typeof financialOpeningAmountFields[number]>): string[] { return financialOpeningAmountFields.flatMap((field) => input[field].trim() === '' ? [`${field} es requerido.`] : normalizeAmount(input[field]) === '' ? [`${field} debe ser un importe no negativo con hasta 2 decimales.`] : []); }
export function canPerformOpening(can: (permission: string) => boolean): boolean { return can('financial-opening.perform'); }
export function financialOpeningConfirmationSummary(input: FinancialOpeningInput): Array<[string, string]> { return [['Fecha de apertura', input.openingDate], ['Cartera inicial', input.initialPortfolio], ['Capital incobrable inicial', input.initialUncollectibleAmount], ['Importe disponible', input.initialAvailableAmount], ['Capital semilla histórico', input.historicalSeedCapital]]; }
