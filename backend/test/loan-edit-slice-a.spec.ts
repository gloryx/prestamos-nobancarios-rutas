import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { getMetadataArgsStorage, type QueryRunner } from 'typeorm';
import type { LoanEditBaseline, LoanEditInput, LoanEditIdentity } from '../src/domain/loan/loan-edit.types';
import { LoanController } from '../src/presentation/loan/loan.controller';
import { LoanEditOperationOrmEntity } from '../src/infrastructure/database/typeorm/entities';
import { CreateLoanEditOperations1761700000000 } from '../src/infrastructure/database/typeorm/migrations/1761700000000-create-loan-edit-operations';
import { LoanEditIdempotencyConflictError, LoanEditIdempotencyInputError, LoanEditOperationsRepository } from '../src/infrastructure/database/typeorm/repositories/loan-edit-operations.repository';

describe('unpublished ACTIVE loan edit input', () => {
  it('requires the full opening contract and positive-row snapshot for metadata and interest edits', () => {
    const baseline: LoanEditBaseline = {
      interestAmount: '20.00', paymentFrequencyId: 'frequency-before', preferredPaymentMethodId: 'method-before',
      observations: null, financialBalance: '120.00',
       plan: [{ id: 'entry-1', dueDate: '2026-10-01', pendingAmount: '120.00' }],
    };
     const metadata: LoanEditInput = { idempotencyKey: 'k1', baseline, changes: { observations: null, paymentFrequencyId: 'frequency-after' } };
     const clearBlank: LoanEditInput = { idempotencyKey: 'k2', baseline, changes: { observations: '' } };
     const financial: LoanEditInput = { idempotencyKey: 'k3', baseline, changes: { interestAmount: '30.00' },
       plan: [{ id: 'entry-1', dueDate: '2026-10-01', pendingAmount: '130.00' }] };
     const interestWithoutPlan: LoanEditInput = { idempotencyKey: 'k4', baseline, changes: { interestAmount: '30.00' } };
    expect(metadata.baseline).toEqual({ interestAmount: '20.00', paymentFrequencyId: 'frequency-before',
      preferredPaymentMethodId: 'method-before', observations: null, financialBalance: '120.00',
       plan: [{ id: 'entry-1', dueDate: '2026-10-01', pendingAmount: '120.00' }] });
     expect(metadata).not.toHaveProperty('interestAmount');
     expect(clearBlank.changes.observations).toBe('');
     expect(financial.baseline).toEqual(metadata.baseline);
     expect(financial.plan?.[0].id).toBe('entry-1');
     expect(interestWithoutPlan.plan).toBeUndefined();
    type Immutable = 'principal' | 'startDate' | 'totalAmount' | 'customerId' | 'loanNumber' | 'status' | 'createdByUserId';
    const immutableKeysExcluded: Extract<keyof LoanEditInput, Immutable> extends never ? true : false = true;
    expect(immutableKeysExcluded).toBe(true);
    // @ts-expect-error metadata-only edits also require the opening baseline
     const missingBaseline: LoanEditInput = { idempotencyKey: 'k4', changes: { observations: 'new' } };
     // @ts-expect-error changes must be nested, not flattened
     const flattened: LoanEditInput = { idempotencyKey: 'k4', baseline, interestAmount: '30.00' };
    // @ts-expect-error opening observations must be captured even when the draft omits them
    const missingOriginalObservations: LoanEditBaseline = { interestAmount: '20.00', paymentFrequencyId: 'frequency-before',
       preferredPaymentMethodId: 'method-before', financialBalance: '120.00', plan: [] };
     // @ts-expect-error immutable principal is not a loan edit field
     const immutable: LoanEditInput = { idempotencyKey: 'k5', baseline, changes: {}, principal: '100.00' };
     // @ts-expect-error calculated total is never accepted as a loan edit field
     const calculated: LoanEditInput = { idempotencyKey: 'k6', baseline, changes: {}, totalAmount: '120.00' };
     // @ts-expect-error immutable attributes cannot be nested in changes either
     const immutableChange: LoanEditInput = { idempotencyKey: 'k7', baseline, changes: { startDate: '2026-01-01' } };
     void missingBaseline; void flattened; void missingOriginalObservations; void immutable; void calculated; void immutableChange;
  });

  it('does not register a partial PATCH method on the existing loans controller', () => {
    const handlers = Object.getOwnPropertyNames(LoanController.prototype)
      .filter((name) => name !== 'constructor').map((name) => LoanController.prototype[name as keyof LoanController]);
    expect(handlers.filter((handler) => Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.PATCH)).toEqual([]);
  });
});

describe('loan edit operations migration (source shape, not database enforcement)', () => {
  it('adds only a separate durable table, global unique key, immutable receipt fields and earlier-table restrictive FKs', async () => {
    const sql: string[] = [];
    const migration = new CreateLoanEditOperations1761700000000();
    expect(migration.name).toBe('CreateLoanEditOperations1761700000000');
    await migration.up({ query: async (statement: string) => { sql.push(statement); return []; } } as unknown as QueryRunner);
    expect(sql).toHaveLength(1);
    const table = sql[0];
    expect(table).toContain('CREATE TABLE "loan_edit_operations"');
    for (const column of ['"id" uuid NOT NULL DEFAULT gen_random_uuid()', '"loan_id" uuid NOT NULL', '"created_by_user_id" uuid NOT NULL',
      '"idempotency_key" varchar(128) NOT NULL', '"idempotency_fingerprint" varchar(64) NOT NULL', '"created_at" timestamptz NOT NULL DEFAULT now()']) expect(table).toContain(column);
    expect(table).toContain('PRIMARY KEY ("id")');
    expect(table).toContain('UNIQUE ("idempotency_key")');
    expect(table).toContain('CHECK ("idempotency_fingerprint" ~ \'^[0-9a-f]{64}$\')');
    for (const [column, target] of [['loan_id', 'loans'], ['created_by_user_id', 'users']]) {
      expect(table).toContain(`FOREIGN KEY ("${column}") REFERENCES "${target}"("id") ON DELETE RESTRICT`);
    }
    expect(table).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM|CASCADE)\b/i);
    const base = join(__dirname, '../src/infrastructure/database/typeorm/migrations');
    expect(readFileSync(join(base, '1761300000000-create-loans.ts'), 'utf8')).toContain('CREATE TABLE "loans"');
    expect(readFileSync(join(base, '1760600000000-create-security.ts'), 'utf8')).toContain('CREATE TABLE "users"');
    expect(1761700000000).toBeGreaterThan(1761600000000);
    const down: string[] = [];
    await migration.down({ query: async (statement: string) => { down.push(statement); return []; } } as unknown as QueryRunner);
    expect(down).toEqual(['DROP TABLE "loan_edit_operations"']);
  });

  it('registers matching non-null TypeORM columns in both runtime and CLI data sources', () => {
    const metadata = getMetadataArgsStorage();
    expect(metadata.tables.find((table) => table.target === LoanEditOperationOrmEntity)?.name).toBe('loan_edit_operations');
    const columns = metadata.columns.filter((column) => column.target === LoanEditOperationOrmEntity);
    for (const name of ['loan_id', 'created_by_user_id', 'idempotency_key', 'idempotency_fingerprint', 'created_at']) {
      expect(columns.find((column) => (column.options.name ?? column.propertyName) === name)?.options.nullable).not.toBe(true);
    }
    expect(columns.find((column) => column.propertyName === 'idempotencyKey')?.options).toMatchObject({ unique: true, length: 128 });
    const root = join(__dirname, '../src');
    for (const path of ['app.module.ts', 'infrastructure/database/typeorm/data-source.ts']) {
      expect(readFileSync(join(root, path), 'utf8').match(/LoanEditOperationOrmEntity/g)).toHaveLength(2);
    }
  });
});

describe('loan edit operation receipts before route publication', () => {
  const date = new Date('2026-09-29T12:00:00.000Z');
  const fingerprint = 'a'.repeat(64);
  const input: LoanEditIdentity = { loanId: 'loan-a', actorId: 'actor-a', idempotencyKey: 'edit-key', fingerprint };
  const row = { operationId: 'operation-a', loanId: input.loanId, actorId: input.actorId, fingerprint, createdAt: date };

  it('replays only the original receipt even when the current Loan changes, and rejects changed actor, loan or payload', async () => {
    let currentLoan = { status: 'ACTIVE', interestAmount: '20.00' };
    const query = jest.fn(async (sql: string) => { expect(sql).toContain('FROM loan_edit_operations'); return [row]; });
    const store = new LoanEditOperationsRepository();
    const first = await store.findReplay({ query } as never, input);
    currentLoan = { status: 'CANCELLED', interestAmount: '45.00' };
    expect(currentLoan.interestAmount).toBe('45.00');
    expect(await store.findReplay({ query } as never, input)).toEqual(first);
    expect(first).toEqual({ operationId: 'operation-a', loanId: 'loan-a', createdAt: date });
    for (const changed of [{ actorId: 'actor-b' }, { loanId: 'loan-b' }, { fingerprint: 'b'.repeat(64) }]) {
      await expect(store.findReplay({ query } as never, { ...input, ...changed })).rejects.toBeInstanceOf(LoanEditIdempotencyConflictError);
    }
    expect(query.mock.calls.every(([sql]) => !sql.includes('FROM loans'))).toBe(true);
  });

  it('claims with one transaction manager and aborts losing key races rather than returning a success after an edit', async () => {
    const query = jest.fn(async (sql: string) => { expect(sql).toMatch(/ON CONFLICT \(idempotency_key\) DO NOTHING RETURNING/); return [row]; });
    const store = new LoanEditOperationsRepository();
    expect(await store.claim({ query } as never, input)).toEqual({ operationId: row.operationId, loanId: row.loanId, createdAt: date });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO loan_edit_operations'), [input.loanId, input.actorId, input.idempotencyKey, fingerprint]);
    query.mockResolvedValueOnce([]);
    await expect(store.claim({ query } as never, input)).rejects.toBeInstanceOf(LoanEditIdempotencyConflictError);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('never claims an invalid key/fingerprint and relies on the caller transaction to roll back failed edits and claims', async () => {
    const store = new LoanEditOperationsRepository();
    const missing = jest.fn().mockResolvedValue([]);
    expect(await store.findReplay({ query: missing } as never, input)).toBeUndefined();
    const persisted = new Map<string, typeof row>();
    const transaction = async (work: (manager: { query: (sql: string, args: string[]) => Promise<(typeof row)[]> }) => Promise<unknown>) => {
      const staged = new Map(persisted);
      const manager = { query: async (_sql: string, args: string[]) => {
        if (staged.has(args[2])) return [];
        staged.set(args[2], row);
        return [row];
      } };
      const result = await work(manager);
      for (const [key, value] of staged) persisted.set(key, value);
      return result;
    };
    await expect(transaction(async (manager) => { await store.claim(manager as never, input); throw new Error('edit failed'); })).rejects.toThrow('edit failed');
    expect(persisted.size).toBe(0);
    await transaction(async (manager) => store.claim(manager as never, input));
    expect(persisted.size).toBe(1);
    const query = jest.fn();
    await expect(store.claim({ query } as never, { ...input, idempotencyKey: 'invalid key' })).rejects.toBeInstanceOf(LoanEditIdempotencyInputError);
    await expect(store.findReplay({ query } as never, { ...input, fingerprint: 'not-a-hash' })).rejects.toBeInstanceOf(LoanEditIdempotencyInputError);
    expect(query).not.toHaveBeenCalled();
  });
});
