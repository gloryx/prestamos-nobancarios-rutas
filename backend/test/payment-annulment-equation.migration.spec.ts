import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('annulled payment allocation migration contract', () => {
  const migration = readFileSync(join(__dirname,
    '../src/infrastructure/database/typeorm/migrations/1762900000000-preserve-annulled-payment-allocation.ts'), 'utf8');
  const up = migration.slice(0, migration.indexOf('async down'));
  const down = migration.slice(migration.indexOf('async down'));

  it('preserves the immutable allocation while replacing the incompatible status branch', () => {
    expect(up).toContain('DROP CONSTRAINT "CHK_payments_equation"');
    expect(up).toContain('"amount" = "principal_applied" + "interest_applied"');
    expect(up).toContain('"principal_applied" >= 0');
    expect(up).toContain('"interest_applied" >= 0');
    expect(up).not.toContain('"principal_applied" = 0');
    expect(up).not.toContain('"interest_applied" = 0');
    expect(up).toContain('NOT VALID');
    expect(up).toContain('VALIDATE CONSTRAINT "CHK_payments_equation"');
  });

  it('changes no payment facts, statuses, applications, annulments or cash movements', () => {
    expect(up).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/);
    expect(up).not.toContain('payment_applications');
    expect(up).not.toContain('payment_annulments');
    expect(up).not.toContain('cash_movements');
  });

  it('documents the exact previous constraint for a guarded rollback', () => {
    expect(down).toContain('"status" = \'VALID\'');
    expect(down).toContain('"status" = \'ANNULLED\'');
    expect(down).toContain('"principal_applied" = 0');
    expect(down).toContain('VALIDATE CONSTRAINT "CHK_payments_equation"');
  });
});
