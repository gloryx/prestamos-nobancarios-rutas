import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerritorialApi } from './territorial.api';

afterEach(() => vi.restoreAllMocks());

describe('territorial catalog transport', () => {
  it('loads all cantons and only districts from the selected canton', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => [] } as Response);
    const api = new TerritorialApi();

    await api.getCantons();
    await api.getDistricts({ cantonCode: 503 });

    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/territorial/cantons');
    const districtsUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(districtsUrl.pathname).toBe('/territorial/districts');
    expect(Object.fromEntries(districtsUrl.searchParams)).toEqual({ cantonCode: '503' });
  });
});
