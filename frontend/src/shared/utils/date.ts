const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

function isValidDateParts(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function formatDateOnlyForDisplay(value: string): string {
  if (typeof value !== 'string' || !value) return '—';

  const dateMatch = DATE_ONLY_PATTERN.exec(value);
  const timestampMatch = ISO_TIMESTAMP_PATTERN.exec(value);
  const match = dateMatch ?? timestampMatch;
  if (!match) return '—';

  const [, year, month, day] = match;
  if (!isValidDateParts(Number(year), Number(month), Number(day))) return '—';
  if (timestampMatch && Number.isNaN(Date.parse(value))) return '—';

  return `${day}/${month}/${year}`;
}

export function formatDateTimeForDisplay(value: string): string {
  if (typeof value !== 'string' || !value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('es-CR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function costaRicaDateOnly(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function shiftDateOnly(value: string, days: number): string {
  if (formatDateOnlyForDisplay(value) === '—') throw new Error('La fecha no es válida.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day + days);
  return `${date.getUTCFullYear().toString().padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
