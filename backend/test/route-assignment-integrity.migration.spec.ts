import type { QueryRunner } from 'typeorm';
import { EnforceActiveRouteAssignmentOwnership1762000000000 } from '../src/infrastructure/database/typeorm/migrations/1762000000000-enforce-active-route-assignment-ownership';

describe('active route assignment ownership migration', () => {
  const migration = new EnforceActiveRouteAssignmentOwnership1762000000000();

  it('diagnoses all conflicting active-assignment shapes before creating indexes', async () => {
    const statements: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => { statements.push(sql); return []; }) } as unknown as QueryRunner;
    await migration.up(runner);
    const diagnostic = statements[0];
    expect(diagnostic).toContain('CUSTOMER_MULTIPLE_ACTIVE');
    expect(diagnostic).toContain('ROUTE_MULTIPLE_ACTIVE_COLLECTORS');
    expect(diagnostic).toContain('DUPLICATE_ACTIVE_CUSTOMER_ROUTE');
    expect(diagnostic).toContain('DUPLICATE_ACTIVE_COLLECTOR_ROUTE');
    expect(statements[1]).toContain('CREATE UNIQUE INDEX "UQ_customer_route_assignments_active_customer"');
    expect(statements[1]).toContain('("customer_id") WHERE "ended_at" IS NULL');
    expect(statements[2]).toContain('CREATE UNIQUE INDEX "UQ_collector_route_assignments_active_route"');
    expect(statements[2]).toContain('("route_id") WHERE "ended_at" IS NULL');
    expect(statements.join('\n')).not.toContain('collector_user_id") WHERE');
  });

  it('fails safely and reports assignment ids without changing inconsistent data', async () => {
    const statements: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => {
      statements.push(sql);
      return [{ kind: 'CUSTOMER_MULTIPLE_ACTIVE', subjectId: 'customer-1', activeCount: 2, assignmentIds: ['a-1', 'a-2'] }];
    }) } as unknown as QueryRunner;
    await expect(migration.up(runner)).rejects.toThrow('customer-1');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^\s*SELECT/);
    expect(statements[0]).not.toMatch(/UPDATE|DELETE/);
  });

  it('reverts only the two ownership indexes', async () => {
    const statements: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => { statements.push(sql); return []; }) } as unknown as QueryRunner;
    await migration.down(runner);
    expect(statements).toEqual([
      'DROP INDEX "UQ_collector_route_assignments_active_route"',
      'DROP INDEX "UQ_customer_route_assignments_active_customer"',
    ]);
  });
});
