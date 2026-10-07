import { describe, expect, it, vi } from 'vitest';
import { CollectorApi, toCollectorFormData } from './collector.api';

describe('collector API form mapping', () => {
  it('maps scalar fields and photo without exposing absent optional values', () => {
    const photo = new File(['photo'], 'collector.png', { type: 'image/png' });
    const result = toCollectorFormData({ identification: '1-1', firstName: 'Ana', photo });
    expect(result.get('identification')).toBe('1-1');
    expect(result.get('firstName')).toBe('Ana');
    expect(result.get('photo')).toBe(photo);
    expect(result.has('email')).toBe(false);
  });
});

describe('collector financial summary transport', () => {
  it('requests one uncached scoped aggregate without collectorId', async () => {
    const payload = { totalPlaced: '6250000.00', totalOutstanding: '4850000.00', realizedGain: '425000.00', activeLoansCount: 31 };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => payload } as Response);
    try {
      await expect(new CollectorApi().financialSummary()).resolves.toEqual(payload);
      expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/collectors/me/financial-summary',
        expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
      expect(String(fetchMock.mock.calls[0][0])).not.toContain('collectorId');
    } finally { fetchMock.mockRestore(); }
  });
});
