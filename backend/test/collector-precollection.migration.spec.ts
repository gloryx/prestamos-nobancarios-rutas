import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('collector precollection migration contract', () => {
  const migration = readFileSync(join(__dirname,
    '../src/infrastructure/database/typeorm/migrations/1762400000000-create-collector-precollections.ts'), 'utf8');

  it('creates the operational ledger with snapshots, states, audit and concurrency constraints', () => {
    expect(migration).toContain('numeric(18,2)');
    expect(migration).toContain('CHK_collector_precollections_amount');
    expect(migration).toContain("'RECORDED','SUBMITTED','SETTLED','REJECTED','CANCELLED'");
    expect(migration).toContain('customer_route_assignment_id');
    expect(migration).toContain('collector_route_assignment_id');
    expect(migration).toContain('UQ_collector_precollections_idempotency');
    expect(migration).toContain('UQ_collector_precollections_cancellation_key');
    expect(migration).toContain("WHERE \"status\" IN ('RECORDED','SUBMITTED')");
    expect(migration).toContain('cancelled_by_user_id');
    expect(migration).toContain('cancellation_reason');
    expect(migration).toContain('"notes" text');
    expect(migration).toContain('IDX_collector_precollections_route_date');
  });

  it('registers collector defaults without granting global view and protects rollback data', () => {
    expect(migration).toContain("role.code = 'COLLECTOR'");
    const defaults = migration.slice(migration.indexOf('INSERT INTO role_permissions'), migration.indexOf('async down'));
    expect(defaults).toContain('collector-precollections.create');
    expect(defaults).toContain('collector-precollections.assigned.view');
    expect(defaults).toContain('collector-precollections.cancel');
    expect(defaults).not.toContain("'collector-precollections.view'");
    expect(migration).toContain('Cannot roll back collector precollections while records exist');
    expect(migration).not.toContain('DROP SCHEMA');
  });

  it('keeps new domain and application files independent from NestJS and TypeORM', () => {
    const files = [
      '../src/domain/collector-precollection/collector-precollection.types.ts',
      '../src/domain/collector-precollection/collector-precollection.errors.ts',
      '../src/domain/collector-precollection/collector-precollection.rules.ts',
      '../src/application/collector-precollection/collector-precollection.ports.ts',
      '../src/application/collector-precollection/collector-precollection.use-cases.ts',
    ];
    for (const file of files) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(/from ['"]@nestjs\//);
      expect(source).not.toMatch(/from ['"]typeorm['"]/);
    }
  });
});
