import type { FinancialOpeningInput } from '../../application/ports/financial-opening.repository';
export { formatCRC } from '../../shared/utils/money';
export const financialOpeningAmountFields = ['initialPortfolio', 'initialUncollectibleAmount', 'initialAvailableAmount', 'historicalSeedCapital'] as const;
export function normalizeAmount(value: string): string { const trimmed = value.trim().replace(',', '.'); return /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(trimmed) ? trimmed : ''; }
export function validateFinancialOpeningAmounts(input: Pick<FinancialOpeningInput, typeof financialOpeningAmountFields[number]>): string[] { return financialOpeningAmountFields.flatMap((field) => input[field].trim() === '' ? [`${field} es requerido.`] : normalizeAmount(input[field]) === '' ? [`${field} debe ser un importe no negativo con hasta 2 decimales.`] : []); }
export function canPerformOpening(can: (permission: string) => boolean): boolean { return can('financial-opening.perform'); }
export function financialOpeningConfirmationSummary(input: FinancialOpeningInput): Array<[string, string]> { return [['Fecha de apertura', input.openingDate], ['Cartera inicial', input.initialPortfolio], ['Capital incobrable inicial', input.initialUncollectibleAmount], ['Importe disponible', input.initialAvailableAmount], ['Capital semilla histórico', input.historicalSeedCapital]]; }
