import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMetadataArgsStorage, type QueryRunner } from 'typeorm';
import { CreateLoanStatusHistory1761500000000 } from '../src/infrastructure/database/typeorm/migrations/1761500000000-create-loan-status-history';
import { AddLoanStatusHistorySequence1761600000000 } from '../src/infrastructure/database/typeorm/migrations/1761600000000-add-loan-status-history-sequence';
import { LoanStatusHistoryOrmEntity } from '../src/infrastructure/database/typeorm/entities/loan-status-history.orm-entity';
import type { LoanStatusHistory } from '../src/domain/loan/loan.types';

describe('loan status history migration source-shape (not PostgreSQL enforcement)', () => {
  let statements: string[];
  beforeAll(async () => {
    statements = [];
    await new CreateLoanStatusHistory1761500000000().up({ query: async (sql: string) => { statements.push(sql); return []; } } as unknown as QueryRunner);
  });

  it('defines non-null creation and technical timestamps with the established UUID default', () => {
    const table = statements[0];
    expect(table).toContain('CREATE TABLE "loan_status_history"');
    expect(table).toMatch(/"id" uuid NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(table).toMatch(/"loan_id" uuid NOT NULL/);
    expect(table).toMatch(/"changed_at" timestamptz NOT NULL/);
    expect(table).toMatch(/"created_at" timestamptz NOT NULL DEFAULT now\(\)/);
    expect(table).toMatch(/"changed_by_user_id" uuid,/);
    expect(table).toMatch(/"reason" text,/);
    expect(table).toMatch(/"payment_id" uuid,/);
    expect(table).toMatch(/"payment_annulment_id" uuid,/);
  });

  it('accepts the CREATED shape but excludes a source status, non-ACTIVE target, reason and payment references', () => {
    expect(statements[0]).toContain('CHECK ("event_kind" IN (\'CREATED\',\'TRANSITION\'))');
    expect(statements[0]).toMatch(/"event_kind" = 'CREATED' AND "from_status" IS NULL AND "to_status" = 'ACTIVE' AND "reason" IS NULL AND "payment_id" IS NULL AND "payment_annulment_id" IS NULL/);
  });

  it('accepts only a TRANSITION with a non-null, different source status and existing loan status values', () => {
    expect(statements[0]).toMatch(/"event_kind" = 'TRANSITION' AND "from_status" IS NOT NULL AND "from_status" <> "to_status"/);
    const statuses = "'ACTIVE','CANCELLED','REFINANCED','UNCOLLECTIBLE','ANNULLED'";
    expect(statements[0]).toContain(`"to_status" IN (${statuses})`);
    expect(statements[0]).toContain(`"from_status" IS NULL OR "from_status" IN (${statuses})`);
    const loanMigration = readFileSync(join(__dirname, '../src/infrastructure/database/typeorm/migrations/1761300000000-create-loans.ts'), 'utf8');
    expect(loanMigration).toContain(`"status" IN (${statuses})`);
  });

  it('permits payment-backed closure and reopening with the same payment reference', () => {
    const schema = statements.join(' ');
    expect(schema).toContain('"payment_id" uuid,');
    expect(schema).toContain('"payment_annulment_id" uuid,');
    expect(schema).toContain('"reason" text,');
    expect(statements[0]).not.toMatch(/UNIQUE\s*\([^)]*"payment_id"/i);
    expect(statements.slice(1).filter((statement) => statement.includes('UNIQUE INDEX'))).not.toEqual(expect.arrayContaining([expect.stringMatching(/\([^)]*"payment_id"/)]));
    expect(statements[3]).toContain('WHERE "event_kind" = \'CREATED\'');
  });

  it('references four real, earlier tables with RESTRICT and has the required ordering and CREATED uniqueness indexes', () => {
    for (const [column, table, source] of [
      ['loan_id', 'loans', '1761300000000-create-loans.ts'],
      ['changed_by_user_id', 'users', '1760600000000-create-security.ts'],
      ['payment_id', 'payments', '1761400000000-create-payments.ts'],
      ['payment_annulment_id', 'payment_annulments', '1761400000000-create-payments.ts'],
    ]) {
      expect(statements[0]).toContain(`FOREIGN KEY ("${column}") REFERENCES "${table}"("id") ON DELETE RESTRICT`);
      const existing = readFileSync(join(__dirname, '../src/infrastructure/database/typeorm/migrations', source), 'utf8');
      expect(existing).toContain(`CREATE TABLE "${table}" ("id" uuid NOT NULL`);
      expect(Number(source.slice(0, 13))).toBeLessThan(1761500000000);
    }
    expect(statements[1]).toMatch(/ON "loan_status_history" \("loan_id", "changed_at" DESC, "id" DESC\)/);
    expect(statements[2]).toMatch(/ON "loan_status_history" \("to_status", "changed_at"\)/);
    expect(statements[3]).toMatch(/CREATE UNIQUE INDEX .* ON "loan_status_history" \("loan_id"\) WHERE "event_kind" = 'CREATED'/);
    expect(statements.join(' ')).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM|BASELINE|CASCADE)\b/i);
  });

  it('maps nullable and required columns and registers the entity without adding a reader', () => {
    const columns = getMetadataArgsStorage().columns.filter((column) => column.target === LoanStatusHistoryOrmEntity);
    const byName = (name: string) => columns.find((column) => (column.options.name ?? column.propertyName) === name);
    expect(getMetadataArgsStorage().tables.find((table) => table.target === LoanStatusHistoryOrmEntity)?.name).toBe('loan_status_history');
    expect(byName('event_kind')?.options.type).toBe('varchar');
    expect(byName('from_status')?.options.nullable).toBe(true);
    expect(byName('to_status')?.options.nullable).not.toBe(true);
    expect(byName('changed_at')?.options.type).toBe('timestamptz');
    for (const name of ['changed_by_user_id', 'reason', 'payment_id', 'payment_annulment_id']) expect(byName(name)?.options.nullable).toBe(true);
    for (const file of ['data-source.ts', '../../../app.module.ts']) {
      const contents = readFileSync(join(__dirname, '../src/infrastructure/database/typeorm', file), 'utf8');
      expect(contents.match(/LoanStatusHistoryOrmEntity/g)).toHaveLength(2);
    }
  });
});

describe('loan status history sequence migration (source contract, not database enforcement)', () => {
  it('adds the required sequence and optional identity without defaults, backfill or rewriting the original migration', async () => {
    const statements: string[] = [];
    const runner = { query: async (sql: string) => { statements.push(sql); return []; } } as unknown as QueryRunner;
    const migration = new AddLoanStatusHistorySequence1761600000000();
    expect(migration.name).toBe('AddLoanStatusHistorySequence1761600000000');
    await migration.up(runner);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/ALTER TABLE "loan_status_history" ADD "event_sequence" integer NOT NULL, ADD "idempotency_key" character varying\(128\), ADD "idempotency_fingerprint" text/);
    expect(statements[0]).not.toMatch(/\b(DEFAULT|UPDATE|INSERT|BASELINE|BACKFILL)\b/i);
    expect(statements[1]).toMatch(/CREATE UNIQUE INDEX "UQ_loan_status_history_loan_sequence" ON "loan_status_history" \("loan_id", "event_sequence"\)/);
    expect(statements[2]).toMatch(/CREATE UNIQUE INDEX "UQ_loan_status_history_idempotency_key" ON "loan_status_history" \("idempotency_key"\) WHERE "idempotency_key" IS NOT NULL/);
    const original = readFileSync(join(__dirname, '../src/infrastructure/database/typeorm/migrations/1761500000000-create-loan-status-history.ts'), 'utf8');
    expect(original).not.toMatch(/event_sequence|idempotency_key|idempotency_fingerprint/);
    const source = readFileSync(join(__dirname, '../src/infrastructure/database/typeorm/migrations/1761600000000-add-loan-status-history-sequence.ts'), 'utf8');
    const down = source.slice(source.indexOf('async down('));
    expect(down).toContain('DROP INDEX "UQ_loan_status_history_idempotency_key"');
    expect(down).toContain('DROP INDEX "UQ_loan_status_history_loan_sequence"');
    expect(down).toContain('DROP COLUMN "idempotency_fingerprint", DROP COLUMN "idempotency_key", DROP COLUMN "event_sequence"');
    expect(down).not.toMatch(/DROP TABLE|\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it('maps the required integer and nullable identity to the existing domain history', () => {
    const columns = getMetadataArgsStorage().columns.filter((column) => column.target === LoanStatusHistoryOrmEntity);
    const byName = (name: string) => columns.find((column) => (column.options.name ?? column.propertyName) === name)?.options;
    expect(byName('event_sequence')).toMatchObject({ type: 'integer' });
    expect(byName('event_sequence')?.nullable).not.toBe(true);
    expect(byName('idempotency_key')).toMatchObject({ type: 'varchar', length: 128, nullable: true });
    expect(byName('idempotency_fingerprint')).toMatchObject({ type: 'text', nullable: true });
    const fields: Pick<LoanStatusHistory, 'eventSequence' | 'idempotencyKey' | 'idempotencyFingerprint'> = { eventSequence: 1, idempotencyKey: null, idempotencyFingerprint: null };
    expect(fields).toEqual({ eventSequence: 1, idempotencyKey: null, idempotencyFingerprint: null });
  });

  it('models the two unique index shapes for manual events while allowing distinct loans and multiple NULL keys', () => {
    const events: Array<{ loanId: string; sequence: number; key: string | null }> = [];
    const insert = (loanId: string, sequence: number, key: string | null) => {
      if (events.some((event) => event.loanId === loanId && event.sequence === sequence)) throw new Error('UQ_loan_status_history_loan_sequence');
      if (key !== null && events.some((event) => event.key === key)) throw new Error('UQ_loan_status_history_idempotency_key');
      events.push({ loanId, sequence, key });
    };
    insert('loan-a', 1, null);
    insert('loan-b', 1, null);
    insert('loan-a', 2, 'manual-key');
    expect(() => insert('loan-a', 2, null)).toThrow('UQ_loan_status_history_loan_sequence');
    expect(() => insert('loan-b', 2, 'manual-key')).toThrow('UQ_loan_status_history_idempotency_key');
    insert('loan-b', 2, null);
    expect(events).toHaveLength(4);
  });
});
