import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteAssignmentApi } from './route-assignment.api';

afterEach(() => vi.restoreAllMocks());

describe('route assignment workspace transport', () => {
  it('loads server-paged unassigned customers and sends one atomic batch request', async () => {
    const workspace = { snapshotToken: 'a'.repeat(64), collectors: [], unassignedRoutes: [], unassignedCustomers: { items: [], total: 0, totalUnassigned: 377, page: 2, pageSize: 20 } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => workspace } as Response);
    const api = new RouteAssignmentApi();
    await api.workspace({ search: ' María ', cantonCode: 503, districtCode: 50301, page: 2, pageSize: 20 });
    const operations = [{ type: 'ASSIGN_CUSTOMER_TO_ROUTE' as const, customerId: 'customer', routeId: 'route' }];
    await api.batch({ snapshotToken: 'a'.repeat(64), operations });
    const workspaceUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(workspaceUrl.pathname).toBe('/route-assignments/workspace');
    expect(Object.fromEntries(workspaceUrl.searchParams)).toEqual({ page: '2', pageSize: '20', search: 'María', cantonCode: '503', districtCode: '50301' });
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe('/route-assignments/batch');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ snapshotToken: 'a'.repeat(64), operations }) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps stale workspace, permission and network failures without retrying', async () => {
    const api = new RouteAssignmentApi();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    for (const [status, reason] of [[409, 'CONFLICT'], [403, 'FORBIDDEN']] as const) {
      fetchMock.mockResolvedValueOnce({ ok: false, status, json: async () => ({ message: 'failed' }) } as Response);
      await expect(api.batch({ snapshotToken: 'a'.repeat(64), operations: [] })).rejects.toMatchObject({ reason });
    }
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(api.workspace({ page: 1, pageSize: 20 })).rejects.toMatchObject({ reason: 'NETWORK' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
