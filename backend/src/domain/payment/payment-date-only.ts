/** Preserve the local calendar day supplied by PostgreSQL's date parser. */
export function paymentDateOnlyKey(value: string | Date): string {
  if (typeof value === 'string') return value;
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
