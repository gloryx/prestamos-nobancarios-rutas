import { describe, expect, it, vi } from 'vitest';
import { collectAllCashMovements } from './cash-movement-export';

describe('cash movement export pagination', () => {
  it('collects every matching page using the server total', async () => {
    const list = vi.fn().mockImplementation(({ page }: { page: number }) => Promise.resolve({ items: page === 1 ? Array.from({ length: 100 }, (_, index) => ({ id: String(index) })) : [{ id: '100' }], total: 101 }));
    const records = await collectAllCashMovements({ list } as never, {});
    expect(records).toHaveLength(101);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith({ page: 2, pageSize: 100 });
  });
});
