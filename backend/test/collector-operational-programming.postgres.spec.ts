import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { CreateCollectorOperationalProgramming1762700000000 } from
  '../src/infrastructure/database/typeorm/migrations/1762700000000-create-collector-operational-programming';

const suite = process.env.RUN_OPERATIONAL_PROGRAMMING_POSTGRES === '1' ? describe : describe.skip;
const expectedDatabase = process.env.TEST_OPERATIONAL_PROGRAMMING_PG_DATABASE ?? '';
const expectedDirectory = process.env.TEST_OPERATIONAL_PROGRAMMING_PG_DIRECTORY ?? '';
const expectedPort = Number(process.env.TEST_OPERATIONAL_PROGRAMMING_PG_PORT);
const marker = 'collector-operational-programming:disposable';
const day = '2026-10-12';

function guardedSource() {
  if (process.env.TEST_OPERATIONAL_PROGRAMMING_PG_HOST !== '127.0.0.1'
    || !Number.isSafeInteger(expectedPort) || expectedPort < 1024
    || !/^prestamos_operational_schema_test_[a-f0-9]{12}$/.test(expectedDatabase)
    || !/[/\\]Temp[/\\]opencode[/\\]operational-schema-pg-[a-f0-9]{12}$/i.test(expectedDirectory)) {
    throw new Error('A disposable PostgreSQL cluster is required for operational programming tests.');
  }
  return new DataSource({
    type: 'postgres', host: '127.0.0.1', port: expectedPort, database: expectedDatabase,
    username: 'postgres', password: 'integration-only', synchronize: false,
    migrations: ['src/infrastructure/database/typeorm/migrations/*{.ts,.js}'],
    extra: { max: 8, connectionTimeoutMillis: 5000,
      options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=10000' },
  });
}

type Seed = {
  actor: string;
  collector: string;
  route: string;
  customer: string;
  loan: string;
  customerAssignment: string;
  collectorAssignment: string;
  precollection: string;
};

suite('collector operational programming on disposable PostgreSQL', () => {
  jest.setTimeout(120000);
  let db: DataSource;
  let seed: Seed;
  let financialBefore: Record<string, string | number>;

  const financialState = async () => (await db.query(`SELECT
    (SELECT COUNT(*)::int FROM payment_plan_entries) AS "planCount",
    (SELECT COALESCE(SUM(pending_amount),0)::text FROM payment_plan_entries) AS "planAmount",
    (SELECT COUNT(*)::int FROM payments) AS "paymentCount",
    (SELECT COALESCE(SUM(amount),0)::text FROM payments) AS "paymentAmount",
    (SELECT COUNT(*)::int FROM collector_precollections) AS "precollectionCount",
    (SELECT COALESCE(SUM(amount),0)::text FROM collector_precollections) AS "precollectionAmount",
    (SELECT COUNT(*)::int FROM cash_movements) AS "cashCount",
    (SELECT COALESCE(SUM(amount),0)::text FROM cash_movements) AS "cashAmount",
    (SELECT COUNT(*)::int FROM collector_custody_entries) AS "custodyCount",
    (SELECT COALESCE(SUM(amount),0)::text FROM collector_custody_entries) AS "custodyAmount"`))[0];

  async function seedExistingFacts(): Promise<Seed> {
    const ids = { actor: randomUUID(), collector: randomUUID(), route: randomUUID(), customer: randomUUID(),
      loan: randomUUID(), customerAssignment: randomUUID(), collectorAssignment: randomUUID(),
      precollection: randomUUID(), role: randomUUID(), method: randomUUID(), frequency: randomUUID() };
    await db.query(`INSERT INTO roles (id,code,name) VALUES ($1,'COLLECTOR','Collector')`, [ids.role]);
    await db.query(`INSERT INTO users (id,username,full_name,password_hash,role_id)
      VALUES ($1,$2,'Operational Collector','!disabled!',$3)`, [ids.actor, `operational_${ids.actor}`, ids.role]);
    await db.query(`INSERT INTO collectors
      (id,identification,first_name,first_last_name,phone,birth_date,address,user_id)
      VALUES ($1,$2,'Operational','Collector','00000000','2000-01-01','Test',$3)`,
    [ids.collector, `OP-${ids.collector}`, ids.actor]);
    await db.query(`INSERT INTO collector_user_assignments
      (collector_id,user_id,assigned_at,assigned_by_user_id) VALUES ($1,$2,$3::date,$2)`,
    [ids.collector, ids.actor, day]);
    await db.query(`INSERT INTO payment_methods (id,name,display_order) VALUES ($1,'EFECTIVO',1)`, [ids.method]);
    await db.query(`INSERT INTO payment_frequencies (id,name,interval_unit,interval_value,display_order)
      VALUES ($1,'Operational Daily','DAY',1,1)`, [ids.frequency]);
    await db.query(`INSERT INTO routes (id,name) VALUES ($1,'Operational Route')`, [ids.route]);
    await db.query(`INSERT INTO customers (id,identification_type,identification,first_name,first_last_name,
      gender,birth_date,primary_phone,nationality,identification_front_file_key)
      VALUES ($1,'NATIONAL',$2,'Operational','Customer','MALE','2000-01-01','00000000','COSTA_RICAN','test/key')`,
    [ids.customer, `OP-${ids.customer}`]);
    await db.query(`INSERT INTO customer_route_assignments
      (id,customer_id,route_id,assigned_by_user_id,assigned_at) VALUES ($1,$2,$3,$4,$5::date)`,
    [ids.customerAssignment, ids.customer, ids.route, ids.actor, day]);
    await db.query(`INSERT INTO collector_route_assignments
      (id,collector_user_id,route_id,assigned_by_user_id,assigned_at) VALUES ($1,$2,$3,$2,$4::date)`,
    [ids.collectorAssignment, ids.actor, ids.route, day]);
    await db.query(`INSERT INTO loans (id,customer_id,payment_frequency_id,preferred_payment_method_id,start_date,
      principal,interest_amount,total_amount,status,created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,100,0,100,'ACTIVE',$6)`,
    [ids.loan, ids.customer, ids.frequency, ids.method, day, ids.actor]);
    await db.query(`INSERT INTO payment_plan_entries (loan_id,sequence,due_date,pending_amount)
      VALUES ($1,1,$2,100)`, [ids.loan, day]);
    await db.query(`INSERT INTO collector_precollections
      (id,collector_id,collector_user_id,customer_id,loan_id,route_id,customer_route_assignment_id,
        collector_route_assignment_id,payment_method_id,custody_treatment,amount,effective_date,status,
        recorded_by_user_id,idempotency_key,idempotency_fingerprint)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'COMPANY_RECEIVED',20,$10,'RECORDED',$3,$11,'seed-fingerprint')`,
    [ids.precollection, ids.collector, ids.actor, ids.customer, ids.loan, ids.route, ids.customerAssignment,
      ids.collectorAssignment, ids.method, day, randomUUID()]);
    return ids;
  }

  async function insertActivation(manager: Pick<EntityManager, 'query'>) {
    const [activation] = await manager.query(`INSERT INTO collector_collection_model_activations
      (model_version,activation_date,activated_by_user_id,idempotency_key,idempotency_fingerprint)
      VALUES (1,$1,$2,$3,'activation-fingerprint') RETURNING id`, [day, seed.actor, randomUUID()]);
    return activation.id as string;
  }

  async function insertPlan(manager: Pick<EntityManager, 'query'>, activationId: string, version = 1) {
    const [plan] = await manager.query(`INSERT INTO collector_operational_plan_versions
      (activation_id,loan_id,version,previous_version_id,event_type,effective_from,baseline_valid_payments,
        baseline_financial_balance,baseline_active_precollections,plan_total,collector_id,collector_user_id,
        route_id,customer_route_assignment_id,collector_route_assignment_id,created_by_user_id,
        idempotency_key,idempotency_fingerprint)
      VALUES ($1,$2,$3,NULL,'ACTIVATION_BASELINE',$4,0,100,20,80,$5,$6,$7,$8,$9,$6,$10,'plan-fingerprint')
      RETURNING id`, [activationId, seed.loan, version, day, seed.collector, seed.actor, seed.route,
      seed.customerAssignment, seed.collectorAssignment, randomUUID()]);
    await manager.query(`INSERT INTO collector_operational_plan_entries
      (plan_version_id,sequence,due_date,scheduled_amount) VALUES ($1,1,$2,30),($1,2,$3,50)`,
    [plan.id, day, '2026-10-13']);
    return plan.id as string;
  }

  async function insertSnapshot(manager: Pick<EntityManager, 'query'>, activationId: string, planId: string,
    generationKey = randomUUID()) {
    const [snapshot] = await manager.query(`INSERT INTO collector_collection_day_snapshots
      (activation_id,snapshot_date,loan_id,operational_plan_version_id,revision,collector_id,collector_user_id,
        route_id,customer_route_assignment_id,collector_route_assignment_id,scheduled_for_date,
        scheduled_through_date,plan_total,generation_reason,generated_by_user_id,generation_key,generation_fingerprint)
      VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,30,30,80,'ACTIVATION',$6,$10,'snapshot-fingerprint')
      RETURNING id`, [activationId, day, seed.loan, planId, seed.collector, seed.actor, seed.route,
      seed.customerAssignment, seed.collectorAssignment, generationKey]);
    return snapshot.id as string;
  }

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

    await db.runMigrations({ transaction: 'each' });
    const [latestCount] = await db.query(`SELECT COUNT(*)::int AS count FROM migrations`);
    expect(latestCount.count).toBe(29);
    await db.undoLastMigration({ transaction: 'each' });
    const [baselineCount] = await db.query(`SELECT COUNT(*)::int AS count FROM migrations`);
    expect(baselineCount.count).toBe(28);
    const [removed] = await db.query(`SELECT to_regclass('public.collector_operational_plan_versions') AS table_name,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='collector_precollections'
        AND column_name='collection_day_snapshot_id') AS column_present`);
    expect(removed).toEqual({ table_name: null, column_present: false });

    seed = await seedExistingFacts();
    financialBefore = await financialState();
    await db.runMigrations({ transaction: 'each' });
  });

  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

  it('applies additively without activation, backfill or financial ledger changes', async () => {
    const [state] = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM collector_collection_model_activations) AS activations,
      (SELECT COUNT(*)::int FROM collector_operational_plan_versions) AS plans,
      (SELECT COUNT(*)::int FROM collector_operational_plan_entries) AS entries,
      (SELECT COUNT(*)::int FROM collector_collection_day_snapshots) AS snapshots,
      (SELECT collection_day_snapshot_id FROM collector_precollections WHERE id=$1) AS link`, [seed.precollection]);
    expect(state).toEqual({ activations: 0, plans: 0, entries: 0, snapshots: 0, link: null });
    await expect(financialState()).resolves.toEqual(financialBefore);
  });

  it('enforces financial baseline, plan totals, assignments and effective dates', async () => {
    await expect(db.transaction(async (manager) => {
      const activation = await insertActivation(manager);
      await manager.query(`INSERT INTO collector_operational_plan_versions
        (activation_id,loan_id,version,event_type,effective_from,baseline_valid_payments,
          baseline_financial_balance,baseline_active_precollections,plan_total,collector_id,collector_user_id,
          route_id,customer_route_assignment_id,collector_route_assignment_id,created_by_user_id,
          idempotency_key,idempotency_fingerprint)
        VALUES ($1,$2,1,'ACTIVATION_BASELINE',$3,20,80,20,60,$4,$5,$6,$7,$8,$5,$9,'bad')`,
      [activation, seed.loan, day, seed.collector, seed.actor, seed.route, seed.customerAssignment,
        seed.collectorAssignment, randomUUID()]);
    })).rejects.toMatchObject({ code: '23514', constraint: 'CHK_collector_operational_plan_financial_baseline' });

    await expect(db.transaction(async (manager) => {
      const activation = await insertActivation(manager);
      const plan = await insertPlan(manager, activation);
      await manager.query(`UPDATE collector_operational_plan_entries SET due_date='2026-10-11' WHERE plan_version_id=$1`, [plan]);
    })).rejects.toMatchObject({ code: '55000' });
  });

  it('accepts one reconciled grouped snapshot and validates the nullable precollection relationship', async () => {
    const rollback = new Error('ROLLBACK_VALID_FIXTURE');
    await expect(db.transaction(async (manager) => {
      const activation = await insertActivation(manager);
      const plan = await insertPlan(manager, activation);
      const snapshot = await insertSnapshot(manager, activation, plan);
      await manager.query(`UPDATE collector_precollections SET collection_day_snapshot_id=$1 WHERE id=$2`,
        [snapshot, seed.precollection]);
      const [linked] = await manager.query(`SELECT collection_day_snapshot_id AS id FROM collector_precollections WHERE id=$1`,
        [seed.precollection]);
      expect(linked.id).toBe(snapshot);
      throw rollback;
    })).rejects.toBe(rollback);

    await expect(db.transaction(async (manager) => {
      const activation = await insertActivation(manager);
      const plan = await insertPlan(manager, activation);
      await manager.query(`INSERT INTO collector_collection_day_snapshots
        (activation_id,snapshot_date,loan_id,operational_plan_version_id,revision,collector_id,collector_user_id,
          route_id,customer_route_assignment_id,collector_route_assignment_id,scheduled_for_date,
          scheduled_through_date,plan_total,generation_reason,generation_key,generation_fingerprint)
        VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,20,30,80,'DAILY',$10,'bad')`,
      [activation, day, seed.loan, plan, seed.collector, seed.actor, seed.route, seed.customerAssignment,
        seed.collectorAssignment, randomUUID()]);
    })).rejects.toMatchObject({ code: '23514', constraint: 'CHK_collector_collection_day_snapshot_amounts_source' });
  });

  it('serializes duplicate versions and snapshots and keeps committed history immutable', async () => {
    const activation = await insertActivation(db.manager);
    const attempts = await Promise.allSettled([
      db.transaction((manager) => insertPlan(manager, activation)),
      db.transaction((manager) => insertPlan(manager, activation)),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const [plan] = await db.query(`SELECT id FROM collector_operational_plan_versions WHERE loan_id=$1 AND version=1`,
      [seed.loan]);
    const snapshotAttempts = await Promise.allSettled([
      insertSnapshot(db.manager, activation, plan.id, randomUUID()),
      insertSnapshot(db.manager, activation, plan.id, randomUUID()),
    ]);
    expect(snapshotAttempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(snapshotAttempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const [snapshot] = await db.query(`SELECT id FROM collector_collection_day_snapshots WHERE loan_id=$1`, [seed.loan]);
    await expect(db.query(`UPDATE collector_collection_day_snapshots SET generation_reason='CORRECTION' WHERE id=$1`,
      [snapshot.id])).rejects.toMatchObject({ code: '55000' });
    await expect(db.query(`DELETE FROM collector_operational_plan_entries WHERE plan_version_id=$1`,
      [plan.id])).rejects.toMatchObject({ code: '55000' });
    const runner = db.createQueryRunner();
    await runner.connect();
    await expect(new CreateCollectorOperationalProgramming1762700000000().down(runner))
      .rejects.toThrow('Cannot roll back collector operational programming while records exist');
    await runner.release();
    await expect(financialState()).resolves.toEqual(financialBefore);
  });
});
