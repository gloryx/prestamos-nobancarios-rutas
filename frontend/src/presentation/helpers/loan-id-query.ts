const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loanIdFromSearch(search: string): { id: string | null; error: string | null } {
  const values = new URLSearchParams(search).getAll('loanId');
  if (!values.length) return { id: null, error: null };
  if (values.length !== 1 || !uuid.test(values[0])) return { id: null, error: 'El identificador del préstamo no es válido.' };
  return { id: values[0].toLowerCase(), error: null };
}
