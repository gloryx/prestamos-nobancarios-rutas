import { describe, expect, it, vi } from 'vitest';
import { loanRefinancingApi, loanRefinancingChainsApi, loanRefinancingListApi, loanRefinancingOperations, loanRefinancingOptions, refinancingCustomerLookup, classifyRefinancingFailure } from './loan-refinancing.api';
import { HttpApiError } from './api-client';

describe('refinancing step-one transport', () => {
  it('loads chains by loan or customer with one authenticated GET each', async () => {
    const chain = { rootLoanId: 'root' };
    const customerChains = { customer: { id: 'customer' }, chains: [chain] };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => chain } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => customerChains } as Response);
    try {
      expect(await loanRefinancingChainsApi.byLoan('loan/id')).toEqual(chain);
      expect(await loanRefinancingChainsApi.byCustomer('customer/id')).toEqual(customerChains);
      expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        '/loan-refinancings/loans/loan%2Fid/chain', '/loan-refinancings/customers/customer%2Fid/chains',
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const [, options] of fetchMock.mock.calls) {
        expect(options).toMatchObject({ cache: 'no-store', credentials: 'include' });
        expect(options?.method).toBeUndefined();
      }
    } finally { fetchMock.mockRestore(); }
  });
  it('requests paginated historical operations with combined server-side filters without POST', async () => {
    const result = { items: [], total: 12, page: 2, pageSize: 10, totalPages: 2 };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 200,
      json: async () => result } as Response).mockResolvedValueOnce({ ok: true, status: 200,
      json: async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }) } as Response);
    try {
      expect(await loanRefinancingListApi.list({ page: 2, pageSize: 10, search: 'Ana Pérez',
        customerId: 'customer-1', dateFrom: '2026-10-01', dateTo: '2026-10-02' })).toEqual(result);
      expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/loan-refinancings');
      expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[0][0])).searchParams)).toEqual({
        page: '2', pageSize: '10', search: 'Ana Pérez', customerId: 'customer-1',
        dateFrom: '2026-10-01', dateTo: '2026-10-02',
      });
      await loanRefinancingListApi.list({ page: 1, pageSize: 20, search: '' });
      expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[1][0])).searchParams)).toEqual({
        page: '1', pageSize: '20', search: '',
      });
      for (const [, options] of fetchMock.mock.calls) {
        expect(options).toMatchObject({ cache: 'no-store', credentials: 'include' });
        expect(options?.method).toBeUndefined();
      }
    } finally { fetchMock.mockRestore(); }
  });

  it('searches all customer statuses by the existing paged customer endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 200,
      json: async () => ({ items: [{ id: 'old', fullName: 'Ana Solís', identification: '123',
        primaryPhone: '0000', address: '', isActive: false }], total: 1, page: 2, pageSize: 10, totalPages: 1 }) } as Response);
    try {
      expect(await refinancingCustomerLookup.search({ search: 'Ana', page: 2 })).toEqual({
        items: [{ id: 'old', fullName: 'Ana Solís', identification: '123' }], total: 1,
      });
      expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/customers');
      expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[0][0])).searchParams)).toEqual({
        search: 'Ana', status: 'ALL', page: '2', pageSize: '10',
      });
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
      expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
    } finally { fetchMock.mockRestore(); }
  });
  it('uses authenticated server-side search and exact-loan preview without write requests', async () => {
    const list = { items: [], total: 0, page: 2, pageSize: 10 };
    const preview = { loanId: 'loan-id', eligible: false, remainingToMinimum: '10000.00' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 200, json: async () => list } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => preview } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => preview } as Response);
    try {
      expect(await loanRefinancingApi.search({ search: 'Ana Pérez', page: 2, pageSize: 10 })).toEqual(list);
      expect(await loanRefinancingApi.preview('loan/id')).toEqual(preview);
      expect(await loanRefinancingApi.preview('loan/id', '2026-09-26')).toEqual(preview);
      const [searchUrl, searchOptions] = fetchMock.mock.calls[0];
      expect(new URL(String(searchUrl)).pathname).toBe('/loan-refinancings/loans');
      expect(Object.fromEntries(new URL(String(searchUrl)).searchParams)).toEqual({ search: 'Ana Pérez', page: '2', pageSize: '10' });
      expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe('/loan-refinancings/loans/loan%2Fid/preview');
      expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[2][0])).searchParams)).toEqual({ refinancingDate: '2026-09-26' });
      for (const [, options] of fetchMock.mock.calls) {
        expect(options).toMatchObject({ cache: 'no-store', credentials: 'include' });
        expect(options?.method).toBeUndefined();
      }
      expect(searchOptions).toBeDefined();
    } finally { fetchMock.mockRestore(); }
  });
  it('loads only active payment options with authenticated read requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 'daily', isActive: true }, { id: 'old', isActive: false }] } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 'cash', isActive: true }, { id: 'old', isActive: false }] } as Response);
    try {
      expect(await loanRefinancingOptions.load()).toEqual({ frequencies: [{ id: 'daily', isActive: true }],
        methods: [{ id: 'cash', isActive: true }] });
      expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/payment-frequencies', '/payment-methods']);
      for (const [, options] of fetchMock.mock.calls) {
        expect(options).toMatchObject({ credentials: 'include' });
        expect(options?.method).toBeUndefined();
      }
    } finally { fetchMock.mockRestore(); }
  });

  it('posts the exact prepared request and reads a persisted detail without extra writes', async () => {
    const body = { originLoanId: 'origin-1', refinancingDate: '2026-10-01', newMoney: '0.00',
      newInterestAmount: '1.00', paymentFrequencyId: 'frequency-1', preferredPaymentMethodId: 'method-1',
      plan: [{ sequence: 1, dueDate: '2026-10-02', pendingAmount: '10.00' }], baseline: 'a'.repeat(64), idempotencyKey: 'fixed-key' };
    const receipt = { refinancingId: 'ref-1', financialComposition: { newMoneyDisbursed: '0.00' } };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => receipt } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => receipt } as Response);
    try {
      expect(await loanRefinancingOperations.confirm(body)).toEqual(receipt);
      expect(await loanRefinancingOperations.detail('ref/1')).toEqual(receipt);
      expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/loan-refinancings');
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include', body: JSON.stringify(body) });
      expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe('/loan-refinancings/ref%2F1');
      expect(fetchMock.mock.calls[1][1]).toMatchObject({ cache: 'no-store', credentials: 'include' });
    } finally { fetchMock.mockRestore(); }
  });

  it('preserves structured conflict codes without exposing backend error messages to confirmation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 409,
      json: async () => ({ message: 'internal SQL details', reasonCode: 'STALE_DATA' }) } as Response);
    try {
      await expect(loanRefinancingOperations.confirm({} as never)).rejects.toMatchObject({
        status: 409, reasonCode: 'STALE_DATA', message: 'internal SQL details',
      });
      expect(classifyRefinancingFailure(new HttpApiError(409, 'private', 'STALE_DATA'))).toBe('STALE_DATA');
      for (const code of ['ALREADY_REFINANCED', 'IDEMPOTENCY_CONFLICT', 'CONCURRENT_REFINANCING'] as const)
        expect(classifyRefinancingFailure(new HttpApiError(409, 'private', code))).toBe(code);
      expect(classifyRefinancingFailure(new HttpApiError(409, 'private', 'UNKNOWN'))).toBe('CONFLICT');
      expect(classifyRefinancingFailure(new HttpApiError(400, 'private'))).toBe('INVALID');
      expect(classifyRefinancingFailure(new HttpApiError(403, 'private'))).toBe('FORBIDDEN');
      expect(classifyRefinancingFailure(new HttpApiError(404, 'private'))).toBe('NOT_FOUND');
      expect(classifyRefinancingFailure(new HttpApiError(500, 'private'))).toBe('SERVER');
      expect(classifyRefinancingFailure(new TypeError('offline'))).toBe('NETWORK');
    } finally { fetchMock.mockRestore(); }
  });
});
