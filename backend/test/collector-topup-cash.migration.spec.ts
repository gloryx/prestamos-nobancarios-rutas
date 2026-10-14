import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('collector top-up cash migration contract', () => {
  const migration = readFileSync(join(__dirname,
    '../src/infrastructure/database/typeorm/migrations/1763000000000-link-collector-topups-to-cash.ts'), 'utf8');

  it('adds a dedicated cash concept and one-to-one custody linkage without executing data changes', () => {
    expect(migration).toContain("'COLLECTOR_CUSTODY_TRANSFER'");
    expect(migration).toContain('collector_custody_entry_id');
    expect(migration).toContain('UQ_cash_collector_custody_entry');
    expect(migration).toContain('FK_cash_collector_custody_entry');
    expect(migration).toContain('Cannot enable collector top-up cash linkage while unlinked top-ups exist');
  });

  it('requires atomic matching amount, date, method, reference and responsible user', () => {
    for (const value of ['custody.amount <> NEW.amount', 'custody.effective_date <> NEW.movement_date',
      'custody.payment_method_id IS DISTINCT FROM NEW.payment_method_id',
      'custody.reference IS DISTINCT FROM NEW.observations',
      'custody.created_by_user_id <> NEW.created_by_user_id']) expect(migration).toContain(value);
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('CHK_collector_topup_requires_cash');
    expect(migration).toContain('collector top-up cash movements are immutable');
  });
});
