import { afterEach, describe, expect, it, vi } from 'vitest';
import { interpretApplicationError } from '../../application/errors/application-error';
import { CollectorPrecollectionApi } from './collector-precollection.api';

afterEach(() => vi.restoreAllMocks());

describe('collector precollection API', () => {
  it('uses the exact create, mine, global, detail and cancel contracts', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    const api = new CollectorPrecollectionApi();
    const create = { customerId: 'customer', loanId: 'loan', paymentMethodId: 'method', custodyTreatment: 'COLLECTOR_HELD' as const,
      amount: '125.50', effectiveDate: '2026-10-12', reference: 'receipt-1', notes: 'Collected', idempotencyKey: 'create-key' };
    await api.create(create);
    await api.mine({ date: '2026-10-12', status: 'RECORDED', search: ' María ', paymentMethodId: 'method', page: 2,
      pageSize: 20, sortBy: 'amount', sortDir: 'desc' });
    await api.list({ fromDate: '2026-10-01', toDate: '2026-10-12', collectorId: 'collector', routeId: 'route', page: 1, pageSize: 50 });
    await api.detail('precollection/id');
    await api.cancel('precollection/id', { reason: 'Duplicate', idempotencyKey: 'cancel-key' });

    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/collector-precollections');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(create) });
    const mine = new URL(String(fetchMock.mock.calls[1][0]));
    expect(mine.pathname).toBe('/collector-precollections/mine');
    expect(Object.fromEntries(mine.searchParams)).toEqual({ date: '2026-10-12', status: 'RECORDED', search: ' María ',
      paymentMethodId: 'method', page: '2', pageSize: '20', sortBy: 'amount', sortDir: 'desc' });
    const global = new URL(String(fetchMock.mock.calls[2][0]));
    expect(global.pathname).toBe('/collector-precollections');
    expect(Object.fromEntries(global.searchParams)).toEqual({ fromDate: '2026-10-01', toDate: '2026-10-12',
      collectorId: 'collector', routeId: 'route', page: '1', pageSize: '50' });
    expect(new URL(String(fetchMock.mock.calls[3][0])).pathname).toBe('/collector-precollections/precollection%2Fid');
    expect(new URL(String(fetchMock.mock.calls[4][0])).pathname).toBe('/collector-precollections/precollection%2Fid/cancel');
    expect(JSON.parse(String(fetchMock.mock.calls[4][1]?.body))).toEqual({ reason: 'Duplicate', idempotencyKey: 'cancel-key' });
  });

  it('preserves paginated indicators, navigation and nullable detail fields', async () => {
    const item = { id: 'pre-1', collectorId: 'collector-1', collectorUserId: 'user-1', customerId: 'customer-1', loanId: 'loan-1',
      routeId: 'route-1', customerRouteAssignmentId: 'customer-route-1', collectorRouteAssignmentId: 'collector-route-1',
      paymentMethodId: 'method-1', custodyTreatment: 'COLLECTOR_HELD', amount: '25.00', effectiveDate: '2026-10-12',
      reference: null, notes: null, status: 'RECORDED', recordedByUserId: 'user-1', recordedAt: '2026-10-12T12:00:00.000Z',
      cancelledByUserId: null, cancelledAt: null, cancellationReason: null, collectorName: 'Cobrador Uno', customerName: 'Ana Mora',
      customerIdentification: '1-2345-6789', loanNumber: '42', routeName: 'Ruta Centro', paymentMethodName: 'Efectivo',
      recordedByName: 'Cobrador Uno', cancelledByName: null };
    const page = { items: [item], total: 1, page: 1, pageSize: 20, totalPages: 1,
      indicators: { count: 1, total: '25.00', cash: '25.00', electronic: '0.00', pending: '25.00', cancelled: '0.00' },
      navigation: { selectedDate: '2026-10-12', today: '2026-10-12', previousDate: '2026-10-11', nextDate: null } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 200, json: async () => page } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => item } as Response);
    const api = new CollectorPrecollectionApi();
    await expect(api.mine({ date: '2026-10-12' })).resolves.toEqual(page);
    await expect(api.detail('pre-1')).resolves.toEqual(item);
    fetchMock.mockRestore();
  });

  it('preserves structured field errors from the shared API client', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, json: async () => ({
      message: 'Invalid amount', errorCode: 'VALIDATION_FAILED', reasonCode: 'AMOUNT_INVALID', requestId: 'request-1',
      data: { fields: [{ field: 'amount', codes: ['AMOUNT_INVALID'], message: 'Invalid amount' }] },
    }) } as Response);
    const error = await new CollectorPrecollectionApi().create({ customerId: 'c', loanId: 'l', paymentMethodId: 'm',
      custodyTreatment: 'COMPANY_RECEIVED', amount: '0', effectiveDate: '2026-10-12', idempotencyKey: 'key' })
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED', reasonCode: 'AMOUNT_INVALID', requestId: 'request-1',
      fieldErrors: [{ field: 'amount', codes: ['AMOUNT_INVALID'], message: 'Invalid amount' }] });
    expect(interpretApplicationError(error)).toMatchObject({ kind: 'validation', reasonCode: 'AMOUNT_INVALID',
      fieldErrors: [{ field: 'amount' }] });
  });
});
