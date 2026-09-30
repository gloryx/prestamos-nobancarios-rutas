export type MoneyParseResult =
  | { kind: 'valid'; raw: string }
  | { kind: 'intermediate'; raw: string }
  | { kind: 'invalid'; raw: string };

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,15})(?:\.\d{0,2})?$/;

/** Converts user-entered CRC text to the application's raw decimal-string form. */
export function parseMoneyInput(value: string): MoneyParseResult {
  const trimmed = value.trim();
  if (trimmed === '') return { kind: 'intermediate', raw: '' };
  if (!/^[\d\s₡.,]+$/.test(trimmed)) return { kind: 'invalid', raw: trimmed };

  const withoutDecoration = trimmed.replace(/[₡\s]/g, '');
  const commaIndex = withoutDecoration.lastIndexOf(',');
  const hasCommaDecimal = commaIndex >= 0;
  const integerSource = hasCommaDecimal
    ? withoutDecoration.slice(0, commaIndex)
    : withoutDecoration;
  const fractionSource = hasCommaDecimal
    ? withoutDecoration.slice(commaIndex + 1)
    : '';
  const dotParts = integerSource.split('.');
  const hasDotDecimal = !hasCommaDecimal && dotParts.length === 2 && dotParts[1].length <= 2;
  const integer = (hasDotDecimal ? dotParts[0] : integerSource.replace(/\./g, '')).replace(/^0+(?=\d)/, '');
  const fraction = hasCommaDecimal ? fractionSource : hasDotDecimal ? dotParts[1] : '';
  const raw = `${integer || '0'}${hasCommaDecimal || hasDotDecimal ? `.${fraction}` : ''}`;

  if (!/^\d+$/.test(integer) || (fraction && !/^\d{1,2}$/.test(fraction))) {
    return { kind: 'invalid', raw };
  }
  if (raw.endsWith('.') || !MONEY_PATTERN.test(raw)) return { kind: 'intermediate', raw };
  return { kind: 'valid', raw };
}

/** Formats a raw decimal string for an editable CRC control, without adding the prefix. */
export function formatMoneyInput(value: string): string {
  const parsed = parseMoneyInput(value);
  if (parsed.kind === 'invalid') return value;
  const [integer, fraction] = parsed.raw.split('.');
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fraction === undefined ? '' : `,${fraction}`}`;
}

/** Returns a payload-safe decimal string, or an empty string when the value is invalid. */
export function normalizeMoney(value: string): string {
  const parsed = parseMoneyInput(value);
  return parsed.kind === 'valid' ? parsed.raw : '';
}

export function parseMoneyCents(value: string): bigint | null {
  const normalized = normalizeMoney(value);
  if (!normalized) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function moneyFromCents(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function formatCRC(value: string): string {
  const normalized = normalizeMoney(value);
  if (!normalized) return '₡0.00';
  const [integerPart, decimalPart = ''] = normalized.split('.');
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `₡${grouped},${decimalPart.padEnd(2, '0')}`;
}

/** Formats read-only aggregate decimals without the input control's 16-digit limit. */
export function formatCRCAggregate(value: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return '₡0,00';
  const [integer, fraction = ''] = value.split('.');
  return `₡${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction.padEnd(2, '0')}`;
}

/** Formats CRC for PDF presentation using the same centralized money rules. */
export function formatCRCForPdf(value: string): string {
  return formatCRC(value).replace(/^₡/, '¢');
}

export function signedCRC(amount: string, direction: 'INFLOW' | 'OUTFLOW'): string {
  return `${direction === 'INFLOW' ? '+' : '-'}${formatCRC(amount)}`;
}
