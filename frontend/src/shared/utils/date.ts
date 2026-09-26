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
