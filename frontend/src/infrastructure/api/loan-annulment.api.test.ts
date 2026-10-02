import { describe, expect, it, vi } from 'vitest';
import { loanApi } from './loan.api';

describe('loan annulment reads', () => {
  it.each([
    ['getAnnullableLoans', '/loans/annullable', 'principal'],
    ['getAnnulledLoans', '/loans/annulled', 'annulledDate'],
  ] as const)('sends %s to %s with server filters', async (method, path, sortBy) => {
    const payload = { items: [], total: 3, page: 2, pageSize: 10,
      summary: { total: 3, capital: '300000.00', interest: '60000.00', contractualTotal: '360000.00' } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => payload } as Response);
    try {
      const filters = { search: 'Ana López', startDate: '2026-01-01', endDate: '2026-10-01',
        sortDir: 'asc' as const, page: 2, pageSize: 10 as const };
      const result = method === 'getAnnullableLoans'
        ? await loanApi.getAnnullableLoans({ ...filters, sortBy: 'principal' })
        : await loanApi.getAnnulledLoans({ ...filters, sortBy: 'annulledDate' });
      expect(result).toEqual(payload);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(new URL(String(url)).pathname).toBe(path);
      expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual({ search: 'Ana López', startDate: '2026-01-01',
        endDate: '2026-10-01', sortBy, sortDir: 'asc', page: '2', pageSize: '10' });
      expect(options).toMatchObject({ cache: 'no-store', credentials: 'include' });
    } finally { fetchMock.mockRestore(); }
  });
});

describe('loan annulment command', () => {
  it('sends only the exact request body and returns the backend receipt', async () => {
    const receipt = { loanId: 'loan/id', status: 'ANNULLED', annulledAt: '2026-10-01T00:00:00.000001Z',
      annulledBusinessDate: '2026-09-30', reason: 'Préstamo creado por error', disbursementResolution: 'NOT_DELIVERED' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 201, json: async () => receipt } as Response);
    try {
      const body = { reason: 'Préstamo creado por error', disbursementResolution: 'NOT_DELIVERED' as const, idempotencyKey: 'unique-key' };
      expect(await loanApi.annulLoan('loan/id', body)).toEqual(receipt);
      const [url, options] = fetchMock.mock.calls[0];
      expect(new URL(String(url)).pathname).toBe('/loans/loan%2Fid/annul');
      expect(options).toMatchObject({ method: 'POST', credentials: 'include' });
      expect(JSON.parse(String(options?.body))).toEqual(body);
    } finally { fetchMock.mockRestore(); }
  });
});
