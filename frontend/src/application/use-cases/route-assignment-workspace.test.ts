import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { RouteAssignmentRepositoryError } from '../ports/route-assignment.repository';
import type { AssignmentWorkspace } from '../../domain/entities/route-assignment';
import { cloneAssignmentWorkspace, customerRoute, deriveAssignmentOperations, moveCustomer, moveRoute, pendingAssignmentIds, routeOwner, saveAssignmentDraft, updateAssignmentWorkspaceFilters } from './route-assignment-workspace';

const workspace = (): AssignmentWorkspace => ({
  snapshotToken: 'a'.repeat(64),
  collectors: [
    { collectorId: 'collector-a', collectorUserId: 'user-a', name: 'Ana', active: true, routes: [{ routeId: 'route-a', routeName: 'Centro', collectorAssignmentId: 'collector-assignment-a', customers: [{ customerId: 'customer-a', name: 'María', identification: '1', phone: '8888', customerRouteAssignmentId: 'customer-assignment-a' }] }] },
    { collectorId: 'collector-b', collectorUserId: 'user-b', name: 'Bea', active: true, routes: [{ routeId: 'route-b', routeName: 'Norte', collectorAssignmentId: 'collector-assignment-b', customers: [] }] },
    { collectorId: 'collector-c', collectorUserId: 'user-c', name: 'Carla', active: true, routes: [{ routeId: 'route-c', routeName: 'Sur', collectorAssignmentId: 'collector-assignment-c', customers: [] }] },
  ],
  unassignedRoutes: [{ routeId: 'route-free', routeName: 'Libre', customers: [] }],
  unassignedCustomers: { items: [{ customerId: 'customer-free', name: 'Luis', identification: '2', phone: '8777', cantonName: 'Santa Cruz', districtName: 'Tamarindo' }], total: 1, totalUnassigned: 1, page: 1, pageSize: 20 },
});

describe('route assignment working workspace', () => {
  it('moves a customer locally, updates counters and derives one MOVE with the confirmed assignment id', () => {
    const confirmed = workspace();
    const working = moveCustomer(confirmed, 'customer-a', 'route-b');
    expect(confirmed.collectors[0].routes[0].customers).toHaveLength(1);
    expect(working.collectors[0].routes[0].customers).toHaveLength(0);
    expect(working.collectors[1].routes[0].customers).toHaveLength(1);
    expect(deriveAssignmentOperations(confirmed, working)).toEqual([{ type: 'MOVE_CUSTOMER_TO_ROUTE', customerId: 'customer-a', routeId: 'route-b', expectedAssignmentId: 'customer-assignment-a' }]);
  });

  it('normalizes A to B to C as one final customer intention', () => {
    const confirmed = workspace();
    const working = moveCustomer(moveCustomer(confirmed, 'customer-a', 'route-b'), 'customer-a', 'route-c');
    expect(deriveAssignmentOperations(confirmed, working)).toEqual([{ type: 'MOVE_CUSTOMER_TO_ROUTE', customerId: 'customer-a', routeId: 'route-c', expectedAssignmentId: 'customer-assignment-a' }]);
  });

  it('removes the pending customer operation when it returns to its confirmed route', () => {
    const confirmed = workspace();
    const working = moveCustomer(moveCustomer(confirmed, 'customer-a', 'route-b'), 'customer-a', 'route-a');
    expect(deriveAssignmentOperations(confirmed, working)).toEqual([]);
  });

  it('assigns and unassigns customers with the correct contract and page count', () => {
    const confirmed = workspace();
    const assigned = moveCustomer(confirmed, 'customer-free', 'route-a');
    expect(assigned.unassignedCustomers.total).toBe(0);
    expect(assigned.unassignedCustomers.totalUnassigned).toBe(0);
    expect(assigned.unassignedCustomers.items).toHaveLength(0);
    expect(assigned.collectors[0].routes[0].customers.map((customer) => customer.customerId)).toEqual(['customer-a', 'customer-free']);
    expect(confirmed.unassignedCustomers.items).toHaveLength(1);
    expect(deriveAssignmentOperations(confirmed, assigned)).toEqual([{ type: 'ASSIGN_CUSTOMER_TO_ROUTE', customerId: 'customer-free', routeId: 'route-a' }]);
    const unassigned = moveCustomer(confirmed, 'customer-a', null);
    expect(unassigned.unassignedCustomers.total).toBe(2);
    expect(unassigned.unassignedCustomers.totalUnassigned).toBe(2);
    expect(deriveAssignmentOperations(confirmed, unassigned)).toEqual([{ type: 'UNASSIGN_CUSTOMER_FROM_ROUTE', customerId: 'customer-a', expectedAssignmentId: 'customer-assignment-a' }]);
  });

  it('combines territorial filters, resets pagination and clears a stale district when canton changes', () => {
    const initial = { search: 'Maria', cantonCode: 503, districtCode: 50301, page: 4, pageSize: 20 as const };
    expect(updateAssignmentWorkspaceFilters(initial, { search: 'Ana' })).toEqual({ ...initial, search: 'Ana', page: 1 });
    expect(updateAssignmentWorkspaceFilters(initial, { cantonCode: 505 })).toEqual({ ...initial, cantonCode: 505, districtCode: undefined, page: 1 });
    expect(updateAssignmentWorkspaceFilters(initial, { districtCode: 50302 })).toEqual({ ...initial, districtCode: 50302, page: 1 });
    expect(updateAssignmentWorkspaceFilters(initial, { search: '', cantonCode: undefined, districtCode: undefined })).toEqual({ search: '', cantonCode: undefined, districtCode: undefined, page: 1, pageSize: 20 });
  });

  it('moves, assigns and unassigns routes using the original collector assignment id', () => {
    const confirmed = workspace();
    expect(deriveAssignmentOperations(confirmed, moveRoute(confirmed, 'route-a', 'user-b'))).toEqual([{ type: 'MOVE_ROUTE_TO_COLLECTOR', routeId: 'route-a', collectorUserId: 'user-b', expectedAssignmentId: 'collector-assignment-a' }]);
    expect(deriveAssignmentOperations(confirmed, moveRoute(confirmed, 'route-free', 'user-a'))).toEqual([{ type: 'ASSIGN_ROUTE_TO_COLLECTOR', routeId: 'route-free', collectorUserId: 'user-a' }]);
    expect(deriveAssignmentOperations(confirmed, moveRoute(confirmed, 'route-a', null))).toEqual([{ type: 'UNASSIGN_ROUTE_FROM_COLLECTOR', routeId: 'route-a', expectedAssignmentId: 'collector-assignment-a' }]);
  });

  it('treats the same destination as a no-op and cancels a route round trip', () => {
    const confirmed = workspace();
    expect(moveRoute(confirmed, 'route-a', 'user-a')).toBe(confirmed);
    expect(moveCustomer(confirmed, 'customer-a', 'route-a')).toBe(confirmed);
    expect(deriveAssignmentOperations(confirmed, moveRoute(moveRoute(confirmed, 'route-a', 'user-b'), 'route-a', 'user-a'))).toEqual([]);
  });

  it('derives a stable mixed batch and identifies pending cards', () => {
    const confirmed = workspace();
    const working = moveCustomer(moveRoute(confirmed, 'route-free', 'user-b'), 'customer-a', 'route-b');
    const operations = deriveAssignmentOperations(confirmed, working);
    expect(operations).toHaveLength(2);
    expect(operations.map((operation) => operation.type)).toEqual(['ASSIGN_ROUTE_TO_COLLECTOR', 'MOVE_CUSTOMER_TO_ROUTE']);
    expect(pendingAssignmentIds(operations).routes).toEqual(new Set(['route-free']));
    expect(pendingAssignmentIds(operations).customers).toEqual(new Set(['customer-a']));
  });

  it('supports undo/discard snapshots without mutating the confirmed workspace', () => {
    const confirmed = workspace();
    const first = moveCustomer(confirmed, 'customer-a', 'route-b');
    const second = moveRoute(first, 'route-a', 'user-c');
    const history = [confirmed, first];
    const undone = history.at(-1)!;
    expect(customerRoute(undone, 'customer-a')).toBe('route-b');
    expect(routeOwner(undone, 'route-a')).toBe('user-a');
    const discarded = cloneAssignmentWorkspace(confirmed);
    expect(deriveAssignmentOperations(confirmed, discarded)).toEqual([]);
    expect(second).not.toBe(first);
  });

  it('saves all pending intentions in one batch and promotes working state to confirmed', async () => {
    const confirmed = workspace();
    const working = moveCustomer(moveRoute(confirmed, 'route-free', 'user-b'), 'customer-a', 'route-b');
    const save = vi.fn().mockResolvedValue({ applied: 2, snapshotToken: 'b'.repeat(64) });
    const result = await saveAssignmentDraft(confirmed, working, save);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ snapshotToken: confirmed.snapshotToken, operations: deriveAssignmentOperations(confirmed, working) });
    expect(result.status).toBe('SAVED');
    expect(deriveAssignmentOperations(result.confirmed, result.working)).toEqual([]);
  });

  it('keeps the working draft after conflict or failure and does not post a no-op', async () => {
    const confirmed = workspace();
    const working = moveCustomer(confirmed, 'customer-a', 'route-b');
    const conflictSave = vi.fn().mockRejectedValue(new RouteAssignmentRepositoryError('CONFLICT', 'stale'));
    const conflict = await saveAssignmentDraft(confirmed, working, conflictSave);
    expect(conflict.status).toBe('CONFLICT');
    expect(deriveAssignmentOperations(conflict.confirmed, conflict.working)).toHaveLength(1);
    const failure = await saveAssignmentDraft(confirmed, working, vi.fn().mockRejectedValue(new Error('offline')));
    expect(failure.status).toBe('FAILED');
    expect(deriveAssignmentOperations(failure.confirmed, failure.working)).toHaveLength(1);
    const noPost = vi.fn();
    expect((await saveAssignmentDraft(confirmed, cloneAssignmentWorkspace(confirmed), noPost)).status).toBe('NO_CHANGES');
    expect(noPost).not.toHaveBeenCalled();
  });
});
