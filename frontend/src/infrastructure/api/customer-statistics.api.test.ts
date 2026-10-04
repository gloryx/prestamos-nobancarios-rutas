import { describe, expect, it, vi } from 'vitest';
import { customerStatisticsApi } from './customer-statistics.api';

describe('customer statistics API', () => {
  it('requests the aggregate endpoint with the selected year and no cache', async () => {
    const response = { ok: true, status: 200, json: async () => ({ year: 2025 }) } as Response;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    await customerStatisticsApi.load(2025);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/customers/statistics?year=2025',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
    fetchMock.mockRestore();
  });
});
