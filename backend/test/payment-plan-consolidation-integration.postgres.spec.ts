import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { RegisterPaymentUseCase, TransactionalPaymentRegistrar } from
  '../src/application/payment/payment.use-case';
import type { PaymentPlanConsolidationWriter } from
  '../src/application/payment/payment-plan-consolidation.writer';
import { LoanFinancialTotalsTypeormReader } from
  '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { PaymentPlanConsolidationTypeormWriter } from
  '../src/infrastructure/database/typeorm/repositories/payment-plan-consolidation.writer';

const suite = process.env.RUN_PAYMENT_PLAN_CONSOLIDATION_B2_POSTGRES === '1' ? describe : describe.skip;
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
    throw new Error('A disposable PostgreSQL cluster is required for payment plan consolidation integration tests.');
  }
  return new DataSource({
    type: 'postgres', host: '127.0.0.1', port: expectedPort, database: expectedDatabase,
    username: 'postgres', password: 'integration-only', synchronize: false,
    extra: { max: 8, connectionTimeoutMillis: 5000,
      options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=10000' },
  });
}

type PlanSeed = Readonly<{
  loanId: string;
  entries: ReadonlyArray<{ id: string; sequence: number; dueDate: string; pendingAmount: string }>;
}>;

suite('transactional payment plan consolidation on disposable PostgreSQL', () => {
  jest.setTimeout(120000);
  let db: DataSource;
  let actorId: string;
  let collectorId: string;
  let methodId: string;
  let frequencyId: string;
  let routeId: string;
  const totals = new LoanFinancialTotalsTypeormReader();
  const writer = new PaymentPlanConsolidationTypeormWriter();

  const useCase = (enabled: boolean, persistence: PaymentPlanConsolidationWriter = writer) =>
    new RegisterPaymentUseCase(db, totals, undefined,
      new TransactionalPaymentRegistrar(totals, undefined, persistence, enabled));

  async function seedLoan(entries: ReadonlyArray<{ sequence: number; dueDate: string; pendingAmount: string }>): Promise<PlanSeed> {
    const customerId = randomUUID();
    const loanId = randomUUID();
    await db.query(`INSERT INTO customers (id,identification_type,identification,first_name,first_last_name,
      gender,birth_date,primary_phone,nationality,identification_front_file_key)
      VALUES ($1,'NATIONAL',$2,'B2','Synthetic','MALE','2000-01-01','00000000','COSTA_RICAN','test/b2')`,
    [customerId, `B2-${randomUUID()}`]);
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
    return { loanId, entries: persisted };
  }

  const case4764 = () => seedLoan([
    { sequence: 6, dueDate: '2026-10-08', pendingAmount: '50000.00' },
    { sequence: 7, dueDate: '2026-10-09', pendingAmount: '50000.00' },
    { sequence: 8, dueDate: '2026-10-10', pendingAmount: '50000.00' },
    { sequence: 9, dueDate: '2026-10-12', pendingAmount: '50000.00' },
    { sequence: 10, dueDate: '2026-10-13', pendingAmount: '50000.00' },
    { sequence: 11, dueDate: '2026-10-14', pendingAmount: '1150000.00' },
  ]);

  const input = (loanId: string, key = randomUUID()) => ({ loanId, amount: '50000.00', paymentDate,
    methodId, collectorId, idempotencyKey: key });

  beforeAll(async () => {
    db = guardedSource();
    await db.initialize();
    const [identity] = await db.query(`SELECT host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_database() AS database, current_setting('data_directory') AS directory,
      shobj_description(database.oid, 'pg_database') AS comment
      FROM pg_database database WHERE database.datname = current_database()`);
    if (identity.host !== '127.0.0.1' || identity.port !== expectedPort || identity.database !== expectedDatabase
      || identity.directory.replace(/\\/g, '/').toLowerCase() !== expectedDirectory.replace(/\\/g, '/').toLowerCase()
      || identity.comment !== marker) throw new Error(`Disposable PostgreSQL identity mismatch: ${JSON.stringify(identity)}`);
    const [migration] = await db.query(`SELECT name FROM migrations WHERE name = 'CreatePaymentPlanConsolidations1762800000000'`);
    if (!migration) throw new Error('The validated B.1 migration is required for B.2 integration tests.');

    const existingRole = await db.query(`SELECT id FROM roles WHERE code = 'COLLECTOR'`);
    const roleId = existingRole[0]?.id ?? randomUUID();
    if (!existingRole[0]) await db.query(`INSERT INTO roles (id,code,name) VALUES ($1,'COLLECTOR','Collector')`, [roleId]);
    actorId = randomUUID(); collectorId = randomUUID(); methodId = randomUUID(); frequencyId = randomUUID(); routeId = randomUUID();
    await db.query(`INSERT INTO users (id,username,full_name,password_hash,role_id)
      VALUES ($1,$2,'B2 Synthetic Collector','!disabled!',$3)`, [actorId, `b2_${actorId}`, roleId]);
    await db.query(`INSERT INTO collectors (id,identification,first_name,first_last_name,phone,birth_date,address,user_id)
      VALUES ($1,$2,'B2','Collector','00000000','2000-01-01','Test',$3)`,
    [collectorId, `B2-${collectorId}`, actorId]);
    await db.query(`INSERT INTO payment_methods (id,name,display_order) VALUES ($1,$2,950)`, [methodId, `B2 method ${methodId}`]);
    await db.query(`INSERT INTO payment_frequencies (id,name,interval_unit,interval_value,display_order)
      VALUES ($1,$2,'DAY',1,950)`, [frequencyId, `B2 daily ${frequencyId}`]);
    await db.query(`INSERT INTO routes (id,name) VALUES ($1,$2)`, [routeId, `B2 route ${routeId}`]);
    await db.query(`INSERT INTO collector_route_assignments (collector_user_id,route_id,assigned_by_user_id)
      VALUES ($1,$2,$1)`, [actorId, routeId]);
    const [opening] = await db.query(`SELECT opening_date::text AS "openingDate" FROM financial_openings
      WHERE singleton_key = 'DEFAULT'`);
    if (!opening) await db.query(`INSERT INTO financial_openings (opening_date,initial_available_amount,initial_portfolio,
      initial_uncollectible_amount,historical_seed_capital,opened_by_user_id)
      VALUES ('2026-10-01',0,0,0,0,$1)`, [actorId]);
    else if (opening.openingDate > paymentDate) throw new Error('The disposable financial opening is after the B.2 payment date.');
  });

  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

  it('models #4764 by moving 150000 to installment 10 while preserving one payment and one cash inflow', async () => {
    const seed = await case4764();
    const payment = await useCase(true).execute(input(seed.loanId), actorId);
    const plan = await db.query(`SELECT sequence, pending_amount::text AS "pendingAmount"
      FROM payment_plan_entries WHERE loan_id = $1 ORDER BY sequence`, [seed.loanId]);
    expect(plan).toEqual([
      { sequence: 6, pendingAmount: '0.00' }, { sequence: 7, pendingAmount: '0.00' },
      { sequence: 8, pendingAmount: '0.00' }, { sequence: 9, pendingAmount: '0.00' },
      { sequence: 10, pendingAmount: '200000.00' }, { sequence: 11, pendingAmount: '1150000.00' },
    ]);
    const [facts] = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM payments WHERE loan_id=$1) AS payments,
      (SELECT COUNT(*)::int FROM cash_movements WHERE payment_id=$2) AS cash,
      (SELECT COUNT(*)::int FROM payment_plan_consolidations WHERE payment_id=$2) AS consolidations,
      (SELECT COUNT(*)::int FROM payment_plan_consolidation_sources sources
        JOIN payment_plan_consolidations header ON header.id=sources.consolidation_id WHERE header.payment_id=$2) AS sources,
      (SELECT SUM(pending_amount)::text FROM payment_plan_entries WHERE loan_id=$1) AS balance`,
    [seed.loanId, payment.id]);
    expect(facts).toEqual({ payments: 1, cash: 1, consolidations: 1, sources: 3, balance: '1350000.00' });
  });

  it('rolls back payment, cash, event, sources and plan mutations when consolidation persistence fails', async () => {
    const seed = await case4764();
    const failing: PaymentPlanConsolidationWriter = {
      write: async (executor, command) => {
        await writer.write(executor, command);
        throw new Error('Injected consolidation persistence failure');
      },
      lockForReversal: (...args) => writer.lockForReversal(...args),
      reverse: (...args) => writer.reverse(...args),
    };
    await expect(useCase(true, failing).execute(input(seed.loanId), actorId))
      .rejects.toThrow('Injected consolidation persistence failure');
    const [facts] = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM payments WHERE loan_id=$1) AS payments,
      (SELECT COUNT(*)::int FROM cash_movements cash JOIN payments payment ON payment.id=cash.payment_id
        WHERE payment.loan_id=$1) AS cash,
      (SELECT COUNT(*)::int FROM payment_plan_consolidations WHERE loan_id=$1) AS consolidations,
      (SELECT SUM(pending_amount)::text FROM payment_plan_entries WHERE loan_id=$1) AS balance`, [seed.loanId]);
    expect(facts).toEqual({ payments: 0, cash: 0, consolidations: 0, balance: '1400000.00' });
  });

  it('replays an idempotent registration without a second payment, cash movement or consolidation', async () => {
    const seed = await case4764();
    const request = input(seed.loanId);
    const first = await useCase(true).execute(request, actorId);
    const replay = await useCase(true).execute(request, actorId);
    expect(replay.id).toBe(first.id);
    const [facts] = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM payments WHERE loan_id=$1) AS payments,
      (SELECT COUNT(*)::int FROM cash_movements cash JOIN payments payment ON payment.id=cash.payment_id
        WHERE payment.loan_id=$1) AS cash,
      (SELECT COUNT(*)::int FROM payment_plan_consolidations WHERE loan_id=$1) AS consolidations`, [seed.loanId]);
    expect(facts).toEqual({ payments: 1, cash: 1, consolidations: 1 });
  });

  it('does not create a consolidation when no later payable installment exists', async () => {
    const seed = await seedLoan([{ sequence: 1, dueDate: paymentDate, pendingAmount: '100000.00' }]);
    await useCase(true).execute(input(seed.loanId), actorId);
    const [facts] = await db.query(`SELECT
      (SELECT pending_amount::text FROM payment_plan_entries WHERE loan_id=$1) AS pending,
      (SELECT COUNT(*)::int FROM payment_plan_consolidations WHERE loan_id=$1) AS consolidations`, [seed.loanId]);
    expect(facts).toEqual({ pending: '50000.00', consolidations: 0 });
  });

  it('keeps the previous payment behavior intact when consolidation is disabled', async () => {
    const seed = await case4764();
    await useCase(false).execute(input(seed.loanId), actorId);
    const plan: Array<{ sequence: number; pendingAmount: string }> = await db.query(`SELECT sequence, pending_amount::text AS "pendingAmount"
      FROM payment_plan_entries WHERE loan_id = $1 ORDER BY sequence`, [seed.loanId]);
    expect(plan.map((entry) => entry.pendingAmount)).toEqual([
      '0.00', '50000.00', '50000.00', '50000.00', '50000.00', '1150000.00',
    ]);
    const [facts] = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM payments WHERE loan_id=$1) AS payments,
      (SELECT COUNT(*)::int FROM cash_movements cash JOIN payments payment ON payment.id=cash.payment_id
        WHERE payment.loan_id=$1) AS cash,
      (SELECT COUNT(*)::int FROM payment_plan_consolidations WHERE loan_id=$1) AS consolidations`, [seed.loanId]);
    expect(facts).toEqual({ payments: 1, cash: 1, consolidations: 0 });
  });
});
