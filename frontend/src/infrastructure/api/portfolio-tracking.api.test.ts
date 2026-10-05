import { describe, expect, it, vi } from 'vitest';
import { portfolioTrackingApi } from './portfolio-tracking.api';

describe('portfolio tracking API', () => {
  it('sends all active criteria and position to the dedicated no-store endpoint', async () => {
    const response = { position: 1, total: 0, hasPrevious: false, hasNext: false, loan: null };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => response } as Response);
    try {
      expect(await portfolioTrackingApi.locate({ search: 'María 101', status: 'ACTIVE', collectionStatus: 'OVERDUE', position: 4 })).toEqual(response);
      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toContain('/payments/portfolio-tracking?');
      expect(url).toContain('position=4');
      expect(url).toContain('search=Mar%C3%ADa+101');
      expect(url).toContain('status=ACTIVE');
      expect(url).toContain('collectionStatus=OVERDUE');
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
    } finally { fetchMock.mockRestore(); }
  });
});
