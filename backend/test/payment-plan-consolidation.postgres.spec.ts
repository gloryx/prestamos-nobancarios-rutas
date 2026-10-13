import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { CreatePaymentPlanConsolidations1762800000000 } from
  '../src/infrastructure/database/typeorm/migrations/1762800000000-create-payment-plan-consolidations';

const suite = process.env.RUN_PAYMENT_PLAN_CONSOLIDATION_POSTGRES === '1' ? describe : describe.skip;
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
    throw new Error('A disposable PostgreSQL cluster is required for payment plan consolidation tests.');
  }
  return new DataSource({
    type: 'postgres', host: '127.0.0.1', port: expectedPort, database: expectedDatabase,
    username: 'postgres', password: 'integration-only', synchronize: false,
    migrations: ['src/infrastructure/database/typeorm/migrations/*{.ts,.js}'],
    extra: { max: 8, connectionTimeoutMillis: 5000,
      options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=10000' },
  });
}

type LoanSeed = {
  loan: string;
  payment: string;
  applied: string;
  sourceA: string;
  sourceB: string;
  target: string;
};
type Seed = { actor: string; first: LoanSeed; second: LoanSeed; third: LoanSeed };

suite('payment plan consolidation persistence on disposable PostgreSQL', () => {
  jest.setTimeout(120000);
  let db: DataSource;
  let seed: Seed;
  let financialBefore: Record<string, string | number>;

  const financialState = async () => (await db.query(`SELECT
    (SELECT COUNT(*)::int FROM loans) AS "loanCount",
    (SELECT COALESCE(SUM(total_amount),0)::text FROM loans) AS "loanAmount",
    (SELECT COUNT(*)::int FROM payment_plan_entries) AS "planCount",
    (SELECT COALESCE(SUM(pending_amount),0)::text FROM payment_plan_entries) AS "planAmount",
    (SELECT COUNT(*)::int FROM payments) AS "paymentCount",
    (SELECT COALESCE(SUM(amount),0)::text FROM payments) AS "paymentAmount",
    (SELECT COUNT(*)::int FROM payment_applications) AS "applicationCount",
    (SELECT COALESCE(SUM(amount_applied),0)::text FROM payment_applications) AS "applicationAmount",
    (SELECT COUNT(*)::int FROM cash_movements) AS "cashCount",
    (SELECT COALESCE(SUM(amount),0)::text FROM cash_movements) AS "cashAmount"`))[0];

  async function seedExistingFinancialFacts(): Promise<Seed> {
    const actor = randomUUID();
    const role = randomUUID();
    const method = randomUUID();
    const frequency = randomUUID();
    const customer = randomUUID();
    await db.query(`INSERT INTO roles (id,code,name) VALUES ($1,'PLAN_TEST_ACTOR','Plan test actor')`, [role]);
    await db.query(`INSERT INTO users (id,username,full_name,password_hash,role_id)
      VALUES ($1,$2,'Plan Test Actor','!disabled!',$3)`, [actor, `plan_test_${actor}`, role]);
    await db.query(`INSERT INTO payment_methods (id,name,display_order) VALUES ($1,'PLAN TEST METHOD',900)`, [method]);
    await db.query(`INSERT INTO payment_frequencies (id,name,interval_unit,interval_value,display_order)
      VALUES ($1,'Plan test daily','DAY',1,900)`, [frequency]);
    await db.query(`INSERT INTO customers (id,identification_type,identification,first_name,first_last_name,
      gender,birth_date,primary_phone,nationality,identification_front_file_key)
      VALUES ($1,'NATIONAL',$2,'Plan','Customer','MALE','2000-01-01','00000000','COSTA_RICAN','test/plan')`,
    [customer, `PLAN-${customer}`]);

    const createLoan = async (suffix: string): Promise<LoanSeed> => {
      const ids: LoanSeed = { loan: randomUUID(), payment: randomUUID(), applied: randomUUID(),
        sourceA: randomUUID(), sourceB: randomUUID(), target: randomUUID() };
      const future = randomUUID();
      await db.query(`INSERT INTO loans (id,customer_id,payment_frequency_id,preferred_payment_method_id,start_date,
        principal,interest_amount,total_amount,status,created_by_user_id)
        VALUES ($1,$2,$3,$4,'2026-10-01',250,0,250,'ACTIVE',$5)`,
      [ids.loan, customer, frequency, method, actor]);
      await db.query(`INSERT INTO payment_plan_entries (id,loan_id,sequence,due_date,pending_amount) VALUES
        ($1,$2,1,'2026-10-08',0),($3,$2,2,'2026-10-09',50),($4,$2,3,'2026-10-12',50),
        ($5,$2,4,'2026-10-13',50),($6,$2,5,'2026-10-14',50)`,
      [ids.applied, ids.loan, ids.sourceA, ids.sourceB, ids.target, future]);
      await db.query(`INSERT INTO payments
        (id,loan_id,amount,principal_applied,interest_applied,payment_date,method_id,created_by_user_id,status,
          idempotency_key,idempotency_fingerprint)
        VALUES ($1,$2,50,50,0,$3,$4,$5,'VALID',$6,$7)`,
      [ids.payment, ids.loan, paymentDate, method, actor, `plan-payment-${suffix}-${ids.payment}`, `fingerprint-${suffix}`]);
      await db.query(`INSERT INTO payment_applications
        (payment_id,payment_plan_entry_id,amount_applied,pending_before,pending_after,carried_forward_amount)
        VALUES ($1,$2,50,50,0,0)`, [ids.payment, ids.applied]);
      await db.query(`INSERT INTO cash_movements
        (direction,concept,amount,movement_date,payment_method_id,created_by_user_id,idempotency_key,
          idempotency_fingerprint,payment_id)
        VALUES ('INFLOW','CUSTOMER_PAYMENT',50,$1,$2,$3,$4,$5,$6)`,
      [paymentDate, method, actor, `plan-cash-${suffix}-${ids.payment}`, `fingerprint-${suffix}`, ids.payment]);
      return ids;
    };

    return { actor, first: await createLoan('first'), second: await createLoan('second'),
      third: await createLoan('third') };
  }

  async function insertConsolidation(manager: Pick<EntityManager, 'query'>, loan: LoanSeed) {
    const [header] = await manager.query(`INSERT INTO payment_plan_consolidations
      (payment_id,loan_id,rule_version,effective_payment_date,target_plan_entry_id,target_due_date,target_sequence,
        target_pending_before,target_pending_after,total_moved)
      VALUES ($1,$2,1,$3,$4,'2026-10-13',4,50,150,100) RETURNING id`,
    [loan.payment, loan.loan, paymentDate, loan.target]);
    await manager.query(`INSERT INTO payment_plan_consolidation_sources
      (consolidation_id,loan_id,ordinal,source_plan_entry_id,source_due_date,source_sequence,amount_moved,
        source_pending_before,source_pending_after)
      VALUES ($1,$2,1,$3,'2026-10-09',2,50,50,0),($1,$2,2,$4,'2026-10-12',3,50,50,0)`,
    [header.id, loan.loan, loan.sourceA, loan.sourceB]);
    return header.id as string;
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

    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await db.runMigrations({ transaction: 'each' });
    const [latest] = await db.query(`SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1`);
    expect(latest.name).toBe('CreatePaymentPlanConsolidations1762800000000');
    await db.undoLastMigration({ transaction: 'each' });
    const [removed] = await db.query(`SELECT
      to_regclass('public.payment_plan_consolidations') AS header,
      to_regclass('public.payment_plan_consolidation_sources') AS sources,
      to_regclass('public.payment_plan_consolidation_reversals') AS reversals`);
    expect(removed).toEqual({ header: null, sources: null, reversals: null });

    seed = await seedExistingFinancialFacts();
    financialBefore = await financialState();
    await db.runMigrations({ transaction: 'each' });
  });

  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

  it('applies additively without backfill or changes to existing financial facts', async () => {
    const [counts] = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM payment_plan_consolidations) AS headers,
      (SELECT COUNT(*)::int FROM payment_plan_consolidation_sources) AS sources,
      (SELECT COUNT(*)::int FROM payment_plan_consolidation_reversals) AS reversals`);
    expect(counts).toEqual({ headers: 0, sources: 0, reversals: 0 });
    await expect(financialState()).resolves.toEqual(financialBefore);
  });

  it('commits a complete snapshot and rejects an incomplete source total', async () => {
    const rollback = new Error('ROLLBACK_COMPLETE_CONSOLIDATION');
    await expect(db.transaction(async (manager) => {
      const id = await insertConsolidation(manager, seed.first);
      await manager.query('SET CONSTRAINTS ALL IMMEDIATE');
      const [event] = await manager.query(`SELECT total_moved::text AS total,
        (SELECT SUM(amount_moved)::text FROM payment_plan_consolidation_sources WHERE consolidation_id=$1) AS sources
        FROM payment_plan_consolidations WHERE id=$1`, [id]);
      expect(event).toEqual({ total: '100.00', sources: '100.00' });
      throw rollback;
    })).rejects.toBe(rollback);

    await expect(db.transaction(async (manager) => {
      await manager.query(`INSERT INTO payment_plan_consolidations
        (payment_id,loan_id,effective_payment_date,target_plan_entry_id,target_due_date,target_sequence,
          target_pending_before,target_pending_after,total_moved)
        VALUES ($1,$2,$3,$4,'2026-10-13',4,50,150,100)`,
      [seed.second.payment, seed.second.loan, paymentDate, seed.second.target]);
    })).rejects.toMatchObject({ code: '23514', constraint: 'CHK_payment_plan_consolidation_source_total' });
  });

  it('rejects cross-loan headers, sources and mismatched historical snapshots', async () => {
    await expect(db.query(`INSERT INTO payment_plan_consolidations
      (payment_id,loan_id,effective_payment_date,target_plan_entry_id,target_due_date,target_sequence,
        target_pending_before,target_pending_after,total_moved)
      VALUES ($1,$2,$3,$4,'2026-10-13',4,50,150,100)`,
    [seed.first.payment, seed.first.loan, paymentDate, seed.second.target]))
      .rejects.toMatchObject({ code: '23514', constraint: 'CHK_payment_plan_consolidation_same_loan' });

    await expect(db.transaction(async (manager) => {
      const [header] = await manager.query(`INSERT INTO payment_plan_consolidations
        (payment_id,loan_id,effective_payment_date,target_plan_entry_id,target_due_date,target_sequence,
          target_pending_before,target_pending_after,total_moved)
        VALUES ($1,$2,$3,$4,'2026-10-13',4,50,100,50) RETURNING id`,
      [seed.first.payment, seed.first.loan, paymentDate, seed.first.target]);
      await manager.query(`INSERT INTO payment_plan_consolidation_sources
        (consolidation_id,loan_id,ordinal,source_plan_entry_id,source_due_date,source_sequence,amount_moved,
          source_pending_before,source_pending_after)
        VALUES ($1,$2,1,$3,'2026-10-09',2,50,50,0)`,
      [header.id, seed.first.loan, seed.second.sourceA]);
    })).rejects.toMatchObject({ code: '23514', constraint: 'CHK_plan_consolidation_source_same_loan' });

    await expect(db.query(`INSERT INTO payment_plan_consolidations
      (payment_id,loan_id,effective_payment_date,target_plan_entry_id,target_due_date,target_sequence,
        target_pending_before,target_pending_after,total_moved)
      VALUES ($1,$2,$3,$4,'2026-10-14',4,50,150,100)`,
    [seed.first.payment, seed.first.loan, paymentDate, seed.first.target]))
      .rejects.toMatchObject({ code: '23514', constraint: 'CHK_payment_plan_consolidation_target_snapshot' });
  });

  it('keeps events immutable and links reversal only to the same payment annulment', async () => {
    const consolidationId = await db.transaction(async (manager) => {
      const id = await insertConsolidation(manager, seed.first);
      await manager.query('SET CONSTRAINTS ALL IMMEDIATE');
      return id;
    });
    await expect(db.query(`UPDATE payment_plan_consolidations SET total_moved=90 WHERE id=$1`, [consolidationId]))
      .rejects.toMatchObject({ code: '55000' });
    await expect(db.query(`DELETE FROM payment_plan_consolidation_sources WHERE consolidation_id=$1`, [consolidationId]))
      .rejects.toMatchObject({ code: '55000' });

    const [firstAnnulment] = await db.query(`INSERT INTO payment_annulments
      (payment_id,reason,annulment_type,created_by_user_id,idempotency_key,idempotency_fingerprint)
      VALUES ($1,'Disposable test','DATA_CORRECTION',$2,$3,'first-annulment') RETURNING id`,
    [seed.first.payment, seed.actor, randomUUID()]);
    const [secondAnnulment] = await db.query(`INSERT INTO payment_annulments
      (payment_id,reason,annulment_type,created_by_user_id,idempotency_key,idempotency_fingerprint)
      VALUES ($1,'Disposable test','DATA_CORRECTION',$2,$3,'second-annulment') RETURNING id`,
    [seed.second.payment, seed.actor, randomUUID()]);
    await expect(db.query(`INSERT INTO payment_plan_consolidation_reversals
      (consolidation_id,payment_annulment_id) VALUES ($1,$2)`, [consolidationId, secondAnnulment.id]))
      .rejects.toMatchObject({ code: '23514', constraint: 'CHK_plan_consolidation_reversal_payment' });

    const [reversal] = await db.query(`INSERT INTO payment_plan_consolidation_reversals
      (consolidation_id,payment_annulment_id) VALUES ($1,$2) RETURNING id`, [consolidationId, firstAnnulment.id]);
    await expect(db.query(`UPDATE payment_plan_consolidation_reversals SET created_at=now() WHERE id=$1`, [reversal.id]))
      .rejects.toMatchObject({ code: '55000' });
    await expect(db.query(`DELETE FROM payment_plan_consolidation_reversals WHERE id=$1`, [reversal.id]))
      .rejects.toMatchObject({ code: '55000' });

    const runner = db.createQueryRunner();
    await runner.connect();
    await expect(new CreatePaymentPlanConsolidations1762800000000().down(runner))
      .rejects.toThrow('Cannot roll back payment plan consolidation schema while records exist');
    await runner.release();
  });

  it('serializes concurrent attempts to persist one consolidation for the same payment', async () => {
    const attempts = await Promise.allSettled([
      db.transaction((manager) => insertConsolidation(manager, seed.third)),
      db.transaction((manager) => insertConsolidation(manager, seed.third)),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const [persisted] = await db.query(`SELECT COUNT(*)::int AS count FROM payment_plan_consolidations
      WHERE payment_id=$1`, [seed.third.payment]);
    expect(persisted.count).toBe(1);
  });
});
