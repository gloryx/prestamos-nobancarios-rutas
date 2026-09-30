import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource, type EntityManager, type QueryRunner } from 'typeorm';
import { EditLoanUseCase, type LoanEditWriter } from '../src/application/loan/edit-loan.use-case';
import { normalizeLoanEditCommand } from '../src/application/loan/loan-edit.command';
import type { LoanEditBaseline, LoanEditInput } from '../src/domain/loan/loan-edit.types';
import { EditLoanTypeormWriter } from '../src/infrastructure/database/typeorm/repositories/edit-loan.writer';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { LoanEditIdempotencyConflictError } from '../src/infrastructure/database/typeorm/repositories/loan-edit-operations.repository';

// No application datasource import: it loads .env. Only an explicit process environment can activate this suite.
const enabled = process.env.RUN_LOAN_EDIT_B5_POSTGRES === '1';
const suite = enabled ? describe : describe.skip;
const approvedDatabase = 'prestamos_nobancarios';
const tables = ['migrations', 'roles', 'users', 'customers', 'payment_methods', 'payment_frequencies',
  'loans', 'payment_plan_entries', 'payments', 'loan_edit_operations'];

type Fixture = ReturnType<typeof fixtureIds>;
function fixtureIds() {
  const tag = randomUUID();
  return { tag, role: randomUUID(), actor: randomUUID(), customer: randomUUID(), method: randomUUID(),
    frequency: randomUUID(), loan: randomUUID(), plan: [randomUUID(), randomUUID()] as const,
    loanNumber: (100_000_000_000_000n + BigInt(`0x${randomBytes(6).toString('hex')}`)).toString(),
    keys: [`b5-first-${tag}`, `b5-rollback-${tag}`, `b5-concurrent-${tag}`] as const };
}

function guardedSource(): DataSource {
  if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST ?? '')
    || process.env.DB_PORT !== '5432' || process.env.DB_DATABASE !== approvedDatabase) {
    throw new Error('B5 requires an explicit approved loopback PostgreSQL host, port and database.');
  }
  if (!process.env.DB_USERNAME || !process.env.DB_PASSWORD) throw new Error('B5 requires credentials in the process environment.');
  // Pin localhost to an IP to avoid resolving later pool connections to another address.
  return new DataSource({ type: 'postgres', host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : process.env.DB_HOST, port: 5432,
    database: approvedDatabase, username: process.env.DB_USERNAME, password: process.env.DB_PASSWORD,
    synchronize: false, migrationsRun: false, logging: false,
    extra: { max: 4, connectionTimeoutMillis: 3000,
      options: '-c search_path=public -c statement_timeout=6000 -c idle_in_transaction_session_timeout=7000' } });
}

async function preflight(source: DataSource): Promise<void> {
  const [session] = await source.query(`SELECT host(inet_server_addr()) AS address, inet_server_port() AS port,
    current_database() AS database, current_schema() AS schema, current_setting('search_path') AS path`);
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(session.address)
    || session.port !== 5432 || session.database !== approvedDatabase
    || session.schema !== 'public' || session.path !== 'public') throw new Error('B5 rejected the PostgreSQL session identity.');
  const [shape] = await source.query(`SELECT COUNT(*)::int AS count FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`, [tables]);
  if (shape.count !== tables.length) throw new Error('B5 requires the expected public schema.');
  const [migrations] = await source.query(`SELECT COUNT(*)::int AS count FROM public.migrations
    WHERE (timestamp = 1761400000000 AND name = 'CreatePayments1761400000000')
       OR (timestamp = 1761700000000 AND name = 'CreateLoanEditOperations1761700000000')`);
  const [key] = await source.query(`SELECT COUNT(*)::int AS count FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.loan_edit_operations'::regclass
      AND conname = 'UQ_loan_edit_operations_key' AND contype = 'u'`);
  const [existing] = await source.query(`SELECT (SELECT COUNT(*)::int FROM public.loans) AS loans,
    (SELECT COUNT(*)::int FROM public.payments) AS payments`);
  if (migrations.count !== 2 || key.count !== 1 || existing.loans !== 14 || existing.payments !== 17) {
    throw new Error('B5 migration, uniqueness or original row counts differ from the approved baseline.');
  }
}

async function insertFixture(manager: EntityManager, f: Fixture): Promise<void> {
  await manager.query(`INSERT INTO public.roles (id, code, name) VALUES ($1, $2, $3)`,
    [f.role, `B5_${f.tag}`, `B5 ${f.tag}`]);
  await manager.query(`INSERT INTO public.users (id, username, full_name, password_hash, role_id)
    VALUES ($1, $2, 'B5 Fixture', '!disabled-test-account!', $3)`, [f.actor, `b5_${f.tag}`, f.role]);
  await manager.query(`INSERT INTO public.customers (id, identification_type, identification, first_name,
    first_last_name, gender, birth_date, primary_phone, nationality)
    VALUES ($1, 'NATIONAL', $2, 'Test', 'Fixture', 'MALE', '2000-01-01', '00000000', 'COSTA_RICAN')`,
  [f.customer, `b5_${f.tag}`]);
  await manager.query(`INSERT INTO public.payment_methods (id, name, display_order) VALUES ($1, $2, 1)`,
    [f.method, `B5 method ${f.tag}`]);
  await manager.query(`INSERT INTO public.payment_frequencies (id, name, interval_unit, interval_value, display_order)
    VALUES ($1, $2, 'MONTH', 1, 1)`, [f.frequency, `B5 frequency ${f.tag}`]);
  // Explicit number avoids advancing the shared loan_number_seq, even on a rolled-back fixture.
  await manager.query(`INSERT INTO public.loans (id, loan_number, customer_id, payment_frequency_id,
    preferred_payment_method_id, start_date, principal, interest_amount, total_amount,
    observations, status, created_by_user_id, idempotency_key)
    VALUES ($1, $2, $3, $4, $5, '2026-09-30', 100, 20, 120, 'ORIGINAL', 'ACTIVE', $6, $7)`,
  [f.loan, f.loanNumber, f.customer, f.frequency, f.method, f.actor, `b5-loan-${f.tag}`]);
  for (const [index, id] of f.plan.entries()) {
    await manager.query(`INSERT INTO public.payment_plan_entries (id, loan_id, sequence, due_date, pending_amount)
      VALUES ($1, $2, $3, $4, 60)`, [id, f.loan, index + 1, index === 0 ? '2026-10-01' : '2026-11-01']);
  }
}

function baseline(f: Fixture, interest: string, second: string, balance: string): LoanEditBaseline {
  return { interestAmount: interest, paymentFrequencyId: f.frequency, preferredPaymentMethodId: f.method,
    observations: 'ORIGINAL', financialBalance: balance, plan: [
      { id: f.plan[0], dueDate: '2026-10-01', pendingAmount: '60.00' },
      { id: f.plan[1], dueDate: '2026-11-01', pendingAmount: second },
    ] };
}

function edit(f: Fixture, key: string, opening: LoanEditBaseline, interest: string, second: string): LoanEditInput {
  return { idempotencyKey: key, baseline: opening, changes: { interestAmount: interest },
    plan: [opening.plan[0], { ...opening.plan[1], pendingAmount: second }] };
}

async function state(source: DataSource, f: Fixture) {
  const [loan] = await source.query(`SELECT interest_amount::text AS interest, total_amount::text AS total,
    observations, updated_at AS updated, xmin::text AS version FROM public.loans WHERE id = $1`, [f.loan]);
  const plan = await source.query(`SELECT id, due_date::text AS due, pending_amount::text AS pending,
    xmin::text AS version FROM public.payment_plan_entries WHERE loan_id = $1 ORDER BY sequence`, [f.loan]);
  const [operations] = await source.query(`SELECT COUNT(*)::int AS count FROM public.loan_edit_operations WHERE loan_id = $1`, [f.loan]);
  return { loan, plan, receipts: operations.count as number };
}

async function release(runner: QueryRunner): Promise<void> {
  try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
  finally { if (!runner.isReleased) await runner.release(); }
}

async function proveLockTimeout(source: DataSource, id: string): Promise<void> {
  const holder = source.createQueryRunner();
  const waiter = source.createQueryRunner();
  let failure: unknown;
  let pending: Promise<{ code: string | undefined }> | undefined;
  try {
    await holder.connect(); await waiter.connect();
    await holder.startTransaction(); await waiter.startTransaction();
    await holder.query('SELECT id FROM public.loans WHERE id = $1 FOR UPDATE', [id]);
    await waiter.query(`SET LOCAL lock_timeout = '650ms'`);
    let finished = false;
    const started = Date.now();
    pending = waiter.query('SELECT id FROM public.loans WHERE id = $1 FOR UPDATE', [id])
      .then(() => ({ code: undefined }), (error: { driverError?: { code?: string }; code?: string }) =>
        ({ code: error.driverError?.code ?? error.code }))
      .finally(() => { finished = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(finished).toBe(false);
    expect((await pending).code).toBe('55P03');
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    expect(Date.now() - started).toBeLessThan(6000);
  } catch (error) { failure = error; }
  finally {
    if (pending) await pending;
    const outcomes = await Promise.allSettled([release(waiter), release(holder)]);
    const errors = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason as unknown);
    if (errors.length) failure = failure ? new AggregateError([failure, ...errors], 'Lock probe and release failed')
      : new AggregateError(errors, 'Lock probe release failed');
  }
  if (failure) throw failure;
}

function affected(raw: unknown): number {
  if (!Array.isArray(raw)) return -1;
  return Array.isArray(raw[0]) && typeof raw[1] === 'number' ? raw[1] : raw.length;
}

async function cleanup(source: DataSource, f: Fixture, committed: boolean): Promise<void> {
  const [marker] = await source.query(`SELECT COUNT(*)::int AS count FROM public.loans
    WHERE id = $1 AND loan_number = $2 AND idempotency_key = $3`,
  [f.loan, f.loanNumber, `b5-loan-${f.tag}`]);
  if (marker.count !== 1) {
    if (committed) throw new Error('B5 fixture ownership changed; cleanup refused.');
    return; // A failed setup transaction committed nothing; a confirmed marker also covers ambiguous commits.
  }
  await source.transaction(async (manager) => {
    const receipts: { id: string; key: string; actor: string }[] = await manager.query(`SELECT id,
      idempotency_key AS key, created_by_user_id AS actor FROM public.loan_edit_operations WHERE loan_id = $1`, [f.loan]);
    if (receipts.some((row) => row.actor !== f.actor || !f.keys.includes(row.key as typeof f.keys[number]))) {
      throw new Error('B5 found an unowned receipt; cleanup refused.');
    }
    for (const row of receipts) {
      if (affected(await manager.query(`DELETE FROM public.loan_edit_operations WHERE id = $1
        AND loan_id = $2 AND created_by_user_id = $3 AND idempotency_key = $4 RETURNING id`,
      [row.id, f.loan, f.actor, row.key])) !== 1) throw new Error('B5 receipt cleanup was incomplete.');
    }
    const plan: { id: string }[] = await manager.query(`SELECT id FROM public.payment_plan_entries WHERE loan_id = $1`, [f.loan]);
    for (const row of plan) {
      if (affected(await manager.query(`DELETE FROM public.payment_plan_entries
        WHERE id = $1 AND loan_id = $2 RETURNING id`, [row.id, f.loan])) !== 1) {
        throw new Error('B5 plan cleanup was incomplete.');
      }
    }
    const deletions: readonly [string, unknown[]][] = [
      [`DELETE FROM public.loans WHERE id = $1 AND loan_number = $2 AND idempotency_key = $3 RETURNING id`,
        [f.loan, f.loanNumber, `b5-loan-${f.tag}`]],
      [`DELETE FROM public.customers WHERE id = $1 AND identification = $2 RETURNING id`, [f.customer, `b5_${f.tag}`]],
      [`DELETE FROM public.payment_frequencies WHERE id = $1 AND name = $2 RETURNING id`, [f.frequency, `B5 frequency ${f.tag}`]],
      [`DELETE FROM public.payment_methods WHERE id = $1 AND name = $2 RETURNING id`, [f.method, `B5 method ${f.tag}`]],
      [`DELETE FROM public.users WHERE id = $1 AND username = $2 RETURNING id`, [f.actor, `b5_${f.tag}`]],
      [`DELETE FROM public.roles WHERE id = $1 AND code = $2 RETURNING id`, [f.role, `B5_${f.tag}`]],
    ];
    for (const [sql, args] of deletions) {
      if (affected(await manager.query(sql, args)) !== 1) throw new Error('B5 fixture cleanup was incomplete.');
    }
  });
  const [remaining] = await source.query(`SELECT
    (SELECT COUNT(*)::int FROM public.loans WHERE id = $1) AS loan,
    (SELECT COUNT(*)::int FROM public.payment_plan_entries WHERE loan_id = $1) AS plan,
    (SELECT COUNT(*)::int FROM public.loan_edit_operations WHERE loan_id = $1) AS receipts,
    (SELECT COUNT(*)::int FROM public.users WHERE id = $2) AS actor,
    (SELECT COUNT(*)::int FROM public.roles WHERE id = $3) AS role,
    (SELECT COUNT(*)::int FROM public.customers WHERE id = $4) AS customer,
    (SELECT COUNT(*)::int FROM public.payment_frequencies WHERE id = $5) AS frequency,
    (SELECT COUNT(*)::int FROM public.payment_methods WHERE id = $6) AS method,
    (SELECT COUNT(*)::int FROM public.loans) AS loans,
    (SELECT COUNT(*)::int FROM public.payments) AS payments`,
  [f.loan, f.actor, f.role, f.customer, f.frequency, f.method]);
  if (Object.entries(remaining).some(([name, count]) => count !== (name === 'loans' ? 14 : name === 'payments' ? 17 : 0))) {
    throw new Error('B5 cleanup or original loan/payment counts are incomplete.');
  }
}

suite('B5 unpublished loan editor on approved local PostgreSQL', () => {
  it('persists interest and plan, replays one receipt, rolls back after claim, and serializes concurrent edits', async () => {
    const f = fixtureIds();
    let source: DataSource | undefined;
    let started = false;
    let committed = false;
    let failure: unknown;
    try {
      source = guardedSource();
      try { await source.initialize(); }
      catch { throw new Error('B5 PostgreSQL connection failed; check the approved target privately.'); }
      await preflight(source);
      started = true;
      await source.transaction((manager) => insertFixture(manager, f));
      committed = true;
      const writer = new EditLoanTypeormWriter(source);
      const totals = new LoanFinancialTotalsTypeormReader();
      const editor = new EditLoanUseCase(writer, totals);
      const opening = baseline(f, '20.00', '60.00', '120.00');
      const first = edit(f, f.keys[0], opening, '30.00', '70.00');
      const command = (body: LoanEditInput) => normalizeLoanEditCommand(body, f.loan, f.actor);
      const receipt = await editor.execute(command(first));
      expect(receipt).toMatchObject({ loanId: f.loan, operationId: expect.any(String), createdAt: expect.any(Date) });
      const persisted = await state(source, f);
      expect(persisted.loan).toMatchObject({ interest: '30.00', total: '130.00', observations: 'ORIGINAL' });
      expect(persisted.plan.map((row: { pending: string }) => row.pending)).toEqual(['60.00', '70.00']);
      expect(persisted.receipts).toBe(1);
      expect(await editor.execute(command(first))).toEqual(receipt);
      expect(await state(source, f)).toEqual(persisted);
      await expect(editor.execute(command(edit(f, f.keys[0], opening, '31.00', '71.00'))))
        .rejects.toBeInstanceOf(LoanEditIdempotencyConflictError);
      expect(await state(source, f)).toEqual(persisted);

      const next = baseline(f, '30.00', '70.00', '130.00');
      const rolledBack = edit(f, f.keys[1], next, '40.00', '80.00');
      const injected = new Error('B5 controlled post-claim failure');
      let claimed = false;
      const failingWriter: LoanEditWriter = { transaction: (run) => writer.transaction((tx) => run({ ...tx,
        claim: async (identity) => {
          const inside = await tx.claim(identity);
          const [visible] = await tx.executor.query(`SELECT COUNT(*)::int AS count FROM public.loan_edit_operations
            WHERE loan_id = $1 AND idempotency_key = $2`, [f.loan, f.keys[1]]) as unknown as { count: number }[];
          const [updated] = await tx.executor.query(`SELECT interest_amount::text AS interest FROM public.loans
            WHERE id = $1`, [f.loan]) as unknown as { interest: string }[];
          const [plan] = await tx.executor.query(`SELECT SUM(pending_amount)::text AS pending
            FROM public.payment_plan_entries WHERE loan_id = $1`, [f.loan]) as unknown as { pending: string }[];
          expect(inside?.operationId).toBeDefined();
          expect(visible.count).toBe(1);
          expect(updated.interest).toBe('40.00');
          expect(plan.pending).toBe('140.00');
          claimed = true;
          throw injected;
        },
      })) };
      await expect(new EditLoanUseCase(failingWriter, totals).execute(command(rolledBack))).rejects.toBe(injected);
      expect(claimed).toBe(true);
      expect(await state(source, f)).toEqual(persisted);

      await proveLockTimeout(source, f.loan);

      let entered = 0;
      let updates = 0;
      let planUpdates = 0;
      let claims = 0;
      let open!: () => void;
      let rejectGate!: (error: Error) => void;
      const gate = new Promise<void>((resolve, reject) => { open = resolve; rejectGate = reject; });
      void gate.catch(() => undefined); // The timeout is also safe if neither connection reaches the gate.
      const timer = setTimeout(() => rejectGate(new Error('B5 concurrent start timed out')), 2500);
      const countingWriter: LoanEditWriter = { transaction: (run) => writer.transaction((tx) => run({ ...tx,
        lockLoan: async (id) => { if (++entered === 2) { clearTimeout(timer); open(); } await gate; return tx.lockLoan(id); },
        updateLoan: async (id, changes) => { updates++; return tx.updateLoan(id, changes); },
        claim: async (identity) => { claims++; return tx.claim(identity); },
        executor: { query: async (sql, args) => {
          if (sql.startsWith('UPDATE payment_plan_entries SET')) planUpdates++;
          return tx.executor.query(sql, args);
        } },
      })) };
      try {
        const concurrent = new EditLoanUseCase(countingWriter, totals);
        const body = command(edit(f, f.keys[2], next, '40.00', '80.00'));
        const results = await Promise.allSettled([concurrent.execute(body), concurrent.execute(body)]);
        for (const result of results) if (result.status === 'rejected') throw result.reason;
        expect(results[0]).toMatchObject({ status: 'fulfilled' });
        expect(results[1]).toMatchObject({ status: 'fulfilled' });
        if (results[0].status !== 'fulfilled' || results[1].status !== 'fulfilled') throw new Error('Concurrent edit failed.');
        expect(results[1].value).toEqual(results[0].value);
        expect(results[0].value.operationId).not.toBe(receipt.operationId);
        // Both contenders lock once; the winner locks again to verify its persisted update.
        expect(entered).toBe(3);
        expect({ updates, planUpdates, claims }).toEqual({ updates: 1, planUpdates: 2, claims: 1 });
        const final = await state(source, f);
        expect(final.loan).toMatchObject({ interest: '40.00', total: '140.00' });
        expect(final.plan.map((row: { pending: string }) => row.pending)).toEqual(['60.00', '80.00']);
        expect(final.receipts).toBe(2);
        expect(await editor.execute(body)).toEqual(results[0].value);
        expect(await state(source, f)).toEqual(final);
      } finally { clearTimeout(timer); }
    } catch (error) { failure = error; }
    finally {
      if (source) {
        try { if (started && source.isInitialized) await cleanup(source, f, committed); }
        catch (error) { failure = failure ? new AggregateError([failure, error], 'B5 test and cleanup failed') : error; }
        try { if (source.isInitialized) await source.destroy(); }
        catch { const error = new Error('B5 connection release failed');
          failure = failure ? new AggregateError([failure, error], 'B5 test and connection release failed') : error; }
      }
    }
    if (failure) throw failure;
  }, 45000);
});
