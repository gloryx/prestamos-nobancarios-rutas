import type { QueryRunner } from 'typeorm';
import { AddAssignmentActors1760900000000 } from '../src/infrastructure/database/typeorm/migrations/1760900000000-add-assignment-actors';

describe('assignment actor migration ownership', () => {
  const migration = new AddAssignmentActors1760900000000();

  it('does not duplicate or undo actor columns and foreign keys already owned by the preceding migration', async () => {
    const statements: string[] = [];
    const runner = { query: async (sql: string) => {
      statements.push(sql);
      return sql.includes('information_schema.columns') ? [{ columns: 2, constraints: 2 }] : [{ count: 0 }];
    } } as unknown as QueryRunner;
    await migration.up(runner);
    await migration.down(runner);
    expect(statements).toHaveLength(2);
    expect(statements.every((sql) => sql.startsWith('SELECT'))).toBe(true);
  });

  it('adds and reverses its own columns for the legacy schema without actors', async () => {
    const statements: string[] = [];
    const runner = { query: async (sql: string) => {
      statements.push(sql);
      return sql.includes('information_schema.columns') ? [{ columns: 0, constraints: 0 }] : [{ count: 2 }];
    } } as unknown as QueryRunner;
    await migration.up(runner);
    await migration.down(runner);
    expect(statements.filter((sql) => sql.includes('ADD "assigned_by_user_id"'))).toHaveLength(2);
    expect(statements.filter((sql) => sql.includes('DROP COLUMN "assigned_by_user_id"'))).toHaveLength(2);
  });

  it('refuses to guess ownership of a partial actor schema', async () => {
    const runner = { query: async () => [{ columns: 1, constraints: 0 }] } as unknown as QueryRunner;
    await expect(migration.up(runner)).rejects.toThrow('Assignment actor schema is incomplete.');
  });
});
