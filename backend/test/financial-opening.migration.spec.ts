import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('financial opening migration contract', () => {
  const migration = readFileSync(join(__dirname, '../src/infrastructure/database/typeorm/migrations/1761100000000-create-financial-openings.ts'), 'utf8');

  it('keeps numeric precision, actor foreign key, and singleton uniqueness', () => {
    expect(migration).toContain('numeric(18,2)');
    expect(migration).toMatch(/opened_by_user_id.*REFERENCES ["']users["']/s);
    expect(migration).toContain('UQ_financial_openings_singleton_key');
    expect(migration).toContain('CREATE UNIQUE INDEX');
  });
});
