import { describe, expect, it, vi } from 'vitest';
import { collectorStatisticsApi } from './collector-statistics.api';

describe('collector statistics API', () => {
  it('omits month for annual requests and disables cache', async () => {
    const response = { ok: true, status: 200, json: async () => ({ period: { year: 2026 } }) } as Response;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    await collectorStatisticsApi.load(2026, null);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/collectors/statistics?year=2026',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
    fetchMock.mockRestore();
  });

  it('sends an unpadded valid month and forwards cancellation', async () => {
    const response = { ok: true, status: 200, json: async () => ({ period: { year: 2026, month: 2 } }) } as Response;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const abort = new AbortController();
    await collectorStatisticsApi.load(2026, 2, abort.signal);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/collectors/statistics?year=2026&month=2',
      expect.objectContaining({ credentials: 'include', cache: 'no-store', signal: abort.signal }));
    fetchMock.mockRestore();
  });
});
