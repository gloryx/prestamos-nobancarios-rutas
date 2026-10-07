import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { CustomerSiteConflictError } from '../src/domain/customer-site/customer-site.errors';
import { CustomerSiteTypeOrmRepository } from '../src/infrastructure/database/typeorm/repositories/customer-site.typeorm-repository';
import { AssignmentController } from '../src/presentation/customer-site/assignment.controller';
import { AssignmentWorkspaceQueryDto } from '../src/presentation/customer-site/assignment.dto';
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
        expect(parameters).toEqual(['maria', 10, 10, 503, 50301, 'WITH_ACTIVE']);
        return [{ items: [{ customerId: 'customer-2', name: 'Maria Diaz', identification: '102', phone: '8111', cantonName: 'Santa Cruz', districtName: 'Tamarindo' }], total: 1, totalUnassigned: 8 }];
      }
      if (sql.includes('JOIN customer_route_assignments')) return [
        { customerId: 'customer-1', name: 'Maria Solis', identification: '101', phone: '8000', customerActive: true, customerRouteAssignmentId: 'customer-assignment-1', routeId: 'route-1' },
        { customerId: 'customer-3', name: 'Mario Soto', identification: '103', phone: '8222', customerActive: true, customerRouteAssignmentId: 'customer-assignment-2', routeId: 'route-1' },
      ];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const result = await repository.readAssignmentWorkspace({ search: 'maria', cantonCode: 503, districtCode: 50301, activeLoanFilter: 'WITH_ACTIVE', page: 2, pageSize: 10 });
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
    expect(result.unassignedCustomers).toEqual({ items: [{ customerId: 'customer-2', name: 'Maria Diaz', identification: '102', phone: '8111', cantonName: 'Santa Cruz', districtName: 'Tamarindo' }], total: 1, totalUnassigned: 8, page: 2, pageSize: 10 });
  });

  it.each([
    ['canton', { cantonCode: 503 }, ['', 20, 0, 503, null, 'ALL']],
    ['district', { districtCode: 50301 }, ['', 20, 0, null, 50301, 'ALL']],
    ['combined territorial', { cantonCode: 503, districtCode: 50301 }, ['', 20, 0, 503, 50301, 'ALL']],
    ['search', { search: 'maria' }, ['maria', 20, 0, null, null, 'ALL']],
    ['search and canton', { search: 'maria', cantonCode: 503 }, ['maria', 20, 0, 503, null, 'ALL']],
    ['search and territorial', { search: 'maria', cantonCode: 503, districtCode: 50301 }, ['maria', 20, 0, 503, 50301, 'ALL']],
    ['active loans and territorial', { activeLoanFilter: 'WITH_ACTIVE' as const, cantonCode: 503, districtCode: 50301 }, ['', 20, 0, 503, 50301, 'WITH_ACTIVE']],
    ['without active loans and search', { activeLoanFilter: 'WITHOUT_ACTIVE' as const, search: 'maria' }, ['maria', 20, 0, null, null, 'WITHOUT_ACTIVE']],
    ['filtered pagination', { activeLoanFilter: 'WITH_ACTIVE' as const, cantonCode: 503, page: 3 as const, pageSize: 10 as const }, ['', 10, 20, 503, null, 'WITH_ACTIVE']],
    ['unknown territorial IDs', { cantonCode: 999, districtCode: 99999 }, ['', 20, 0, 999, 99999, 'ALL']],
  ])('passes %s filters to the server-side unassigned query', async (_name, filters, expectedParameters) => {
    const { repository } = repositoryWith((sql, parameters) => {
      if (sql.includes('FROM collectors c')) return [];
      if (sql.includes('FROM routes r')) return [];
      if (sql.includes('LEFT JOIN customer_route_assignments')) {
        expect(sql).toContain('LEFT JOIN customer_addresses');
        expect(sql).toContain('cra.id IS NULL');
        expect(parameters).toEqual(expectedParameters);
        return [{ items: [], total: 0, totalUnassigned: 377 }];
      }
      if (sql.includes('JOIN customer_route_assignments')) return [];
      throw new Error(`Unexpected query: ${sql}`);
    });

    const result = await repository.readAssignmentWorkspace({ page: 1, pageSize: 20, ...filters });
    expect(result.unassignedCustomers).toMatchObject({ items: [], total: 0, totalUnassigned: 377 });
  });

  it('derives loan situation with correlated ACTIVE-only EXISTS predicates without joining or duplicating customers', async () => {
    let unassignedSql = '';
    const { repository } = repositoryWith((sql) => {
      if (sql.includes('LEFT JOIN customer_route_assignments')) {
        unassignedSql = sql;
        return [{ items: [{ customerId: 'one-row' }], total: 1, totalUnassigned: 9 }];
      }
      if (sql.includes('FROM collectors c') || sql.includes('FROM routes r') || sql.includes('JOIN customer_route_assignments')) return [];
      throw new Error(`Unexpected query: ${sql}`);
    });

    const withActive = await repository.readAssignmentWorkspace({ activeLoanFilter: 'WITH_ACTIVE', page: 1, pageSize: 20 });
    expect(withActive.unassignedCustomers).toMatchObject({ total: 1, totalUnassigned: 9 });
    expect(unassignedSql).toContain(`$6 = 'WITH_ACTIVE' AND EXISTS (SELECT 1 FROM loans loan WHERE loan.customer_id = "customerId" AND loan.status = 'ACTIVE')`);
    expect(unassignedSql).toContain(`$6 = 'WITHOUT_ACTIVE' AND NOT EXISTS (SELECT 1 FROM loans loan WHERE loan.customer_id = "customerId" AND loan.status = 'ACTIVE')`);
    expect(unassignedSql).not.toContain('JOIN loans');
    expect(unassignedSql).not.toMatch(/loan\.status\s*=\s*'(?:CANCELLED|REFINANCED|UNCOLLECTIBLE|ANNULLED)'/);
    expect(unassignedSql.indexOf('EXISTS (SELECT 1 FROM loans')).toBeGreaterThan(unassignedSql.indexOf('eligible AS MATERIALIZED'));
    expect(unassignedSql).toContain('(SELECT COUNT(*)::int FROM eligible) AS total');
    expect(unassignedSql).toContain('(SELECT COUNT(*)::int FROM unassigned) AS "totalUnassigned"');
  });

  it('returns the first unfiltered page when global and filtered totals are non-zero', async () => {
    const page = [{ customerId: 'customer-without-location', name: 'Customer', identification: '100', phone: '8000' }];
    const { repository } = repositoryWith((sql, parameters) => {
      if (sql.includes('LEFT JOIN customer_route_assignments')) {
        expect(parameters).toEqual(['', 20, 0, null, null, 'ALL']);
        expect(sql).toContain('LEFT JOIN customer_addresses');
        expect(sql).toContain('LEFT JOIN districts');
        expect(sql).toContain('LEFT JOIN cantons');
        return [{ items: page, total: 369, totalUnassigned: 369 }];
      }
      if (sql.includes('FROM collectors c') || sql.includes('FROM routes r') || sql.includes('JOIN customer_route_assignments')) return [];
      throw new Error(`Unexpected query: ${sql}`);
    });

    const result = await repository.readAssignmentWorkspace({ page: 1, pageSize: 20 });

    expect(result.unassignedCustomers).toMatchObject({ total: 369, totalUnassigned: 369, page: 1, pageSize: 20 });
    expect(result.unassignedCustomers.items).toHaveLength(1);
    expect(result.unassignedCustomers.items[0]).not.toHaveProperty('cantonName');
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

  it('accepts only the supported active-loan query values at the HTTP boundary', async () => {
    for (const activeLoanFilter of ['ALL', 'WITH_ACTIVE', 'WITHOUT_ACTIVE']) {
      expect(await validate(Object.assign(new AssignmentWorkspaceQueryDto(), { activeLoanFilter }))).toHaveLength(0);
    }
    expect(await validate(Object.assign(new AssignmentWorkspaceQueryDto(), { activeLoanFilter: 'ACTIVE' })))
      .toEqual(expect.arrayContaining([expect.objectContaining({ property: 'activeLoanFilter' })]));
  });
});
