import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectorSettlementApi } from './collector-settlement.api';

afterEach(() => vi.restoreAllMocks());

describe('collector settlement API', () => {
  it('uses raw list routes and preserves caller idempotency keys in every mutation body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => [] } as Response);
    const api = new CollectorSettlementApi();
    const create = { collectorId: 'collector', precollectionIds: ['pre-1', 'pre-2'], idempotencyKey: 'create-key' };
    await api.create(create);
    await api.mine();
    await api.list();
    await api.detail('settlement/id');
    await api.submit('settlement/id', { idempotencyKey: 'submit-key' });
    await api.review('settlement/id', { idempotencyKey: 'review-key' });
    await api.reject('settlement/id', { reason: 'Mismatch', idempotencyKey: 'reject-key' });
    await api.cancel('settlement/id', { reason: 'Cancelled', idempotencyKey: 'cancel-key' });
    const confirm = { amountDelivered: '90.00', deliveryDate: '2026-10-12', deliveryPaymentMethodId: 'method',
      deliveryReference: 'receipt', deliveryNotes: null, idempotencyKey: 'confirm-key' };
    await api.confirm('settlement/id', confirm);

    const paths = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths).toEqual(['/collector-settlements', '/collector-settlements/mine', '/collector-settlements',
      '/collector-settlements/settlement%2Fid', '/collector-settlements/settlement%2Fid/submit',
      '/collector-settlements/settlement%2Fid/review', '/collector-settlements/settlement%2Fid/reject',
      '/collector-settlements/settlement%2Fid/cancel', '/collector-settlements/settlement%2Fid/confirm']);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(create);
    expect(fetchMock.mock.calls.slice(4).map(([, options]) => JSON.parse(String(options?.body)).idempotencyKey))
      .toEqual(['submit-key', 'review-key', 'reject-key', 'cancel-key', 'confirm-key']);
    expect(JSON.parse(String(fetchMock.mock.calls[8][1]?.body))).toEqual(confirm);
  });

  it('preserves nullable delivery data, items and immutable action history', async () => {
    const detail = { id: 'settlement-1', collectorId: 'collector-1', collectorUserId: 'user-1', status: 'UNDER_REVIEW',
      totalDeclared: '25.00', totalConfirmed: '0.00', amountDelivered: '0.00', retainedAmount: '0.00', differenceAmount: '0.00',
      deliveryDate: null, deliveryPaymentMethodId: null, deliveryReference: null, deliveryNotes: null, reason: null,
      createdByUserId: 'user-1', createdAt: '2026-10-12T12:00:00.000Z', submittedByUserId: 'user-1',
      submittedAt: '2026-10-12T12:01:00.000Z', reviewedByUserId: 'manager-1', reviewedAt: '2026-10-12T12:02:00.000Z',
      confirmedByUserId: null, confirmedAt: null, rejectedByUserId: null, rejectedAt: null, cancelledByUserId: null, cancelledAt: null,
      items: [{ id: 'item-1', settlementId: 'settlement-1', precollectionId: 'pre-1', declaredAmount: '25.00', confirmedAmount: null, paymentId: null }],
      actions: [{ id: 'action-1', action: 'SUBMIT', actorUserId: 'user-1', reason: null, createdAt: '2026-10-12T12:01:00.000Z' }] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => detail } as Response);
    await expect(new CollectorSettlementApi().detail('settlement-1')).resolves.toEqual(detail);
  });
});
