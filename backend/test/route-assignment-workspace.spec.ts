import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CustomerSiteConflictError } from '../src/domain/customer-site/customer-site.errors';
import { CustomerSiteTypeOrmRepository } from '../src/infrastructure/database/typeorm/repositories/customer-site.typeorm-repository';
import { AssignmentController } from '../src/presentation/customer-site/assignment.controller';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

const repositoryWith = (responses: (sql: string, parameters?: unknown[]) => unknown[]) => {
  const manager = { query: jest.fn(async (sql: string, parameters?: unknown[]) => responses(sql, parameters)) };
  const transaction = jest.fn(async (_isolation: string, work: (value: typeof manager) => Promise<unknown>) => work(manager));
  const repository = new CustomerSiteTypeOrmRepository({ manager: { ...manager, transaction } } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { repository, manager, transaction };
};

describe('route assignment workspace', () => {
  it('builds collectors, unassigned routes, assigned customers and a paged unassigned result in four bulk queries', async () => {
    const { repository, manager, transaction } = repositoryWith((sql, parameters) => {
      if (sql.includes('FROM collectors c')) return [{ collectorId: 'collector-1', collectorUserId: 'user-1', name: 'Ana Mora' }];
      if (sql.includes('FROM routes r')) return [
        { routeId: 'route-1', routeName: 'North', routeActive: true, collectorAssignmentId: 'collector-assignment-1', collectorUserId: 'user-1' },
        { routeId: 'route-2', routeName: 'Central', routeActive: true, collectorAssignmentId: 'collector-assignment-2', collectorUserId: 'user-1' },
        { routeId: 'route-3', routeName: 'South', routeActive: true, collectorAssignmentId: null, collectorUserId: null },
      ];
      if (sql.includes('LEFT JOIN customer_route_assignments')) {
        expect(parameters).toEqual(['maria', 10, 10]);
        return [{ items: [{ customerId: 'customer-2', name: 'Maria Diaz', identification: '102', phone: '8111' }], total: 1 }];
      }
      if (sql.includes('JOIN customer_route_assignments')) return [
        { customerId: 'customer-1', name: 'Maria Solis', identification: '101', phone: '8000', customerActive: true, customerRouteAssignmentId: 'customer-assignment-1', routeId: 'route-1' },
        { customerId: 'customer-3', name: 'Mario Soto', identification: '103', phone: '8222', customerActive: true, customerRouteAssignmentId: 'customer-assignment-2', routeId: 'route-1' },
      ];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const result = await repository.readAssignmentWorkspace({ search: 'maria', page: 2, pageSize: 10 });
    expect(transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    expect(manager.query).toHaveBeenCalledTimes(4);
    expect(result.snapshotToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.collectors).toEqual([{ collectorId: 'collector-1', collectorUserId: 'user-1', name: 'Ana Mora', active: true, routes: [
      { routeId: 'route-1', routeName: 'North', collectorAssignmentId: 'collector-assignment-1', customers: [
        { customerId: 'customer-1', name: 'Maria Solis', identification: '101', phone: '8000', customerRouteAssignmentId: 'customer-assignment-1' },
        { customerId: 'customer-3', name: 'Mario Soto', identification: '103', phone: '8222', customerRouteAssignmentId: 'customer-assignment-2' },
      ] },
      { routeId: 'route-2', routeName: 'Central', collectorAssignmentId: 'collector-assignment-2', customers: [] },
    ] }]);
    expect(result.unassignedRoutes).toEqual([{ routeId: 'route-3', routeName: 'South', customers: [] }]);
    expect(result.unassignedCustomers).toEqual({ items: [{ customerId: 'customer-2', name: 'Maria Diaz', identification: '102', phone: '8111' }], total: 1, page: 2, pageSize: 10 });
  });

  it('refuses to hide duplicate active ownership in the workspace', async () => {
    const { repository } = repositoryWith((sql) => {
      if (sql.includes('FROM collectors c')) return [{ collectorId: 'collector-1', collectorUserId: 'user-1', name: 'Ana' }];
      if (sql.includes('FROM routes r')) return [
        { routeId: 'route-1', routeName: 'North', routeActive: true, collectorAssignmentId: 'a-1', collectorUserId: 'user-1' },
        { routeId: 'route-1', routeName: 'North', routeActive: true, collectorAssignmentId: 'a-2', collectorUserId: 'user-1' },
      ];
      return [];
    });
    await expect(repository.readAssignmentWorkspace({ page: 1, pageSize: 20 })).rejects.toBeInstanceOf(CustomerSiteConflictError);
  });

  it('publishes workspace and batch routes with the existing permissions', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AssignmentController.prototype.workspace)).toBe('workspace');
    expect(Reflect.getMetadata(METHOD_METADATA, AssignmentController.prototype.workspace)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AssignmentController.prototype.workspace)).toEqual(['collectors.view', 'routes.view', 'customers.view', 'routes.assign.customers', 'routes.assign.collectors']);
    expect(Reflect.getMetadata(PATH_METADATA, AssignmentController.prototype.batch)).toBe('batch');
    expect(Reflect.getMetadata(METHOD_METADATA, AssignmentController.prototype.batch)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AssignmentController.prototype.batch)).toEqual(['routes.assign.customers', 'routes.assign.collectors']);
  });
});
