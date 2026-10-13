import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { RegisterPaymentUseCase, TransactionalPaymentRegistrar } from
  '../src/application/payment/payment.use-case';
import type { PaymentPlanConsolidationWriter } from
  '../src/application/payment/payment-plan-consolidation.writer';
import { ClosedFinancialPeriodError } from '../src/domain/financial-close/financial-close.errors';
import { LoanFinancialTotalsTypeormReader } from
  '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { PaymentPlanConsolidationTypeormWriter } from
  '../src/infrastructure/database/typeorm/repositories/payment-plan-consolidation.writer';

const suite = process.env.RUN_PAYMENT_PLAN_CONSOLIDATION_B3_POSTGRES === '1' ? describe : describe.skip;
const expectedDatabase = process.env.TEST_PAYMENT_PLAN_CONSOLIDATION_PG_DATABASE ?? '';
const expectedDirectory = process.env.TEST_PAYMENT_PLAN_CONSOLIDATION_PG_DIRECTORY ?? '';
const expectedPort = Number(process.env.TEST_PAYMENT_PLAN_CONSOLIDATION_PG_PORT);
const marker = 'payment-plan-consolidation:disposable';
const paymentDate = '2026-10-12';

function guardedSource() {
  if (process.env.TEST_PAYMENT_PLAN_CONSOLIDATION_PG_HOST !== '127.0.0.1'
    || !Number.isSafeInteger(expectedPort) || expectedPort < 1024
    || !/^prestamos_plan_consolidation_test_[a-f0-9]{12}$/.test(expectedDatabase)
    || !/[/\\]Temp[/\\]opencode[/\\]plan-consolidation-pg-[a-f0-9]{12}$/i.test(expectedDirectory)) {
    throw new Error('A disposable PostgreSQL cluster is required for payment plan consolidation reversal tests.');
  }
  return new DataSource({
    type: 'postgres', host: '127.0.0.1', port: expectedPort, database: expectedDatabase,
    username: 'postgres', password: 'integration-only', synchronize: false,
    extra: { max: 12, connectionTimeoutMillis: 5000,
      options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=10000' },
  });
}

type Seed = Readonly<{ loanId: string; customerId: string;
  entries: ReadonlyArray<{ id: string; sequence: number; dueDate: string; pendingAmount: string }> }>;

suite('transactional payment plan consolidation reversal on disposable PostgreSQL', () => {
  jest.setTimeout(120000);
  let db: DataSource;
  let actorId: string;
  let collectorId: string;
  let methodId: string;
  let frequencyId: string;
  let routeId: string;
  const totals = new LoanFinancialTotalsTypeormReader();
  const writer = new PaymentPlanConsolidationTypeormWriter();

  const registrar = (persistence: PaymentPlanConsolidationWriter = writer) =>
    new TransactionalPaymentRegistrar(totals, undefined, persistence, true);
  const payments = (persistence: PaymentPlanConsolidationWriter = writer) =>
    new RegisterPaymentUseCase(db, totals, undefined, registrar(persistence), persistence);
  const annuller = (guard?: { assertDateAllowed(date: string, context?: unknown): Promise<void> },
    persistence: PaymentPlanConsolidationWriter = writer) =>
    new RegisterPaymentUseCase(db, totals, guard as never, undefined, persistence);

  async function seedLoan(entries: ReadonlyArray<{ sequence: number; dueDate: string; pendingAmount: string }>): Promise<Seed> {
    const customerId = randomUUID(); const loanId = randomUUID();
    await db.query(`INSERT INTO customers (id,identification_type,identification,first_name,first_last_name,
      gender,birth_date,primary_phone,nationality,identification_front_file_key)
      VALUES ($1,'NATIONAL',$2,'B3','Synthetic','MALE','2000-01-01','00000000','COSTA_RICAN','test/b3')`,
    [customerId, `B3-${randomUUID()}`]);
    await db.query(`INSERT INTO customer_route_assignments (customer_id,route_id,assigned_by_user_id)
      VALUES ($1,$2,$3)`, [customerId, routeId, actorId]);
    const total = entries.reduce((sum, entry) => sum + Number(entry.pendingAmount), 0).toFixed(2);
    await db.query(`INSERT INTO loans (id,customer_id,payment_frequency_id,preferred_payment_method_id,start_date,
      principal,interest_amount,total_amount,status,created_by_user_id)
      VALUES ($1,$2,$3,$4,'2026-10-01',$5::numeric(18,2),0,$5::numeric(18,2),'ACTIVE',$6)`,
    [loanId, customerId, frequencyId, methodId, total, actorId]);
    const persisted = [];
    for (const entry of entries) {
      const id = randomUUID();
      await db.query(`INSERT INTO payment_plan_entries (id,loan_id,sequence,due_date,pending_amount)
        VALUES ($1,$2,$3,$4,$5::numeric(18,2))`, [id, loanId, entry.sequence, entry.dueDate, entry.pendingAmount]);
      persisted.push({ id, ...entry });
    }
    return { loanId, customerId, entries: persisted };
  }

  const case4764 = () => seedLoan([
    { sequence: 6, dueDate: '2026-10-08', pendingAmount: '50000.00' },
    { sequence: 7, dueDate: '2026-10-09', pendingAmount: '50000.00' },
    { sequence: 8, dueDate: '2026-10-10', pendingAmount: '50000.00' },
    { sequence: 9, dueDate: '2026-10-12', pendingAmount: '50000.00' },
    { sequence: 10, dueDate: '2026-10-13', pendingAmount: '50000.00' },
    { sequence: 11, dueDate: '2026-10-14', pendingAmount: '1150000.00' },
  ]);
  const input = (loanId: string, amount = '50000.00', date = paymentDate, key = randomUUID()) =>
    ({ loanId, amount, paymentDate: date, methodId, collectorId, idempotencyKey: key });
  const annul = (paymentId: string, key = randomUUID(), useCase = annuller()) =>
    useCase.annul(paymentId, 'Synthetic B3 reversal', key, actorId, 'CASH_REFUND');
  const plan = (loanId: string) => db.query(`SELECT sequence, pending_amount::text AS "pendingAmount"
    FROM payment_plan_entries WHERE loan_id=$1 ORDER BY sequence`, [loanId]) as Promise<Array<{
    sequence: number; pendingAmount: string;
  }>>;

  beforeAll(async () => {
    db = guardedSource(); await db.initialize();
    const [identity] = await db.query(`SELECT host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_database() AS database, current_setting('data_directory') AS directory,
      shobj_description(database.oid, 'pg_database') AS comment
      FROM pg_database database WHERE database.datname = current_database()`);
    if (identity.host !== '127.0.0.1' || identity.port !== expectedPort || identity.database !== expectedDatabase
      || identity.directory.replace(/\\/g, '/').toLowerCase() !== expectedDirectory.replace(/\\/g, '/').toLowerCase()
      || identity.comment !== marker) throw new Error(`Disposable PostgreSQL identity mismatch: ${JSON.stringify(identity)}`);
    const [migration] = await db.query(`SELECT name FROM migrations WHERE name = 'CreatePaymentPlanConsolidations1762800000000'`);
    if (!migration) throw new Error('The validated B.1 migration is required for B.3 reversal tests.');

    const existingRole = await db.query(`SELECT id FROM roles WHERE code = 'COLLECTOR'`);
    const roleId = existingRole[0]?.id ?? randomUUID();
    if (!existingRole[0]) await db.query(`INSERT INTO roles (id,code,name) VALUES ($1,'COLLECTOR','Collector')`, [roleId]);
    actorId = randomUUID(); collectorId = randomUUID(); methodId = randomUUID(); frequencyId = randomUUID(); routeId = randomUUID();
    await db.query(`INSERT INTO users (id,username,full_name,password_hash,role_id)
      VALUES ($1,$2,'B3 Synthetic Collector','!disabled!',$3)`, [actorId, `b3_${actorId}`, roleId]);
    await db.query(`INSERT INTO collectors (id,identification,first_name,first_last_name,phone,birth_date,address,user_id)
      VALUES ($1,$2,'B3','Collector','00000000','2000-01-01','Test',$3)`,
    [collectorId, `B3-${collectorId}`, actorId]);
    await db.query(`INSERT INTO payment_methods (id,name,display_order) VALUES ($1,$2,960)`, [methodId, `B3 method ${methodId}`]);
    await db.query(`INSERT INTO payment_frequencies (id,name,interval_unit,interval_value,display_order)
      VALUES ($1,$2,'DAY',1,960)`, [frequencyId, `B3 daily ${frequencyId}`]);
    await db.query(`INSERT INTO routes (id,name) VALUES ($1,$2)`, [routeId, `B3 route ${routeId}`]);
    await db.query(`INSERT INTO collector_route_assignments (collector_user_id,route_id,assigned_by_user_id)
      VALUES ($1,$2,$1)`, [actorId, routeId]);
    const [opening] = await db.query(`SELECT opening_date::text AS "openingDate" FROM financial_openings
      WHERE singleton_key = 'DEFAULT'`);
    if (!opening) await db.query(`INSERT INTO financial_openings (opening_date,initial_available_amount,initial_portfolio,
      initial_uncollectible_amount,historical_seed_capital,opened_by_user_id)
      VALUES ('2026-10-01',0,0,0,0,$1)`, [actorId]);
    else if (opening.openingDate > paymentDate) throw new Error('The disposable financial opening is after the B.3 payment date.');
  });

  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

  it('reverses the synthetic #4764 consolidation exactly with one monetary and one operational reversal', async () => {
    const seed = await case4764();
    const payment = await payments().execute(input(seed.loanId), actorId);
    await annul(payment.id);
    expect((await plan(seed.loanId)).map((entry) => entry.pendingAmount)).toEqual([
      '50000.00', '50000.00', '50000.00', '50000.00', '50000.00', '1150000.00',
    ]);
    const [facts] = await db.query(`SELECT
      (SELECT SUM(pending_amount)::text FROM payment_plan_entries WHERE loan_id=$1) AS balance,
      (SELECT COUNT(*)::int FROM payments WHERE loan_id=$1) AS payments,
      (SELECT COUNT(*)::int FROM cash_movements cash JOIN payments payment ON payment.id=cash.reversed_movement_id
        WHERE payment.loan_id=$1) AS unused,
      (SELECT COUNT(*)::int FROM cash_movements reversal JOIN cash_movements original
        ON original.id=reversal.reversed_movement_id JOIN payments payment ON payment.id=original.payment_id
        WHERE payment.loan_id=$1) AS "cashReversals",
      (SELECT COUNT(*)::int FROM payment_plan_consolidation_reversals reversal
        JOIN payment_plan_consolidations header ON header.id=reversal.consolidation_id WHERE header.loan_id=$1) AS reversals`,
    [seed.loanId]);
    expect(facts).toEqual({ balance: '1400000.00', payments: 1, unused: 0, cashReversals: 1, reversals: 1 });
  });

  it('keeps the previous annulment behavior for a payment without consolidation', async () => {
    const seed = await seedLoan([{ sequence: 1, dueDate: paymentDate, pendingAmount: '100000.00' }]);
    const payment = await payments().execute(input(seed.loanId), actorId);
    await annul(payment.id);
    expect(await plan(seed.loanId)).toEqual([{ sequence: 1, pendingAmount: '100000.00' }]);
    const [facts] = await db.query(`SELECT COUNT(*)::int AS reversals FROM payment_plan_consolidation_reversals reversal
      JOIN payment_plan_consolidations header ON header.id=reversal.consolidation_id WHERE header.loan_id=$1`, [seed.loanId]);
    expect(facts.reversals).toBe(0);
  });

  it('replays the same annulment without duplicating monetary or operational reversals', async () => {
    const seed = await case4764(); const payment = await payments().execute(input(seed.loanId), actorId); const key = randomUUID();
    const first = await annul(payment.id, key); const replay = await annul(payment.id, key);
    expect(replay).toEqual(first);
    const [facts] = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM payment_annulments WHERE payment_id=$1) AS annulments,
      (SELECT COUNT(*)::int FROM cash_movements WHERE reversed_movement_id=(
        SELECT id FROM cash_movements WHERE payment_id=$1 AND concept='CUSTOMER_PAYMENT')) AS cash,
      (SELECT COUNT(*)::int FROM payment_plan_consolidation_reversals reversal
        JOIN payment_plan_consolidations header ON header.id=reversal.consolidation_id WHERE header.payment_id=$1) AS reversals`,
    [payment.id]);
    expect(facts).toEqual({ annulments: 1, cash: 1, reversals: 1 });
  });

  it('rejects an earlier consolidated payment and dismantles multiple consolidations in LIFO order', async () => {
    const seed = await seedLoan([
      { sequence: 6, dueDate: '2026-10-08', pendingAmount: '50000.00' },
      { sequence: 7, dueDate: '2026-10-09', pendingAmount: '50000.00' },
      { sequence: 8, dueDate: '2026-10-10', pendingAmount: '50000.00' },
      { sequence: 9, dueDate: '2026-10-11', pendingAmount: '50000.00' },
      { sequence: 10, dueDate: '2026-10-12', pendingAmount: '50000.00' },
      { sequence: 11, dueDate: '2026-10-14', pendingAmount: '50000.00' },
      { sequence: 12, dueDate: '2026-10-15', pendingAmount: '1100000.00' },
    ]);
    const first = await payments().execute(input(seed.loanId, '50000.00', '2026-10-10'), actorId);
    const second = await payments().execute(input(seed.loanId, '50000.00', '2026-10-13'), actorId);
    await expect(annul(first.id)).rejects.toMatchObject({ reasonCode: 'PAYMENT_NOT_LATEST' });
    await annul(second.id); await annul(first.id);
    expect((await plan(seed.loanId)).map((entry) => entry.pendingAmount)).toEqual([
      '50000.00', '50000.00', '50000.00', '50000.00', '50000.00', '50000.00', '1100000.00',
    ]);
    const [facts] = await db.query(`SELECT COUNT(*)::int AS reversals FROM payment_plan_consolidation_reversals reversal
      JOIN payment_plan_consolidations header ON header.id=reversal.consolidation_id WHERE header.loan_id=$1`, [seed.loanId]);
    expect(facts.reversals).toBe(2);
  });

  it('rejects a changed consolidation target without any annulment writes', async () => {
    const seed = await case4764(); const payment = await payments().execute(input(seed.loanId), actorId);
    await db.query(`UPDATE payment_plan_entries SET pending_amount=pending_amount+1 WHERE loan_id=$1 AND sequence=10`, [seed.loanId]);
    await expect(annul(payment.id)).rejects.toThrow();
    const [facts] = await db.query(`SELECT
      (SELECT status FROM payments WHERE id=$1) AS status,
      (SELECT COUNT(*)::int FROM payment_annulments WHERE payment_id=$1) AS annulments,
      (SELECT COUNT(*)::int FROM payment_plan_consolidation_reversals reversal
        JOIN payment_plan_consolidations header ON header.id=reversal.consolidation_id WHERE header.payment_id=$1) AS reversals`,
    [payment.id]);
    expect(facts).toEqual({ status: 'VALID', annulments: 0, reversals: 0 });
  });

  it('blocks a consolidated payment that belongs to a confirmed refinancing origin', async () => {
    const seed = await case4764(); const payment = await payments().execute(input(seed.loanId), actorId);
    const successor = randomUUID();
    await db.query(`INSERT INTO loans (id,customer_id,payment_frequency_id,preferred_payment_method_id,start_date,
      principal,interest_amount,total_amount,status,created_by_user_id)
      VALUES ($1,$2,$3,$4,'2026-10-13',1350000,0,1350000,'ACTIVE',$5)`,
    [successor, seed.customerId, frequencyId, methodId, actorId]);
    await db.query(`INSERT INTO loan_refinancings (origin_loan_id,new_loan_id,outstanding_principal_transferred,
      capitalized_outstanding_interest,new_money_disbursed,new_interest_amount,new_contractual_principal,
      new_contractual_total,refinancing_date,created_by_user_id,idempotency_key,idempotency_fingerprint)
      VALUES ($1,$2,1350000,0,0,0,1350000,1350000,'2026-10-13',$3,$4,$5)`,
    [seed.loanId, successor, actorId, randomUUID(), randomUUID()]);
    await db.query(`UPDATE loans SET status='REFINANCED' WHERE id=$1`, [seed.loanId]);
    await expect(annul(payment.id)).rejects.toMatchObject({ reasonCode: 'REFINANCED_LOAN_PAYMENT' });
  });

  it('blocks historical plan reversal when its payment date belongs to a closed period', async () => {
    const seed = await case4764(); const payment = await payments().execute(input(seed.loanId), actorId);
    const dates: string[] = [];
    const guard = { assertDateAllowed: async (date: string) => {
      dates.push(date); if (date === paymentDate) throw new ClosedFinancialPeriodError('Synthetic historical period is closed.');
    } };
    await expect(annul(payment.id, randomUUID(), annuller(guard))).rejects.toMatchObject({ reasonCode: 'CLOSED_FINANCIAL_PERIOD' });
    expect(dates).toContain(paymentDate);
    const [facts] = await db.query(`SELECT status,
      (SELECT COUNT(*)::int FROM payment_annulments WHERE payment_id=$1) AS annulments FROM payments WHERE id=$1`, [payment.id]);
    expect(facts).toEqual({ status: 'VALID', annulments: 0 });
  });

  it('allows only one concurrent annulment and leaves one complete reversal', async () => {
    const seed = await case4764(); const payment = await payments().execute(input(seed.loanId), actorId);
    const results = await Promise.allSettled([annul(payment.id), annul(payment.id)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const [facts] = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM payment_annulments WHERE payment_id=$1) AS annulments,
      (SELECT COUNT(*)::int FROM payment_plan_consolidation_reversals reversal
        JOIN payment_plan_consolidations header ON header.id=reversal.consolidation_id WHERE header.payment_id=$1) AS reversals,
      (SELECT COUNT(*)::int FROM cash_movements WHERE reversed_movement_id=(
        SELECT id FROM cash_movements WHERE payment_id=$1 AND concept='CUSTOMER_PAYMENT')) AS cash`, [payment.id]);
    expect(facts).toEqual({ annulments: 1, reversals: 1, cash: 1 });
  });

  it('rolls back the whole annulment when reversal persistence fails after plan mutations', async () => {
    const seed = await case4764(); const payment = await payments().execute(input(seed.loanId), actorId);
    const before = await plan(seed.loanId);
    const failing: PaymentPlanConsolidationWriter = {
      write: (...args) => writer.write(...args),
      lockForReversal: (...args) => writer.lockForReversal(...args),
      reverse: async (...args) => { await writer.reverse(...args); throw new Error('Injected B3 reversal failure'); },
    };
    await expect(annul(payment.id, randomUUID(), annuller(undefined, failing)))
      .rejects.toThrow('Injected B3 reversal failure');
    expect(await plan(seed.loanId)).toEqual(before);
    const [facts] = await db.query(`SELECT status,
      (SELECT COUNT(*)::int FROM payment_annulments WHERE payment_id=$1) AS annulments,
      (SELECT COUNT(*)::int FROM payment_plan_consolidation_reversals reversal
        JOIN payment_plan_consolidations header ON header.id=reversal.consolidation_id WHERE header.payment_id=$1) AS reversals,
      (SELECT COUNT(*)::int FROM cash_movements WHERE reversed_movement_id=(
        SELECT id FROM cash_movements WHERE payment_id=$1 AND concept='CUSTOMER_PAYMENT')) AS cash FROM payments WHERE id=$1`,
    [payment.id]);
    expect(facts).toEqual({ status: 'VALID', annulments: 0, reversals: 0, cash: 0 });
  });
});
