import { describe, expect, it, vi } from 'vitest';
import { loanApi } from './loan.api';

describe('loan list sorting', () => {
  it('requests only the complete active-portfolio summary without pagination or filters', async () => {
    const payload = { totalActiveLoans: 209, capitalPlaced: '31000000.00', outstandingPrincipal: '18500000.00', outstandingInterest: '3200000.00', financialBalance: '21700000.00' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => payload } as Response);
    try {
      await expect(loanApi.summary()).resolves.toEqual(payload);
      expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/loans/summary', expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
    } finally { fetchMock.mockRestore(); }
  });
  it('requests the dedicated unpaginated active-loan export without list filters', async () => {
    const payload = { items: [], summary: { totalActiveLoans: 0, capitalPlaced: '0.00', outstandingPrincipal: '0.00', outstandingInterest: '0.00', financialBalance: '0.00' } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => payload } as Response);
    try {
      await expect(loanApi.exportActive()).resolves.toEqual(payload);
      expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/loans/export', expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
    } finally { fetchMock.mockRestore(); }
  });
  it('reads the operational receipt through the existing loans route without a payments request', async () => {
    const detail = { loanNumber: '42', financialBalance: '25.00', validPayments: [] };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => detail } as Response);
    try {
      expect(await loanApi.detail('loan-42')).toEqual(detail);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain('/loans/loan-42');
      expect(String(fetchMock.mock.calls[0][0])).not.toContain('/payments/');
    } finally { fetchMock.mockRestore(); }
  });
  it('sends server-side sorting with pagination and filters', async () => {
    const response = { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) } as Response;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await loanApi.list({ page: 2, pageSize: 20, search: 'ana', frequencyId: 'frequency-1', fromDate: '2026-01-01', toDate: '2026-12-31', sortBy: 'pending', sortOrder: 'asc' });

    expect(fetchMock.mock.calls[0][0]).toContain('/loans?page=2&pageSize=20&search=ana&frequencyId=frequency-1&fromDate=2026-01-01&toDate=2026-12-31&sortBy=pending&sortOrder=asc');
    fetchMock.mockRestore();
  });
  it('uses dedicated assigned-loan list and detail endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [], total: 0 }) } as Response);
    try {
      await loanApi.assignedList({ page: 2, pageSize: 20, search: 'Ana', status: 'UNCOLLECTIBLE', fromDate: '2026-01-01', sortBy: 'customer', sortOrder: 'asc' });
      await loanApi.assignedDetail('loan/id');
      const list = new URL(String(fetchMock.mock.calls[0][0]));
      expect(list.pathname).toBe('/loans/assigned');
      expect(Object.fromEntries(list.searchParams)).toEqual({ page: '2', pageSize: '20', search: 'Ana', status: 'UNCOLLECTIBLE', fromDate: '2026-01-01', sortBy: 'customer', sortOrder: 'asc' });
      expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe('/loans/assigned/loan%2Fid');
    } finally { fetchMock.mockRestore(); }
  });
  it('passes the condition sort in both directions and returns the list-only boolean without additional requests', async () => {
    const payload = { items: [{ id: 'loan-1', isOverdue: true, pendingTotal: '60.00' }], total: 21 };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => payload } as Response);
    try {
      for (const sortOrder of ['asc', 'desc'] as const) {
        expect(await loanApi.list({ page: 2, pageSize: 20, search: 'Ana', frequencyId: 'f1', fromDate: '2026-01-01', toDate: '2026-09-29', sortBy: 'condition', sortOrder })).toEqual(payload);
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const [index, [url]] of fetchMock.mock.calls.entries()) {
        expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual({ page: '2', pageSize: '20', search: 'Ana', frequencyId: 'f1', fromDate: '2026-01-01', toDate: '2026-09-29', sortBy: 'condition', sortOrder: index === 0 ? 'asc' : 'desc' });
      }
    } finally { fetchMock.mockRestore(); }
  });
  it('serializes cancelled-loan filters and returns all-page summary decimals untouched', async () => {
    const payload = { items: [], total: 30, page: 2, pageSize: 10, summary: { cancelledLoansCount: 30, recoveredAmount: '30000000000000000.25', realizedProfit: '7000000000000000.10' } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => payload } as Response);
    try {
      expect(await loanApi.cancelled({ page: 2, pageSize: 10, search: 'Ana López', startDate: '2026-01-01', endDate: '2026-12-31', sortBy: 'totalRecovered', sortDirection: 'asc' })).toEqual(payload);
      const request = new URL(String(fetchMock.mock.calls[0][0]));
      expect(request.pathname).toBe('/loans/cancelled');
      expect(Object.fromEntries(request.searchParams)).toEqual({ page: '2', pageSize: '10', search: 'Ana López', startDate: '2026-01-01', endDate: '2026-12-31', sortBy: 'totalRecovered', sortDirection: 'asc' });
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
    } finally { fetchMock.mockRestore(); }
  });
});

describe('loan management transport', () => {
  it('uses uncached GET with exact tab defaults, optional filters and untouched backend receipts', async () => {
    const summary = { total: 51, lentAmount: '99999999999999999.01', recoveredAmount: '3.50', pendingAmount: '7.25' };
    const overdue = { items: [{ loanId: 'a', loanNumber: '42', customer: { id: 'c', identification: '123', fullName: 'Ana' },
      startDate: '2026-01-01', firstOverdueDueDate: '2026-02-01', firstOverdueAmount: '2.00', principal: '10.00',
      interestAmount: '1.00', totalAmount: '11.00', recoveredAmount: '3.50', financialBalance: '7.50', status: 'ACTIVE', canMarkUncollectible: true }],
      total: 51, page: 2, pageSize: 10, summary };
    const uncollectible = { items: [{ loanId: 'b', loanNumber: '50', customer: { id: 'd', identification: '456', fullName: 'Bea' },
      startDate: '2026-01-01', uncollectibleAt: '2026-03-01T00:00:00.000000Z', uncollectibleBusinessDate: '2026-02-28',
      uncollectibleReason: 'Unpaid', changedByUserId: 'u', principal: '10.00', interestAmount: '1.00', totalAmount: '11.00',
      recoveredAmount: '3.50', financialBalance: '7.50', status: 'UNCOLLECTIBLE' }], total: 1, page: 1, pageSize: 20, summary };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      ({ ok: true, status: 200, json: async () => String(url).includes('/overdue?') ? overdue : uncollectible }) as Response);
    try {
      expect(await loanApi.getOverdueLoans({ page: 2, pageSize: 10, search: 'Ana L', startDate: '2026-01-01', endDate: '2026-09-29', sortBy: 'financialBalance', sortDir: 'desc' })).toEqual(overdue);
      expect(await loanApi.getUncollectibleLoans()).toEqual(uncollectible);
      expect(await loanApi.getOverdueLoans()).toEqual(overdue);
      expect(await loanApi.getUncollectibleLoans({ search: '', startDate: undefined, endDate: '2026-09-29', pageSize: 50, sortBy: 'loanNumber', sortDir: 'asc' })).toEqual(uncollectible);
      expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[0][0])).searchParams)).toEqual({ page: '2', pageSize: '10', search: 'Ana L', startDate: '2026-01-01', endDate: '2026-09-29', sortBy: 'financialBalance', sortDir: 'desc' });
      expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[1][0])).searchParams)).toEqual({ page: '1', pageSize: '20', sortBy: 'uncollectibleDate', sortDir: 'desc' });
      expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[2][0])).searchParams)).toEqual({ page: '1', pageSize: '20', sortBy: 'firstOverdueDueDate', sortDir: 'asc' });
      expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[3][0])).searchParams)).toEqual({ page: '1', pageSize: '50', endDate: '2026-09-29', sortBy: 'loanNumber', sortDir: 'asc' });
      for (const [, options] of fetchMock.mock.calls) expect(options).toMatchObject({ cache: 'no-store', credentials: 'include' });
    } finally { fetchMock.mockRestore(); }
  });

  it('sends only reason and key in the POST body for each transition and returns receipts', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, status: 201,
      json: async () => ({ loanId: 'loan/id', status: String(url).endsWith('/reactivate') ? 'ACTIVE' : 'UNCOLLECTIBLE',
        event: { id: 'event', sequence: 3, changedAt: '2026-09-29T01:00:00Z' } }) }) as Response);
    try {
      const input = { reason: 'Confirmed', idempotencyKey: 'key-1', status: 'ACTIVE', financialBalance: '999.00' };
      expect(await loanApi.markLoanUncollectible('loan/id', input)).toMatchObject({ status: 'UNCOLLECTIBLE', event: { sequence: 3 } });
      expect(await loanApi.reactivateLoan('loan/id', { ...input, idempotencyKey: 'key-2' })).toMatchObject({ status: 'ACTIVE', event: { id: 'event' } });
      for (const [index, [url, options]] of fetchMock.mock.calls.entries()) {
        expect(new URL(String(url)).pathname).toBe(`/loans/loan%2Fid/${index ? 'reactivate' : 'uncollectible'}`);
        expect(options).toMatchObject({ method: 'POST', credentials: 'include' });
        expect(new Headers(options?.headers).get('Content-Type')).toBe('application/json');
        expect(new Headers(options?.headers).has('Idempotency-Key')).toBe(false);
        expect(JSON.parse(String(options?.body))).toEqual({ reason: 'Confirmed', idempotencyKey: index ? 'key-2' : 'key-1' });
      }
    } finally { fetchMock.mockRestore(); }
  });

  it('preserves the controlled backend error message without inventing an HTTP status', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 409,
      json: async () => ({ message: 'The loan changed during the operation.' }) } as Response);
    try { await expect(loanApi.reactivateLoan('a', { reason: 'Review', idempotencyKey: 'key' })).rejects.toThrow('The loan changed during the operation.'); }
    finally { fetchMock.mockRestore(); }
  });
});

describe('loan edit transport', () => {
  it('loads scoped options without catalog routes and sends only the contracted PATCH fields with the stored receipt', async () => {
    const context = { loan: { id: 'a' }, baseline: { plan: [] }, paymentFrequencyOptions: [], preferredPaymentMethodOptions: [] };
    const receipt = { operationId: 'op', loanId: 'a', createdAt: '2026-09-30T00:00:00Z' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, status: 200,
      json: async () => String(url).endsWith('/edit-context') ? context : receipt }) as Response);
    try {
      expect(await loanApi.editContext('loan/id')).toBe(context);
      const body = { idempotencyKey: 'key', baseline: { interestAmount: '0.00', paymentFrequencyId: 'f', preferredPaymentMethodId: 'm', observations: null, financialBalance: '10.00', plan: [] }, changes: { observations: 'Note' } };
      expect(await loanApi.edit('loan/id', body)).toBe(receipt);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/loans/loan%2Fid/edit-context');
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'include' });
      expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe('/loans/loan%2Fid');
      expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PATCH', credentials: 'include' });
      expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual(body);
    } finally { fetchMock.mockRestore(); }
  });
  it('preserves HTTP status and a safe backend message for 400, 404 and 409', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    try {
      for (const status of [400, 404, 409]) {
        fetchMock.mockResolvedValueOnce({ ok: false, status, json: async () => ({ message: 'Review the loan.' }) } as Response);
        await expect(loanApi.editContext('a')).rejects.toMatchObject({ status, message: 'Review the loan.' });
      }
    } finally { fetchMock.mockRestore(); }
  });
});
