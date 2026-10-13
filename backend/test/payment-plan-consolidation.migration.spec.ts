import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('payment plan consolidation migration contract', () => {
  const migration = readFileSync(join(__dirname,
    '../src/infrastructure/database/typeorm/migrations/1762800000000-create-payment-plan-consolidations.ts'), 'utf8');
  const up = migration.slice(0, migration.indexOf('async down'));
  const down = migration.slice(migration.indexOf('async down'));

  it('creates only the approved additive consolidation structures without backfill', () => {
    for (const table of ['payment_plan_consolidations', 'payment_plan_consolidation_sources',
      'payment_plan_consolidation_reversals']) expect(up).toContain(`CREATE TABLE "${table}"`);
    expect(up).not.toMatch(/ALTER TABLE "(?:payments|payment_applications|payment_plan_entries|cash_movements)"/);
    expect(up).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) "?(?:payments|payment_applications|payment_plan_entries|cash_movements)"?/);
    expect(up).not.toContain('payment.use-case');
  });

  it('enforces loan identity, immutable snapshots, one event per payment and exact source totals', () => {
    expect(up).toContain('UQ_payment_plan_consolidation_payment');
    expect(up).toContain('CHK_payment_plan_consolidation_same_loan');
    expect(up).toContain('CHK_plan_consolidation_source_same_loan');
    expect(up).toContain('CHK_payment_plan_consolidation_target_snapshot');
    expect(up).toContain('CHK_plan_consolidation_source_snapshot');
    expect(up).toContain('CHK_payment_plan_consolidation_source_total');
    expect(up).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(up).toContain('guard_payment_plan_consolidation_immutable');
    expect(up).toContain('BEFORE UPDATE OR DELETE');
  });

  it('selects the deferred total identity without resolving a field from the other trigger table', () => {
    const validator = up.slice(up.indexOf('CREATE FUNCTION validate_payment_plan_consolidation_total'),
      up.indexOf('CREATE CONSTRAINT TRIGGER "TRG_payment_plan_consolidation_total_from_header"'));
    expect(validator).toContain("TG_TABLE_NAME = 'payment_plan_consolidations'");
    expect(validator).toContain("TG_TABLE_NAME = 'payment_plan_consolidation_sources'");
    expect(validator).toContain("(to_jsonb(NEW) ->> 'id')::uuid");
    expect(validator).toContain("(to_jsonb(NEW) ->> 'consolidation_id')::uuid");
    expect(validator).not.toContain('THEN NEW.id ELSE NEW.consolidation_id');
  });

  it('links one reversal to the annulment of the same payment', () => {
    expect(up).toContain('UQ_plan_consolidation_reversal_header');
    expect(up).toContain('UQ_plan_consolidation_reversal_annulment');
    expect(up).toContain('FK_plan_consolidation_reversal_annulment');
    expect(up).toContain('CHK_plan_consolidation_reversal_payment');
  });

  it('allows rollback only while all consolidation tables are empty', () => {
    expect(down).toContain('Cannot roll back payment plan consolidation schema while records exist');
    expect(down).toContain('DROP TABLE "payment_plan_consolidation_reversals"');
    expect(down).not.toContain('DROP TABLE "payments"');
    expect(down).not.toMatch(/(?:UPDATE|DELETE FROM) "?(?:payments|payment_applications|payment_plan_entries|cash_movements)"?/);
  });
});
