import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CollectionAgendaFilters } from '../../domain/entities/collection-agenda';
import { collectionAgendaApi } from './collection-agenda.api';

afterEach(() => vi.restoreAllMocks());

describe('collection agenda transport', () => {
  it('uses only the read-only agenda GET with server filters and omits empty values', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    const filters: CollectionAgendaFilters = { period: 'WEEK', referenceDate: '2026-10-05', fromDate: '', toDate: '2026-10-11', collectorId: 'collector-1', routeId: '', collectionStatus: 'OVERDUE', search: ' Ana ', page: 2, pageSize: 20 };
    await collectionAgendaApi.load(filters);
    const [url, options] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/payments/collection-agenda');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ referenceDate: '2026-10-05', toDate: '2026-10-11', collectorId: 'collector-1', collectionStatus: 'OVERDUE', search: 'Ana', page: '2', pageSize: '20' });
    expect(options).toMatchObject({ cache: 'no-store', credentials: 'include' });
    expect(options?.method ?? 'GET').toBe('GET');
    expect(fetchMock.mock.calls.some(([request, init]) => new URL(String(request)).pathname === '/payments' || init?.method === 'POST')).toBe(false);
  });
});
