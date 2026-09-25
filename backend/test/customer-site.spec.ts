import { CustomerSiteConflictError, CustomerSiteForbiddenError } from '../src/domain/customer-site/customer-site.errors';
import { CustomerSiteUseCases } from '../src/application/customer-site/customer-site.use-cases';
import { CustomerController } from '../src/presentation/customer/customer.controller';
import type { CurrentIdentity } from '../src/domain/security/security.types';

const actor = (permissions: string[], id = 'collector-1'): CurrentIdentity => ({ id, username: id, fullName: 'Test User', role: { id: 'role', code: 'COLLECTOR', name: 'Collector', isSuperAdmin: false }, permissions, sessionId: 'session' });
const site = (photo = false, location = false) => ({ latitude: location ? 9 : null, longitude: location ? -84 : null, hasPropertyPhoto: photo, siteDataUpdatedAt: null, siteDataUpdatedBy: null });
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
    expect(repository.updateSiteAtomically).toHaveBeenCalledWith('customer-1', expect.objectContaining({ latitude: 9, longitude: -84 }), 'collector-1', [], expect.any(Date));
    await expect(useCase.update('customer-1', { propertyPhoto: file }, actor(['customers.assigned.view', 'customers.site.capture']))).resolves.toBeDefined();
  });

  it('does not consume or replace a file when the transactional repository fails', async () => {
    const deleted: string[] = [];
    const repository = { hasCollectorAccess: jest.fn().mockResolvedValue(true), readSite: jest.fn().mockResolvedValue(site(true, true)), updateSiteAtomically: jest.fn().mockRejectedValue(new CustomerSiteConflictError('locked')) };
    const useCase = new CustomerSiteUseCases(repository as never, storage(deleted));
    await expect(useCase.update('customer-1', { propertyPhoto: file }, actor(['customers.assigned.view', 'customers.site.replace']))).rejects.toBeInstanceOf(CustomerSiteConflictError);
    expect(repository.updateSiteAtomically).toHaveBeenCalledWith('customer-1', expect.objectContaining({ propertyPhotoFileKey: expect.stringContaining('site-customer-1-') }), 'collector-1', ['PHOTO', 'LOCATION_AND_PHOTO'], expect.any(Date));
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
    const assigned = [{ id: 'customer-1', route: { id: 'route-1', name: 'North' } }];
    const repository = { listAssignedCustomers: jest.fn().mockResolvedValue(assigned) };
    const useCase = new CustomerSiteUseCases(repository as never, storage());
    await expect(useCase.assignedCustomers(actor(['customers.assigned.view']))).resolves.toEqual(assigned);
    await expect(useCase.assignedCustomers(actor([]))).rejects.toBeInstanceOf(CustomerSiteForbiddenError);
    expect(repository.listAssignedCustomers).toHaveBeenCalledWith('collector-1');
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

  it('blocks site fields through the generic customer patch', async () => {
    const management = { update: jest.fn() };
    const controller = new CustomerController({} as never, management as never);
    await expect(controller.update('customer-1', { latitude: '9' } as never, {} as never, actor(['customers.update']))).rejects.toThrow('PATCH /customers/:id/site');
    expect(management.update).not.toHaveBeenCalled();
  });
});
