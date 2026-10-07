import { plainToInstance } from 'class-transformer';
import { CustomerSiteBadRequestError, CustomerSiteConflictError, CustomerSiteForbiddenError } from '../src/domain/customer-site/customer-site.errors';
import { CustomerSiteUseCases } from '../src/application/customer-site/customer-site.use-cases';
import { CustomerController } from '../src/presentation/customer/customer.controller';
import type { CurrentIdentity } from '../src/domain/security/security.types';
import { AssignmentBatchOperationDto } from '../src/presentation/customer-site/assignment.dto';
import { CustomerSiteTypeOrmRepository } from '../src/infrastructure/database/typeorm/repositories/customer-site.typeorm-repository';

const actor = (permissions: string[], id = 'collector-1'): CurrentIdentity => ({ id, username: id, fullName: 'Test User', role: { id: 'role', code: 'COLLECTOR', name: 'Collector', isSuperAdmin: false }, permissions, sessionId: 'session' });
const site = (photo = false, location = false) => ({ customer: { id: 'customer-1', fullName: 'Test Customer', identification: '1', primaryPhone: '88888888', secondaryPhone: null }, route: { id: 'route-1', name: 'North' }, address: { province: 'San José', canton: 'Central', district: 'Carmen', exactAddress: 'Main street' }, latitude: location ? 9 : null, longitude: location ? -84 : null, hasPropertyPhoto: photo, siteDataUpdatedAt: null, siteDataUpdatedBy: null });
const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0]), mimetype: 'image/jpeg', size: 4 };
const storage = (deleted: string[] = []) => ({ save: jest.fn(), delete: jest.fn(async (key: string) => { deleted.push(key); }), read: jest.fn(), replace: jest.fn() });

describe('customer site application security', () => {
  it('rejects an unassigned or inactive collector before changing the site', async () => {
    const repository = { hasCollectorAccess: jest.fn().mockResolvedValue(false), readSite: jest.fn().mockResolvedValue(site()), updateSiteAtomically: jest.fn() };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    await expect(useCase.site('customer-1', actor(['customers.assigned.view', 'customers.site.view']))).rejects.toBeInstanceOf(CustomerSiteForbiddenError);
    expect(repository.readSite).not.toHaveBeenCalled();
    expect(repository.updateSiteAtomically).not.toHaveBeenCalled();
  });

  it('captures missing location independently from missing photo', async () => {
    const repository = { hasCollectorAccess: jest.fn().mockResolvedValue(true), readSite: jest.fn().mockResolvedValue(site(false, false)), updateSiteAtomically: jest.fn().mockResolvedValue({}) };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    await useCase.update('customer-1', { latitude: 9, longitude: -84 }, actor(['customers.assigned.view', 'customers.site.capture']));
    expect(repository.updateSiteAtomically).toHaveBeenCalledWith('customer-1', expect.objectContaining({ latitude: 9, longitude: -84 }), 'collector-1', [], expect.any(Date), true);
    await expect(useCase.update('customer-1', { propertyPhoto: file }, actor(['customers.assigned.view', 'customers.site.capture']))).resolves.toBeDefined();
  });

  it('does not consume or replace a file when the transactional repository fails', async () => {
    const deleted: string[] = [];
    const repository = { hasCollectorAccess: jest.fn().mockResolvedValue(true), readSite: jest.fn().mockResolvedValue(site(true, true)), updateSiteAtomically: jest.fn().mockRejectedValue(new CustomerSiteConflictError('locked')) };
    const useCase = new CustomerSiteUseCases(repository as never, storage(deleted));
    await expect(useCase.update('customer-1', { propertyPhoto: file }, actor(['customers.assigned.view', 'customers.site.replace']))).rejects.toBeInstanceOf(CustomerSiteConflictError);
    expect(repository.updateSiteAtomically).toHaveBeenCalledWith('customer-1', expect.objectContaining({ propertyPhotoFileKey: expect.stringContaining('site-customer-1-') }), 'collector-1', ['PHOTO', 'LOCATION_AND_PHOTO'], expect.any(Date), true);
    expect(deleted).toHaveLength(1);
  });

  it('rejects invalid authorization scope, expiry, and collector mismatch', async () => {
    const repository = { validateAuthorizationTarget: jest.fn().mockRejectedValue(new CustomerSiteConflictError('mismatch')), createAuthorization: jest.fn() };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    const management = actor(['customers.site.replace.authorize'], 'manager-1');
    await expect(useCase.authorize('customer-1', { collectorUserId: 'collector-1', scope: 'LOCATION_X', reason: 'reason', expiresAt: new Date(Date.now() + 60_000).toISOString() }, management)).rejects.toThrow();
    await expect(useCase.authorize('customer-1', { collectorUserId: 'collector-1', scope: 'LOCATION', reason: 'reason', expiresAt: new Date(Date.now() - 60_000).toISOString() }, management)).rejects.toThrow();
    await expect(useCase.authorize('customer-1', { collectorUserId: 'collector-1', scope: 'LOCATION', reason: 'reason', expiresAt: new Date(Date.now() + 60_000).toISOString() }, management)).rejects.toBeInstanceOf(CustomerSiteConflictError);
    expect(repository.createAuthorization).not.toHaveBeenCalled();
  });

  it('returns only the scoped assigned list for the authenticated collector', async () => {
    const assigned = { items: [{ id: 'customer-1', route: { id: 'route-1', name: 'North' } }], total: 1, routes: [{ id: 'route-1', name: 'North' }] };
    const repository = { resolveCollectorAccess: jest.fn().mockResolvedValue({ collectorId: 'collector-profile-1', routeAllowed: true }), listAssignedCustomers: jest.fn().mockResolvedValue(assigned) };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    await expect(useCase.assignedCustomers({ search: 'ana', routeId: 'route-1', page: 2, pageSize: 10 }, actor(['customers.assigned.view']))).resolves.toEqual({ ...assigned, page: 2, pageSize: 10, totalPages: 1 });
    await expect(useCase.assignedCustomers({ page: 1, pageSize: 20 }, actor([]))).rejects.toBeInstanceOf(CustomerSiteForbiddenError);
    expect(repository.resolveCollectorAccess).toHaveBeenCalledWith('collector-1', 'route-1');
    expect(repository.listAssignedCustomers).toHaveBeenCalledWith('collector-1', { search: 'ana', routeId: 'route-1', page: 2, pageSize: 10 });
  });

  it('rejects an invalid collector and a route outside the collector scope', async () => {
    const repository = { resolveCollectorAccess: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ collectorId: 'collector-profile-1', routeAllowed: false }), listAssignedCustomers: jest.fn() };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    const query = { routeId: 'foreign-route', page: 1, pageSize: 20 as const };
    await expect(useCase.assignedCustomers(query, actor(['customers.assigned.view']))).rejects.toBeInstanceOf(CustomerSiteForbiddenError);
    await expect(useCase.assignedCustomers(query, actor(['customers.assigned.view']))).rejects.toBeInstanceOf(CustomerSiteForbiddenError);
    expect(repository.listAssignedCustomers).not.toHaveBeenCalled();
  });

  it('returns an empty paginated assigned list without treating it as forbidden', async () => {
    const repository = { resolveCollectorAccess: jest.fn().mockResolvedValue({ collectorId: 'collector-profile-1', routeAllowed: true }), listAssignedCustomers: jest.fn().mockResolvedValue({ items: [], total: 0, routes: [] }) };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    await expect(useCase.assignedCustomers({ page: 1, pageSize: 20 }, actor(['customers.assigned.view']))).resolves.toEqual({ items: [], total: 0, routes: [], page: 1, pageSize: 20, totalPages: 0 });
  });

  it('preserves the centralized superadmin bypass without expanding the list beyond that user identity', async () => {
    const repository = { resolveCollectorAccess: jest.fn().mockResolvedValue(null), listAssignedCustomers: jest.fn().mockResolvedValue({ items: [], total: 0, routes: [] }) };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    const superadmin = { ...actor([], 'admin-1'), role: { id: 'admin-role', code: 'ADMIN', name: 'Admin', isSuperAdmin: true } };
    await expect(useCase.assignedCustomers({ page: 1, pageSize: 20 }, superadmin)).resolves.toMatchObject({ items: [], total: 0 });
    expect(repository.listAssignedCustomers).toHaveBeenCalledWith('admin-1', { page: 1, pageSize: 20 });
  });

  it('lists assigned collectors only for an authorized management actor', async () => {
    const assigned = [{ id: 'collector-1', fullName: 'Assigned Collector', username: 'collector' }];
    const repository = { listAssignedCollectors: jest.fn().mockResolvedValue(assigned) };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    const management = actor(['customers.site.replace.authorize'], 'manager-1');

    await expect(useCase.assignedCollectors('customer-1', management)).resolves.toEqual(assigned);
    await expect(useCase.assignedCollectors('customer-1', actor([]))).rejects.toBeInstanceOf(CustomerSiteForbiddenError);
    expect(repository.listAssignedCollectors).toHaveBeenCalledWith('customer-1');
  });

  it('allows assignment options with either assignment permission only', async () => {
    const options = { customers: [{ id: 'customer-1', fullName: 'Active Customer', identification: '1' }], routes: [{ id: 'route-1', name: 'North' }], collectors: [{ id: 'collector-1', fullName: 'Active Collector', username: 'collector' }] };
    const repository = { listRouteAssignmentOptions: jest.fn().mockResolvedValue(options) };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    await expect(useCase.routeAssignmentOptions(actor(['routes.assign.customers']))).resolves.toEqual(options);
    await expect(useCase.routeAssignmentOptions(actor([]))).rejects.toBeInstanceOf(CustomerSiteForbiddenError);
    expect(repository.listRouteAssignmentOptions).toHaveBeenCalledTimes(1);
  });

  it('requires all view permissions and an assignment permission for the workspace', async () => {
    const workspace = { snapshotToken: 'a'.repeat(64), collectors: [], unassignedRoutes: [], unassignedCustomers: { items: [], total: 0, page: 1, pageSize: 20 } };
    const repository = { readAssignmentWorkspace: jest.fn().mockResolvedValue(workspace) };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    const allowed = actor(['collectors.view', 'routes.view', 'customers.view', 'routes.assign.customers']);
    await expect(useCase.assignmentWorkspace({ page: 1, pageSize: 20 }, allowed)).resolves.toEqual(workspace);
    await expect(useCase.assignmentWorkspace({ page: 1, pageSize: 20 }, actor(['routes.view', 'customers.view', 'routes.assign.customers']))).rejects.toBeInstanceOf(CustomerSiteForbiddenError);
  });

  it('requires the permission for every operation family in a mixed batch', async () => {
    const repository = { applyAssignmentBatch: jest.fn().mockResolvedValue({ applied: 2, snapshotToken: 'b'.repeat(64) }) };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    const operations = [
      { type: 'ASSIGN_ROUTE_TO_COLLECTOR' as const, routeId: 'route-1', collectorUserId: 'collector-1' },
      { type: 'ASSIGN_CUSTOMER_TO_ROUTE' as const, customerId: 'customer-1', routeId: 'route-1' },
    ];
    await expect(useCase.applyAssignmentBatch('a'.repeat(64), operations, actor(['routes.assign.customers']))).rejects.toBeInstanceOf(CustomerSiteForbiddenError);
    await expect(useCase.applyAssignmentBatch('a'.repeat(64), operations, actor(['routes.assign.customers', 'routes.assign.collectors']))).resolves.toEqual({ applied: 2, snapshotToken: 'b'.repeat(64) });
  });

  it('rejects contradictory operations for one resource before persistence', async () => {
    const repository = { applyAssignmentBatch: jest.fn() };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    const operations = [
      { type: 'ASSIGN_CUSTOMER_TO_ROUTE' as const, customerId: 'customer-1', routeId: 'route-1' },
      { type: 'ASSIGN_CUSTOMER_TO_ROUTE' as const, customerId: 'customer-1', routeId: 'route-2' },
    ];
    await expect(useCase.applyAssignmentBatch('a'.repeat(64), operations, actor(['routes.assign.customers']))).rejects.toBeInstanceOf(CustomerSiteBadRequestError);
    expect(repository.applyAssignmentBatch).not.toHaveBeenCalled();
  });

  it('distinguishes route resources after DTO transformation adds undefined optional fields', async () => {
    const repository = { applyAssignmentBatch: jest.fn().mockResolvedValue({ applied: 2, snapshotToken: 'b'.repeat(64) }) };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    const operations = plainToInstance(AssignmentBatchOperationDto, [
      { type: 'ASSIGN_ROUTE_TO_COLLECTOR', routeId: 'route-1', collectorUserId: 'collector-1' },
      { type: 'ASSIGN_ROUTE_TO_COLLECTOR', routeId: 'route-2', collectorUserId: 'collector-1' },
    ]);

    await expect(useCase.applyAssignmentBatch('a'.repeat(64), operations as never, actor(['routes.assign.collectors']))).resolves.toMatchObject({ applied: 2 });
    expect(repository.applyAssignmentBatch).toHaveBeenCalledTimes(1);
  });

  it('exposes an active authorization only to its matching scoped collector', async () => {
    const authorization = { id: 'authorization-1', collectorUserId: 'collector-1', status: 'ACTIVE' };
    const repository = {
      hasCollectorAccess: jest.fn().mockResolvedValue(true),
      readSite: jest.fn().mockImplementation(async (_customerId: string, collectorUserId?: string) => ({ ...site(), ...(collectorUserId === 'collector-1' ? { activeAuthorization: authorization } : {}) })),
    };
    const useCase = new CustomerSiteUseCases(repository as never, storage());

    await expect(useCase.site('customer-1', actor(['customers.site.view'], 'collector-1'))).resolves.toEqual(expect.objectContaining({ activeAuthorization: authorization }));
    await expect(useCase.site('customer-1', actor(['customers.site.view'], 'collector-2'))).resolves.not.toEqual(expect.objectContaining({ activeAuthorization: expect.anything() }));
    expect(repository.readSite).toHaveBeenNthCalledWith(1, 'customer-1', 'collector-1');
    expect(repository.readSite).toHaveBeenNthCalledWith(2, 'customer-1', 'collector-2');
  });

  it('keeps COLLECTOR actors scoped even when they also have customers.view', async () => {
    const repository = { hasCollectorAccess: jest.fn().mockResolvedValue(false), readSite: jest.fn(), updateSiteAtomically: jest.fn() };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    const overGranted = actor(['customers.view', 'customers.site.view', 'customers.site.capture']);
    await expect(useCase.site('foreign-customer', overGranted)).rejects.toBeInstanceOf(CustomerSiteForbiddenError);
    await expect(useCase.update('foreign-customer', { latitude: 9, longitude: -84 }, overGranted)).rejects.toBeInstanceOf(CustomerSiteForbiddenError);
    expect(repository.readSite).not.toHaveBeenCalled();
  });

  it('serves an assigned collector property photo without exposing its storage key', async () => {
    const stored = { buffer: Buffer.from('photo'), mimetype: 'image/jpeg' };
    const fileStorage = storage();
    fileStorage.read.mockResolvedValue(stored);
    const repository = { hasCollectorAccess: jest.fn().mockResolvedValue(true), readPropertyPhotoKey: jest.fn().mockResolvedValue('private/property.jpg') };
    const useCase = new CustomerSiteUseCases(repository as never, fileStorage);
    const result = await useCase.photo('customer-1', actor(['customers.site.view']));
    expect(result).toEqual(stored);
    expect(result).not.toHaveProperty('key');
    expect(repository.readPropertyPhotoKey).toHaveBeenCalledWith('customer-1', 'collector-1');
    expect(fileStorage.read).toHaveBeenCalledWith('private/property.jpg');
  });

  it('rejects a foreign collector photo and returns controlled not-found for a missing photo', async () => {
    const repository = { hasCollectorAccess: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true), readPropertyPhotoKey: jest.fn().mockResolvedValue(null) };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    await expect(useCase.photo('foreign-customer', actor(['customers.files.view']))).rejects.toBeInstanceOf(CustomerSiteForbiddenError);
    await expect(useCase.photo('customer-1', actor(['customers.site.view']))).rejects.toThrow('El cliente no tiene foto del inmueble.');
  });

  it('allows broad file viewers to read a property photo without collector assignment scope', async () => {
    const stored = { buffer: Buffer.from('photo'), mimetype: 'image/png' };
    const fileStorage = storage();
    fileStorage.read.mockResolvedValue(stored);
    const repository = { hasCollectorAccess: jest.fn(), readPropertyPhotoKey: jest.fn().mockResolvedValue('private/property.png') };
    const management = { ...actor(['customers.files.view'], 'manager-1'), role: { id: 'manager-role', code: 'MANAGER', name: 'Manager', isSuperAdmin: false } };
    await expect(new CustomerSiteUseCases(repository as never, fileStorage).photo('customer-1', management)).resolves.toEqual(stored);
    expect(repository.hasCollectorAccess).not.toHaveBeenCalled();
  });

  it('blocks site fields through the generic customer patch', async () => {
    const management = { update: jest.fn() };
    const controller = new CustomerController({} as never, management as never);
    await expect(controller.update('customer-1', { latitude: '9' } as never, {} as never, actor(['customers.update']))).rejects.toThrow('PATCH /customers/:id/site');
    expect(management.update).not.toHaveBeenCalled();
  });
});

describe('customer site TypeORM scope structure', () => {
  const repositoryWith = (query: jest.Mock, transaction?: jest.Mock) => new CustomerSiteTypeOrmRepository({ manager: { query, transaction } } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);

  it('resolves only an active collector profile linked by collectors.user_id and rejects foreign routes', async () => {
    const query = jest.fn().mockResolvedValue([{ collectorId: 'collector-profile-1', routeAllowed: false }]);
    const repository = repositoryWith(query);
    await expect(repository.resolveCollectorAccess('collector-user-1', 'foreign-route')).resolves.toEqual({ collectorId: 'collector-profile-1', routeAllowed: false });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('JOIN collectors cl ON cl.user_id = u.id AND cl.is_active = true');
    expect(sql).toContain("role.code = 'COLLECTOR' AND role.is_active = true");
    expect(sql).toContain('u.is_active = true');
    expect(sql).toContain('cra.ended_at IS NULL');
    expect(params).toEqual(['collector-user-1', 'foreign-route']);
  });

  it('requires own current customer and collector assignments plus active customer, route, user, role, and collector', async () => {
    const query = jest.fn().mockResolvedValue([{ one: 1 }]);
    await expect(repositoryWith(query).hasCollectorAccess('customer-1', 'collector-user-1')).resolves.toBe(true);
    const sql = query.mock.calls[0][0] as string;
    for (const fragment of ['ca.ended_at IS NULL', 'cra.ended_at IS NULL', 'c.is_active = true', 'r.is_active = true', 'u.is_active = true', "role.code = 'COLLECTOR'", 'role.is_active = true', 'cl.is_active = true', 'cl.user_id = u.id']) expect(sql).toContain(fragment);
  });

  it('delegates search, route, and pagination while returning only safe fields and active routes', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const manager = { query: jest.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return calls.length === 1 ? [{ items: [], total: 0 }] : [{ id: 'route-1', name: 'North' }];
    }) };
    const transaction = jest.fn(async (_level: string, work: (value: typeof manager) => Promise<unknown>) => work(manager));
    const result = await repositoryWith(jest.fn(), transaction).listAssignedCustomers('collector-user-1', { search: 'Ana', routeId: 'route-1', page: 2, pageSize: 10 });
    expect(result).toEqual({ items: [], total: 0, routes: [{ id: 'route-1', name: 'North' }] });
    expect(calls[0].params).toEqual(['collector-user-1', 'Ana', 'route-1', 10, 10]);
    expect(calls[0].sql).toContain("COALESCE(c.secondary_phone, '') ILIKE");
    expect(calls[0].sql).toContain('ca.ended_at IS NULL');
    expect(calls[0].sql).toContain('cra.ended_at IS NULL');
    expect(calls[0].sql).not.toContain("'propertyPhotoFileKey'");
    expect(calls[1].sql).toContain('cra.ended_at IS NULL');
    expect(calls[1].sql).toContain('r.is_active = true');
  });
});
