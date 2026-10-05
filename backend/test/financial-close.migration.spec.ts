import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('financial close V2 migration contract', () => {
  const migration = readFileSync(join(__dirname, '../src/infrastructure/database/typeorm/migrations/1762100000000-create-financial-closes-v2.ts'), 'utf8');
  it('creates versioned immutable header/details with sequence and permission constraints', () => {
    expect(migration).toContain('model_version');
    expect(migration).toContain('UQ_financial_closes_period');
    expect(migration).toContain('UQ_financial_closes_sequence');
    expect(migration).toContain('numeric(38,2)');
    expect(migration).toContain('guard_financial_close_header_mutation');
    expect(migration).toContain('guard_financial_close_concept_mutation');
    expect(migration).toMatch(/"confirmed_at" timestamptz,/);
    expect(migration).not.toMatch(/"confirmed_at" timestamptz NOT NULL DEFAULT/);
    expect(migration).toContain("OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL");
    expect(migration).toContain("to_jsonb(NEW) - 'confirmed_at'");
    expect(migration).toContain('BEFORE INSERT OR UPDATE OR DELETE ON "financial_close_concepts"');
    expect(migration).toContain('confirmed_at IS NULL FOR SHARE');
    expect(migration).toContain('concepts can only be inserted before sealing');
    expect(migration).toContain('CONTRACTUAL_PORTFOLIO');
    expect(migration).toContain('RECONCILIATIONS');
    expect(migration).toContain('financial-closes.view');
    expect(migration).toContain('financial-closes.confirm');
    expect(migration).not.toContain('DROP SCHEMA');
  });
});
