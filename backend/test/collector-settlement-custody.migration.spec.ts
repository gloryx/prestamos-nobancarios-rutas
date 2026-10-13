import { readFileSync } from 'fs';
import { join } from 'path';

describe('Stage 3A settlement and custody migration contract', () => {
  const migration = readFileSync(join(__dirname,
    '../src/infrastructure/database/typeorm/migrations/1762500000000-create-collector-settlements-custody.ts'), 'utf8');
  const hardening = readFileSync(join(__dirname,
    '../src/infrastructure/database/typeorm/migrations/1762600000000-harden-collector-financial-integrity.ts'), 'utf8');
  it('owns settlement state, active reservation uniqueness and immutable custody', () => {
    expect(migration).toContain("'DRAFT','SUBMITTED','UNDER_REVIEW','CONFIRMED','REJECTED','CANCELLED'");
    expect(migration).toContain('UQ_collector_settlement_items_active_precollection');
    expect(migration).toContain('WHERE "active_reservation" = true');
    expect(migration).toContain('guard_collector_custody_immutable');
    expect(migration).toContain('BEFORE UPDATE OR DELETE');
    expect(migration).toContain('UQ_collector_custody_customer_collection');
    expect(migration).toContain('UQ_collector_custody_reversal');
    expect(migration).toContain('CREATE TABLE "collector_settlement_actions"');
    expect(migration).toContain('UQ_collector_settlement_actions_idempotency');
    expect(migration).toContain('actor_user_id');
    expect(migration).toContain('idempotency_fingerprint');
  });
  it('hardens future custody inserts without rewriting historical ledger entries', () => {
    expect(hardening).toContain('CREATE TABLE "collector_user_assignments"');
    expect(hardening).toContain('UQ_collector_user_assignments_active_collector');
    expect(hardening).toContain('UQ_collector_user_assignments_active_user');
    expect(hardening).toContain('CHK_collector_custody_entries_active_type');
    expect(hardening).toContain('CHK_collector_custody_entries_shape_v2');
    expect(hardening).toContain('NOT VALID');
    expect(hardening).toContain('TRG_collector_custody_validate_insert_v2');
    expect(hardening).toContain('BEFORE INSERT');
    expect(hardening).toContain('CHK_collector_custody_reversal_source_v2');
    expect(hardening).toContain('IDX_collector_settlement_items_payment');
    const up = hardening.slice(0, hardening.indexOf('async down'));
    expect(up).not.toContain('UPDATE "collector_custody_entries"');
    expect(up).not.toContain('DELETE FROM "collector_custody_entries"');
    const activeType = hardening.slice(hardening.indexOf('CHK_collector_custody_entries_active_type'),
      hardening.indexOf('CHK_collector_custody_entries_shape_v2'));
    expect(activeType).not.toContain('LOAN_DISBURSEMENT');
  });
  it('uses a compatibility-only explicit default and leaves loan disbursement dormant', () => {
    expect(migration).toContain("SET \"custody_treatment\" = 'COLLECTOR_HELD'");
    expect(migration).toContain("SELECT collector_id,'CREDIT','CUSTOMER_COLLECTION'");
    expect(migration).toContain("WHERE cp.status = 'CANCELLED'");
    expect(migration).toContain("'COLLECTOR_HELD','COMPANY_RECEIVED'");
    expect(migration).toContain("'LOAN_DISBURSEMENT'");
    expect(migration).not.toContain('created_by_user_id = collector_user_id');
  });
  it('makes legacy immediate up/down reversible while protecting Stage 3 business data and cleaning permissions', () => {
    const down = migration.slice(migration.indexOf('async down'));
    expect(down).not.toContain('UPDATE');
    expect(down).toContain('Cannot roll back collector settlements while records exist');
    expect(down).toContain("entry_type NOT IN ('CUSTOMER_COLLECTION','REVERSAL')");
    expect(down).toContain("custody_treatment = 'COMPANY_RECEIVED'");
    expect(down).toContain('DELETE FROM role_permissions');
    expect(down).toContain('DELETE FROM permissions');
    expect(down.indexOf('DROP TABLE "collector_settlement_actions"')).toBeLessThan(down.indexOf('DROP TABLE "collector_settlements"'));
    expect(migration).toContain("role.code = 'COLLECTION_MANAGER'");
    expect(migration).toContain('collector-custody.self.remit');
  });
});
