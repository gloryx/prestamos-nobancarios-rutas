import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('collector operational programming migration contract', () => {
  const migration = readFileSync(join(__dirname,
    '../src/infrastructure/database/typeorm/migrations/1762700000000-create-collector-operational-programming.ts'), 'utf8');
  const up = migration.slice(0, migration.indexOf('async down'));

  it('creates only the approved additive schema and nullable precollection link', () => {
    for (const table of [
      'collector_collection_model_activations',
      'collector_operational_plan_versions',
      'collector_operational_plan_entries',
      'collector_collection_day_snapshots',
    ]) expect(up).toContain(`CREATE TABLE "${table}"`);
    expect(up).toContain('ADD "collection_day_snapshot_id" uuid');
    expect(up).toContain('FK_collector_precollections_collection_day_snapshot');
    expect(up).not.toContain('INSERT INTO "collector_collection_model_activations"');
    expect(up).not.toContain('INSERT INTO collector_collection_model_activations');
    expect(up).not.toContain('UPDATE "payment_plan_entries"');
    expect(up).not.toContain('ALTER TABLE "payment_plan_entries"');
    expect(up).not.toContain('INSERT INTO "payment_plan_entries"');
  });

  it('enforces append-only history, linear versions and idempotent snapshot generation', () => {
    expect(up).toContain('guard_collector_operational_immutable');
    expect(up).toContain('BEFORE UPDATE OR DELETE');
    expect(up).toContain('UQ_collector_operational_plan_loan_version');
    expect(up).toContain('UQ_collector_operational_plan_previous');
    expect(up).toContain('UQ_collector_collection_day_snapshot_revision');
    expect(up).toContain('UQ_collector_collection_day_snapshot_previous');
    expect(up).toContain('UQ_collector_collection_day_snapshot_generation_key');
    expect(up).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(up).toContain('snapshotted operational plan entries are sealed');
  });

  it('validates baseline reservations, assignments, snapshot amounts and effective collection date', () => {
    expect(up).toContain('baseline_valid_payments');
    expect(up).toContain('baseline_active_precollections');
    expect(up).toContain('plan_total" = "baseline_financial_balance" - "baseline_active_precollections');
    expect(up).toContain('CHK_collector_operational_plan_financial_baseline');
    expect(up).toContain('CHK_collector_operational_plan_assignment');
    expect(up).toContain('CHK_collector_collection_day_snapshot_amounts_source');
    expect(up).toContain('CHK_collector_collection_day_snapshot_assignment');
    expect(up).toContain('snapshot.snapshot_date = NEW.effective_date');
    expect(up).not.toContain('recorded_at = NEW.snapshot_date');
  });

  it('blocks rollback once operational records exist and otherwise removes only additive objects', () => {
    const down = migration.slice(migration.indexOf('async down'));
    expect(down).toContain('Cannot roll back collector operational programming while records exist');
    expect(down).toContain('DROP COLUMN "collection_day_snapshot_id"');
    expect(down).not.toContain('DROP TABLE "payment_plan_entries"');
    expect(down).not.toContain('DELETE FROM');
    expect(down).not.toContain('UPDATE');
  });
});
