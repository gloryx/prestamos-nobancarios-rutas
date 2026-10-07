import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerAgendaFilters } from '../../domain/entities/customer-agenda';
import { customerAgendaApi } from './customer-agenda.api';

afterEach(() => vi.restoreAllMocks());

describe('customer agenda transport', () => {
  it('serializes server-side filters and omits empty and ALL values', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    const filters: CustomerAgendaFilters = { search: ' 1-1111 ', collectorId: '', routeId: 'route-1', provinceCode: '5', cantonCode: '503', districtCode: '', assignmentStatus: 'UNASSIGNED', page: 2, pageSize: 50 };
    const signal = new AbortController().signal;
    await customerAgendaApi.load(filters, signal);
    const [url, options] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/customers/agenda');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ search: '1-1111', routeId: 'route-1', provinceCode: '5', cantonCode: '503', assignmentStatus: 'UNASSIGNED', page: '2', pageSize: '50' });
    expect(options).toMatchObject({ cache: 'no-store', credentials: 'include', signal });
    expect(options?.method ?? 'GET').toBe('GET');
  });

  it('serializes the explicit ALL assignment status for the default query', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    await customerAgendaApi.load({ search: '', collectorId: '', routeId: '', provinceCode: '', cantonCode: '', districtCode: '', assignmentStatus: 'ALL', page: 1, pageSize: 20 });
    expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[0][0])).searchParams)).toEqual({ assignmentStatus: 'ALL', page: '1', pageSize: '20' });
  });
});
