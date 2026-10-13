import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectorCustodyApi } from './collector-custody.api';

afterEach(() => vi.restoreAllMocks());

describe('collector custody API', () => {
  it('uses unpaginated query routes and exact mutation bodies without replacing idempotency keys', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => [] } as Response);
    const api = new CollectorCustodyApi();
    await api.summary();
    await api.movements();
    await api.movements('collector/id');
    const base = { collectorId: 'collector', amount: '25.00', effectiveDate: '2026-10-12', paymentMethodId: 'method',
      reference: 'receipt', reason: 'Operational movement', notes: 'note' };
    await api.remit({ ...base, idempotencyKey: 'remit-key' });
    await api.topUp({ ...base, idempotencyKey: 'topup-key' });
    await api.adjust({ ...base, direction: 'DEBIT', idempotencyKey: 'adjust-key' });

    const urls = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.map(({ pathname }) => pathname)).toEqual(['/collector-custody/summary', '/collector-custody/movements', '/collector-custody/movements',
      '/collector-custody/remittances', '/collector-custody/top-ups', '/collector-custody/adjustments']);
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({});
    expect(Object.fromEntries(urls[1].searchParams)).toEqual({});
    expect(Object.fromEntries(urls[2].searchParams)).toEqual({ collectorId: 'collector/id' });
    expect(fetchMock.mock.calls.slice(3).map(([, options]) => JSON.parse(String(options?.body)).idempotencyKey))
      .toEqual(['remit-key', 'topup-key', 'adjust-key']);
    expect(JSON.parse(String(fetchMock.mock.calls[5][1]?.body))).toEqual({ ...base, direction: 'DEBIT', idempotencyKey: 'adjust-key' });
  });

  it('preserves summary decimals and nullable movement links', async () => {
    const summary = { collectorId: 'collector-1', declaredBalance: '25.00', confirmedBalance: '10.00', pendingAmount: '15.00', differenceAmount: '0.00' };
    const movements = [{ id: 'entry-1', collectorId: 'collector-1', direction: 'CREDIT', entryType: 'AUTHORIZED_ADJUSTMENT',
      amount: '5.00', effectiveDate: '2026-10-12', paymentMethodId: null, reference: null, reason: null, notes: null,
      precollectionId: null, settlementId: null, reversedEntryId: null, createdByUserId: 'manager-1', createdAt: '2026-10-12T12:00:00.000Z' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 200, json: async () => summary } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => movements } as Response);
    const api = new CollectorCustodyApi();
    await expect(api.summary('collector-1')).resolves.toEqual(summary);
    await expect(api.movements('collector-1')).resolves.toEqual(movements);
  });
});
