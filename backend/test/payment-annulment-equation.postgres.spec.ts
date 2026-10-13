import { createHash, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { RegisterPaymentUseCase } from '../src/application/payment/payment.use-case';
import { PreserveAnnulledPaymentAllocation1762900000000 } from
  '../src/infrastructure/database/typeorm/migrations/1762900000000-preserve-annulled-payment-allocation';
import { LoanFinancialTotalsTypeormReader } from
  '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';

const suite = process.env.RUN_PAYMENT_ANNULMENT_EQUATION_POSTGRES === '1' ? describe : describe.skip;
const expectedDatabase = process.env.TEST_PAYMENT_ANNULMENT_PG_DATABASE ?? '';
const expectedDirectory = process.env.TEST_PAYMENT_ANNULMENT_PG_DIRECTORY ?? '';
const expectedPort = Number(process.env.TEST_PAYMENT_ANNULMENT_PG_PORT);
const marker = 'payment-annulment-equation:disposable';
const paymentDate = '2026-10-12';

function guardedSource() {
  if (process.env.TEST_PAYMENT_ANNULMENT_PG_HOST !== '127.0.0.1'
    || !Number.isSafeInteger(expectedPort) || expectedPort < 1024
    || !/^prestamos_payment_annulment_test_[a-f0-9]{12}$/.test(expectedDatabase)
    || !/[/\\]Temp[/\\]opencode[/\\]payment-annulment-pg-[a-f0-9]{12}$/i.test(expectedDirectory)) {
    throw new Error('A disposable PostgreSQL cluster is required for payment annulment equation tests.');
  }
  return new DataSource({
    type: 'postgres', host: '127.0.0.1', port: expectedPort, database: expectedDatabase,
    username: 'postgres', password: 'integration-only', synchronize: false,
    migrations: ['src/infrastructure/database/typeorm/migrations/*{.ts,.js}'],
    extra: { max: 8, connectionTimeoutMillis: 5000,
      options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=10000' },
  });
}

suite('payment annulment equation on disposable PostgreSQL', () => {
  jest.setTimeout(120000);
  let db: DataSource;
  let actorId: string;
  let collectorId: string;
  let methodId: string;
  let frequencyId: string;
  let routeId: string;
  const totals = new LoanFinancialTotalsTypeormReader();

  async function seedLoan() {
    const customerId = randomUUID(); const loanId = randomUUID(); const entryId = randomUUID();
    await db.query(`INSERT INTO customers (id,identification_type,identification,first_name,first_last_name,
      gender,birth_date,primary_phone,nationality,identification_front_file_key)
      VALUES ($1,'NATIONAL',$2,'Annulment','Synthetic','MALE','2000-01-01','00000000','COSTA_RICAN','test/annulment')`,
    [customerId, `ANNUL-${randomUUID()}`]);
    await db.query(`INSERT INTO customer_route_assignments (customer_id,route_id,assigned_by_user_id)
      VALUES ($1,$2,$3)`, [customerId, routeId, actorId]);
    await db.query(`INSERT INTO loans (id,customer_id,payment_frequency_id,preferred_payment_method_id,start_date,
      principal,interest_amount,total_amount,status,created_by_user_id)
      VALUES ($1,$2,$3,$4,'2026-10-01',100000,0,100000,'ACTIVE',$5)`,
    [loanId, customerId, frequencyId, methodId, actorId]);
    await db.query(`INSERT INTO payment_plan_entries (id,loan_id,sequence,due_date,pending_amount)
      VALUES ($1,$2,1,'2026-10-12',100000)`, [entryId, loanId]);
    return { loanId, entryId };
  }

  async function registerHalf(loanId: string) {
    return new RegisterPaymentUseCase(db, totals).execute({ loanId, amount: '50000.00', paymentDate,
      methodId, collectorId, idempotencyKey: randomUUID() }, actorId);
  }

  beforeAll(async () => {
    db = guardedSource(); await db.initialize();
    const [identity] = await db.query(`SELECT host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_database() AS database, current_setting('data_directory') AS directory,
      shobj_description(database.oid, 'pg_database') AS comment
      FROM pg_database database WHERE database.datname = current_database()`);
    if (identity.host !== '127.0.0.1' || identity.port !== expectedPort || identity.database !== expectedDatabase
      || identity.directory.replace(/\\/g, '/').toLowerCase() !== expectedDirectory.replace(/\\/g, '/').toLowerCase()
      || identity.comment !== marker) throw new Error(`Disposable PostgreSQL identity mismatch: ${JSON.stringify(identity)}`);

    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await db.runMigrations({ transaction: 'each' });
    await db.query(`ALTER TABLE payments DROP CONSTRAINT "CHK_payments_equation"`);
    await db.query(`ALTER TABLE payments ADD CONSTRAINT "CHK_payments_equation" CHECK (
      (status = 'VALID' AND amount = principal_applied + interest_applied
        AND principal_applied >= 0 AND interest_applied >= 0)
      OR (status = 'ANNULLED' AND principal_applied = 0 AND interest_applied = 0))`);
    const runner = db.createQueryRunner();
    await runner.connect(); await runner.startTransaction();
    try {
      await new PreserveAnnulledPaymentAllocation1762900000000().up(runner);
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction(); throw error;
    } finally { await runner.release(); }
    const [constraint] = await db.query(`SELECT pg_get_constraintdef(oid, true) AS definition, convalidated AS validated
      FROM pg_constraint WHERE conrelid = 'payments'::regclass AND conname = 'CHK_payments_equation'`);
    expect(constraint).toMatchObject({ validated: true });
    expect(constraint.definition).toContain('amount = (principal_applied + interest_applied)');
    expect(constraint.definition).not.toContain("status::text = 'ANNULLED'");

    const existingRole = await db.query(`SELECT id FROM roles WHERE code = 'COLLECTOR'`);
    const roleId = existingRole[0]?.id ?? randomUUID();
    if (!existingRole[0]) await db.query(`INSERT INTO roles (id,code,name) VALUES ($1,'COLLECTOR','Collector')`, [roleId]);
    actorId = randomUUID(); collectorId = randomUUID(); methodId = randomUUID(); frequencyId = randomUUID(); routeId = randomUUID();
    await db.query(`INSERT INTO users (id,username,full_name,password_hash,role_id)
      VALUES ($1,$2,'Annulment Synthetic Collector','!disabled!',$3)`, [actorId, `annul_${actorId}`, roleId]);
    await db.query(`INSERT INTO collectors (id,identification,first_name,first_last_name,phone,birth_date,address,user_id)
      VALUES ($1,$2,'Annulment','Collector','00000000','2000-01-01','Test',$3)`,
    [collectorId, `ANNUL-${collectorId}`, actorId]);
    await db.query(`INSERT INTO payment_methods (id,name,display_order) VALUES ($1,$2,970)`, [methodId, `Annulment method ${methodId}`]);
    await db.query(`INSERT INTO payment_frequencies (id,name,interval_unit,interval_value,display_order)
      VALUES ($1,$2,'DAY',1,970)`, [frequencyId, `Annulment daily ${frequencyId}`]);
    await db.query(`INSERT INTO routes (id,name) VALUES ($1,$2)`, [routeId, `Annulment route ${routeId}`]);
    await db.query(`INSERT INTO collector_route_assignments (collector_user_id,route_id,assigned_by_user_id)
      VALUES ($1,$2,$1)`, [actorId, routeId]);
    const [opening] = await db.query(`SELECT opening_date::text AS "openingDate" FROM financial_openings
      WHERE singleton_key = 'DEFAULT'`);
    if (!opening) await db.query(`INSERT INTO financial_openings (opening_date,initial_available_amount,initial_portfolio,
      initial_uncollectible_amount,historical_seed_capital,opened_by_user_id)
      VALUES ('2026-10-01',0,0,0,0,$1)`, [actorId]);
  });

  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

  it('annuls a 50000 capital payment without erasing allocation and replays idempotently', async () => {
    const seed = await seedLoan(); const payment = await registerHalf(seed.loanId); const key = randomUUID();
    expect(payment).toMatchObject({ amount: '50000.00', principalApplied: '50000.00', interestApplied: '0.00' });
    const useCase = new RegisterPaymentUseCase(db, totals);
    const first = await useCase.annul(payment.id, 'Synthetic full-capital annulment', key, actorId, 'CASH_REFUND');
    const replay = await useCase.annul(payment.id, 'Synthetic full-capital annulment', key, actorId, 'CASH_REFUND');
    expect(replay).toEqual(first);

    const [facts] = await db.query(`SELECT payment.status, payment.amount::text AS amount,
      payment.principal_applied::text AS principal, payment.interest_applied::text AS interest,
      entry.pending_amount::text AS pending,
      (SELECT COUNT(*)::int FROM payment_annulments WHERE payment_id=payment.id) AS annulments,
      (SELECT COUNT(*)::int FROM payment_applications WHERE payment_id=payment.id
        AND amount_applied=50000 AND pending_before=100000 AND pending_after=50000) AS applications,
      (SELECT COUNT(*)::int FROM cash_movements WHERE payment_id=payment.id AND direction='INFLOW'
        AND concept='CUSTOMER_PAYMENT' AND amount=50000) AS inflows,
      (SELECT COUNT(*)::int FROM cash_movements reversal JOIN cash_movements original
        ON original.id=reversal.reversed_movement_id WHERE original.payment_id=payment.id
        AND reversal.direction='OUTFLOW' AND reversal.concept='REVERSAL' AND reversal.amount=50000) AS reversals
      FROM payments payment JOIN payment_plan_entries entry ON entry.id=$2 WHERE payment.id=$1`, [payment.id, seed.entryId]);
    expect(facts).toEqual({ status: 'ANNULLED', amount: '50000.00', principal: '50000.00', interest: '0.00',
      pending: '100000.00', annulments: 1, applications: 1, inflows: 1, reversals: 1 });
    await expect(db.query(`UPDATE payments SET principal_applied=0 WHERE id=$1`, [payment.id]))
      .rejects.toMatchObject({ code: '23514', constraint: 'CHK_payments_equation' });
  });

  it('rolls back the complete annulment when the cash reversal cannot be inserted', async () => {
    const seed = await seedLoan(); const payment = await registerHalf(seed.loanId); const key = randomUUID();
    const reversalKey = `payment-annulment:${key}`;
    await db.query(`INSERT INTO cash_movements (direction,concept,amount,movement_date,payment_method_id,observations,
      created_by_user_id,idempotency_key,idempotency_fingerprint)
      VALUES ('INFLOW','EXTERNAL_INCOME',1,$1,$2,'Synthetic conflict',$3,$4,$5)`,
    [paymentDate, methodId, actorId, reversalKey, createHash('sha256').update(reversalKey).digest('hex')]);

    await expect(new RegisterPaymentUseCase(db, totals).annul(payment.id, 'Synthetic rollback', key, actorId, 'CASH_REFUND'))
      .rejects.toThrow('The annulment cash reversal conflicts with an existing movement.');
    const [facts] = await db.query(`SELECT payment.status, payment.principal_applied::text AS principal,
      entry.pending_amount::text AS pending,
      (SELECT COUNT(*)::int FROM payment_annulments WHERE payment_id=payment.id) AS annulments,
      (SELECT COUNT(*)::int FROM cash_movements reversal JOIN cash_movements original
        ON original.id=reversal.reversed_movement_id WHERE original.payment_id=payment.id) AS reversals
      FROM payments payment JOIN payment_plan_entries entry ON entry.id=$2 WHERE payment.id=$1`, [payment.id, seed.entryId]);
    expect(facts).toEqual({ status: 'VALID', principal: '50000.00', pending: '50000.00', annulments: 0, reversals: 0 });
  });
});
