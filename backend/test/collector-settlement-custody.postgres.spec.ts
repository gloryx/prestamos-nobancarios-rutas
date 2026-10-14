import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import type { CurrentIdentity } from '../src/domain/security/security.types';
import type { PaymentInput } from '../src/domain/payment/payment.types';
import { CreateCollectorPrecollectionUseCase, CancelCollectorPrecollectionUseCase } from '../src/application/collector-precollection/collector-precollection.use-cases';
import { RecordCollectorCustodyUseCase } from '../src/application/collector-custody/collector-custody.use-cases';
import { CreateCollectorSettlementUseCase, ConfirmCollectorSettlementUseCase,
  TransitionCollectorSettlementUseCase } from '../src/application/collector-settlement/collector-settlement.use-cases';
import { TransactionalPaymentRegistrar, TrustedSettlementPaymentContext } from '../src/application/payment/payment.use-case';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { CollectorPrecollectionTypeOrmStore } from '../src/infrastructure/database/typeorm/repositories/collector-precollection.typeorm-store';
import { CollectorCustodyTypeOrmStore } from '../src/infrastructure/database/typeorm/repositories/collector-custody.typeorm-store';
import { CollectorSettlementTypeOrmStore } from '../src/infrastructure/database/typeorm/repositories/collector-settlement.typeorm-store';
import { CollectorTypeOrmRepository } from '../src/infrastructure/database/typeorm/repositories/collector.typeorm-repository';
import type { TransactionalCashMovementRecorder } from '../src/application/cash-movement/cash-movement.use-cases';
import { CollectorOrmEntity, PermissionOrmEntity, RoleOrmEntity, RolePermissionOrmEntity,
  UserOrmEntity, UserSessionOrmEntity } from '../src/infrastructure/database/typeorm/entities';

const suite = process.env.RUN_COLLECTOR_FINANCE_POSTGRES === '1' ? describe : describe.skip;
const expectedDatabase = process.env.TEST_COLLECTOR_FINANCE_PG_DATABASE ?? '';
const expectedDirectory = process.env.TEST_COLLECTOR_FINANCE_PG_DIRECTORY ?? '';
const expectedPort = Number(process.env.TEST_COLLECTOR_FINANCE_PG_PORT);
const databaseMarker = 'stage1-isolated:20261012-financial-blockers';
const day = '2026-10-12';

function guardedSource() {
  if (process.env.TEST_COLLECTOR_FINANCE_PG_HOST !== '127.0.0.1'
    || expectedPort !== 55432
    || expectedDatabase !== 'prestamos_stage1_test_20261012'
    || !/[/\\]Temp[/\\]opencode[/\\]stage3-audit-pg-[a-f0-9]{32}$/i.test(expectedDirectory)) {
    throw new Error('The dedicated destructive collector-finance PostgreSQL database is required.');
  }
  return new DataSource({
    type: 'postgres', host: '127.0.0.1', port: expectedPort, database: expectedDatabase,
    username: 'refinancing_test_admin', password: 'integration-only', synchronize: false,
    entities: [CollectorOrmEntity, UserOrmEntity, RoleOrmEntity, UserSessionOrmEntity,
      RolePermissionOrmEntity, PermissionOrmEntity],
    extra: { max: 8, connectionTimeoutMillis: 5000,
      options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=10000' },
  });
}

suite('collector settlements and custody on isolated PostgreSQL', () => {
  jest.setTimeout(60000);
  let db: DataSource;
  let precollections: CollectorPrecollectionTypeOrmStore;
  let custody: CollectorCustodyTypeOrmStore;
  let settlements: CollectorSettlementTypeOrmStore;
  let createPrecollection: CreateCollectorPrecollectionUseCase;
  let cancelPrecollection: CancelCollectorPrecollectionUseCase;
  let recordCustody: RecordCollectorCustodyUseCase;
  let createSettlement: CreateCollectorSettlementUseCase;
  let transitionSettlement: TransitionCollectorSettlementUseCase;
  let confirmSettlement: ConfirmCollectorSettlementUseCase;
  const ids = { role: randomUUID(), actor: randomUUID(), collector: randomUUID(), method: randomUUID(),
    frequency: randomUUID(), route: randomUUID(), replacement: randomUUID() };
  const actor: CurrentIdentity = { id: ids.actor, username: 'collector_finance_actor', fullName: 'Collector Finance Actor',
    role: { id: ids.role, code: 'COLLECTOR', name: 'Collector', isSuperAdmin: true }, permissions: [], sessionId: randomUUID() };
  const clock = { today: () => day };

  async function resetAndSeed() {
    await db.query(`TRUNCATE collector_settlement_actions, collector_settlement_items, collector_settlements,
      collector_custody_entries, collector_precollections, payment_applications, payment_annulments,
      cash_movements, payments, payment_plan_entries, loan_status_history, loans,
      collector_user_assignments, customer_site_update_authorizations, customer_route_assignments,
      collector_route_assignments, collectors, customers, financial_openings, payment_methods,
      payment_frequencies, routes, users, roles RESTART IDENTITY CASCADE`);
    await db.query(`INSERT INTO roles (id,code,name) VALUES ($1,'COLLECTOR','Collector')`, [ids.role]);
    await db.query(`INSERT INTO users (id,username,full_name,password_hash,role_id) VALUES
      ($1,'collector_finance_actor','Collector Finance Actor','!disabled!',$2),
      ($3,'collector_finance_replacement','Collector Finance Replacement','!disabled!',$2)`,
    [ids.actor, ids.role, ids.replacement]);
    await db.query(`INSERT INTO collectors
      (id,identification,first_name,first_last_name,phone,birth_date,address,user_id)
      VALUES ($1,'COLLECTOR-FINANCE','Collector','Finance','00000000','2000-01-01','Test',$2)`,
    [ids.collector, ids.actor]);
    await db.query(`INSERT INTO collector_user_assignments (collector_id,user_id,assigned_by_user_id)
      VALUES ($1,$2,$2)`, [ids.collector, ids.actor]);
    await db.query(`INSERT INTO payment_methods (id,name,display_order) VALUES ($1,'EFECTIVO',1)`, [ids.method]);
    await db.query(`INSERT INTO payment_frequencies (id,name,interval_unit,interval_value,display_order)
      VALUES ($1,'Collector Finance Daily','DAY',1,1)`, [ids.frequency]);
    await db.query(`INSERT INTO routes (id,name) VALUES ($1,'Collector Finance Route')`, [ids.route]);
    await db.query(`INSERT INTO collector_route_assignments (collector_user_id,route_id,assigned_by_user_id)
      VALUES ($1,$2,$1)`, [ids.actor, ids.route]);
    await db.query(`INSERT INTO financial_openings (opening_date,initial_available_amount,initial_portfolio,
      initial_uncollectible_amount,historical_seed_capital,opened_by_user_id)
      VALUES ($1,1000000,0,0,0,$2)`, [day, ids.actor]);
  }

  async function newLoan(amount = '100.00') {
    const customerId = randomUUID();
    await db.query(`INSERT INTO customers (id,identification_type,identification,first_name,first_last_name,
      gender,birth_date,primary_phone,nationality,identification_front_file_key)
      VALUES ($1,'NATIONAL',$2,'Collector','Customer','MALE','2000-01-01','00000000','COSTA_RICAN','test/key')`,
    [customerId, `CF-${randomUUID()}`]);
    await db.query(`INSERT INTO customer_route_assignments (customer_id,route_id,assigned_by_user_id)
      VALUES ($1,$2,$3)`, [customerId, ids.route, ids.actor]);
    const [loan]: [{ id: string }] = await db.query(`INSERT INTO loans (customer_id,payment_frequency_id,
      preferred_payment_method_id,start_date,principal,interest_amount,total_amount,status,created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,0,$5,'ACTIVE',$6) RETURNING id`,
    [customerId, ids.frequency, ids.method, day, amount, ids.actor]);
    await db.query(`INSERT INTO payment_plan_entries (loan_id,sequence,due_date,pending_amount)
      VALUES ($1,1,$2,$3)`, [loan.id, day, amount]);
    await db.query(`INSERT INTO loan_status_history
      (loan_id,event_sequence,event_kind,from_status,to_status,changed_at,changed_by_user_id)
      VALUES ($1,1,'CREATED',NULL,'ACTIVE',now(),$2)`, [loan.id, ids.actor]);
    return { customerId, loanId: loan.id };
  }

  async function heldPrecollection(amount = '100.00') {
    const loan = await newLoan(amount);
    return createPrecollection.execute({ ...loan, paymentMethodId: ids.method, custodyTreatment: 'COLLECTOR_HELD',
      amount, effectiveDate: day, reference: null, notes: 'PostgreSQL integration test',
      idempotencyKey: randomUUID() }, actor);
  }

  async function underReview(precollectionIds: string[]) {
    const settlement = await createSettlement.execute({ precollectionIds, idempotencyKey: randomUUID() }, actor);
    await transitionSettlement.execute(settlement.id, 'submit', { idempotencyKey: randomUUID() }, actor);
    await transitionSettlement.execute(settlement.id, 'review', { idempotencyKey: randomUUID() }, actor);
    return settlement.id;
  }

  const remittance = (amount: string, key = randomUUID()) => recordCustody.execute('remittance', {
    amount, effectiveDate: day, paymentMethodId: ids.method, reference: `remittance-${key}`,
    reason: 'PostgreSQL concurrency test', notes: null, idempotencyKey: key,
  }, actor);

  beforeAll(async () => {
    db = guardedSource();
    await db.initialize();
    const [identity] = await db.query(`SELECT host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_database() AS database, current_setting('data_directory') AS directory,
      shobj_description(database.oid, 'pg_database') AS comment
      FROM pg_database database WHERE database.datname = current_database()`);
    if (identity.host !== '127.0.0.1' || identity.port !== expectedPort || identity.database !== expectedDatabase
      || identity.directory.replace(/\\/g, '/').toLowerCase() !== expectedDirectory.replace(/\\/g, '/').toLowerCase()
      || identity.comment !== databaseMarker) {
      throw new Error(`Collector-finance PostgreSQL identity mismatch: ${JSON.stringify(identity)}`);
    }
    const [state] = await db.query(`SELECT COUNT(*)::int AS migrations FROM migrations`);
    if (state.migrations !== 33) throw new Error('Collector-finance tests require exactly 33 applied migrations.');
    const totals = new LoanFinancialTotalsTypeormReader();
    const registrar = new TransactionalPaymentRegistrar(totals);
    precollections = new CollectorPrecollectionTypeOrmStore(db);
    const cash: TransactionalCashMovementRecorder = { recordWithManager: async (context, input) => {
      const manager = context as EntityManager;
      const [created] = await manager.query(`INSERT INTO cash_movements
        (direction,concept,amount,movement_date,payment_method_id,observations,collector_custody_entry_id,
         created_by_user_id,idempotency_key,idempotency_fingerprint)
        VALUES ($1,$2,$3::numeric(18,2),$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [input.direction, input.concept, input.amount, input.movementDate, input.paymentMethodId, input.observations,
        input.collectorCustodyEntryId, input.createdByUserId, input.idempotencyKey, input.idempotencyFingerprint]);
      return created;
    } };
    custody = new CollectorCustodyTypeOrmStore(db, cash);
    settlements = new CollectorSettlementTypeOrmStore(db, registrar);
    createPrecollection = new CreateCollectorPrecollectionUseCase(precollections, clock);
    cancelPrecollection = new CancelCollectorPrecollectionUseCase(precollections);
    recordCustody = new RecordCollectorCustodyUseCase(custody, clock);
    createSettlement = new CreateCollectorSettlementUseCase(settlements);
    transitionSettlement = new TransitionCollectorSettlementUseCase(settlements);
    confirmSettlement = new ConfirmCollectorSettlementUseCase(settlements, clock);
  });
  beforeEach(resetAndSeed);
  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

  it('enforces the hardened type, shape and source constraints on new ledger rows', async () => {
    await expect(db.query(`INSERT INTO collector_custody_entries
      (collector_id,direction,entry_type,amount,effective_date,payment_method_id,reference,reason,
       created_by_user_id,idempotency_key,idempotency_fingerprint)
      VALUES ($1,'CREDIT','LOAN_DISBURSEMENT',1,$2,$3,'ref','reason',$4,$5,'fp')`,
    [ids.collector, day, ids.method, ids.actor, randomUUID()])).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(`INSERT INTO collector_custody_entries
      (collector_id,direction,entry_type,amount,effective_date,payment_method_id,reference,
       created_by_user_id,idempotency_key,idempotency_fingerprint)
      VALUES ($1,'CREDIT','COMPANY_TOP_UP',1,$2,$3,'ref',$4,$5,'fp')`,
    [ids.collector, day, ids.method, ids.actor, randomUUID()])).rejects.toMatchObject({
      code: '23514', constraint: 'CHK_collector_custody_entries_shape_v2',
    });
    const companyReceived = await precollections.create({ ...(await newLoan()), paymentMethodId: ids.method,
      custodyTreatment: 'COMPANY_RECEIVED', amount: '10.00', effectiveDate: day, reference: null, notes: null,
      idempotencyKey: randomUUID() }, ids.actor, 'historical-company-received');
    await expect(db.query(`INSERT INTO collector_custody_entries
      (collector_id,direction,entry_type,amount,effective_date,payment_method_id,precollection_id,
       created_by_user_id,idempotency_key,idempotency_fingerprint)
      VALUES ($1,'CREDIT','CUSTOMER_COLLECTION',10,$2,$3,$4,$5,$6,'fp')`,
    [ids.collector, day, ids.method, companyReceived.id, ids.actor, randomUUID()])).rejects.toMatchObject({
      code: '23514', constraint: 'CHK_collector_custody_customer_source_v2',
    });
  });

  it('serializes a concurrent custody replay and persists one financial effect', async () => {
    const key = randomUUID();
    const command = { collectorId: ids.collector, amount: '100.00', effectiveDate: day,
      paymentMethodId: ids.method, reference: 'top-up', reason: 'Test funding', notes: null, idempotencyKey: key };
    const results = await Promise.all([
      recordCustody.execute('topup', command, actor), recordCustody.execute('topup', command, actor),
    ]);
    expect(results[0].id).toBe(results[1].id);
    const [count] = await db.query(`SELECT COUNT(*)::int AS count FROM collector_custody_entries
      WHERE idempotency_key = $1`, [key]);
    expect(count.count).toBe(1);
    const [pair] = await db.query(`SELECT COUNT(*)::int AS count FROM cash_movements cash
      JOIN collector_custody_entries custody ON custody.id = cash.collector_custody_entry_id
      WHERE custody.idempotency_key = $1 AND cash.concept = 'COLLECTOR_CUSTODY_TRANSFER'
        AND cash.direction = 'OUTFLOW' AND cash.amount = custody.amount
        AND cash.movement_date = custody.effective_date AND cash.payment_method_id = custody.payment_method_id
        AND cash.observations = custody.reference AND cash.created_by_user_id = custody.created_by_user_id`, [key]);
    expect(pair.count).toBe(1);
  });

  it('rolls back payments, allocations and state when a later settlement item fails', async () => {
    const first = await heldPrecollection('25.00');
    const second = await heldPrecollection('25.00');
    const settlementId = await underReview([first.id, second.id]);
    const realRegistrar = new TransactionalPaymentRegistrar(new LoanFinancialTotalsTypeormReader());
    let calls = 0;
    const failingRegistrar = { register: async (manager: EntityManager, input: PaymentInput, actorId: string,
      context?: TrustedSettlementPaymentContext) => {
      calls += 1;
      if (calls === 2) throw new Error('SYNTHETIC_SECOND_ITEM_FAILURE');
      return realRegistrar.register(manager, input, actorId, context);
    } } as TransactionalPaymentRegistrar;
    const failing = new ConfirmCollectorSettlementUseCase(
      new CollectorSettlementTypeOrmStore(db, failingRegistrar), clock);
    await expect(failing.execute(settlementId, { amountDelivered: '0', deliveryDate: day,
      deliveryPaymentMethodId: null, deliveryReference: null, deliveryNotes: null,
      idempotencyKey: randomUUID() }, actor))
      .rejects.toThrow('SYNTHETIC_SECOND_ITEM_FAILURE');
    const [state] = await db.query(`SELECT status,
      (SELECT COUNT(*)::int FROM payments) AS payments,
      (SELECT COUNT(*)::int FROM payment_applications) AS applications,
      (SELECT COUNT(*)::int FROM cash_movements) AS cash,
      (SELECT COUNT(*)::int FROM collector_settlement_actions WHERE action='CONFIRM') AS confirmations
      FROM collector_settlements WHERE id=$1`, [settlementId]);
    expect(state).toEqual({ status: 'UNDER_REVIEW', payments: 0, applications: 0, cash: 0, confirmations: 0 });
    const statuses = await db.query(`SELECT status FROM collector_precollections ORDER BY id`);
    expect(statuses.map((row: { status: string }) => row.status)).toEqual(['SUBMITTED', 'SUBMITTED']);
  });

  it('serializes settlement confirmation against a manual remittance and replays without duplicates', async () => {
    const precollection = await heldPrecollection();
    const settlementId = await underReview([precollection.id]);
    const confirmationKey = randomUUID();
    const [confirmation, manual] = await Promise.allSettled([
      confirmSettlement.execute(settlementId, { amountDelivered: '100.00', deliveryDate: day,
        deliveryPaymentMethodId: ids.method, deliveryReference: 'company-receipt',
        deliveryNotes: null, idempotencyKey: confirmationKey }, actor),
      remittance('100.00'),
    ]);
    expect(confirmation.status).toBe('fulfilled');
    expect(manual.status).toBe('rejected');
    await expect(confirmSettlement.execute(settlementId, { amountDelivered: '100.00', deliveryDate: day,
      deliveryPaymentMethodId: ids.method, deliveryReference: 'company-receipt',
      deliveryNotes: null, idempotencyKey: confirmationKey }, actor)).resolves.toMatchObject({ status: 'CONFIRMED' });
    const [effects] = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM payments) AS payments,
      (SELECT COUNT(*)::int FROM payment_applications) AS applications,
      (SELECT COUNT(*)::int FROM cash_movements WHERE concept='CUSTOMER_PAYMENT') AS cash,
      (SELECT COUNT(*)::int FROM collector_custody_entries WHERE entry_type='CUSTOMER_COLLECTION') AS collections,
      (SELECT COUNT(*)::int FROM collector_custody_entries WHERE entry_type='REMITTANCE_TO_COMPANY') AS remittances,
      (SELECT COUNT(*)::int FROM collector_settlement_actions WHERE action='CONFIRM') AS confirmations,
      (SELECT COALESCE(SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END),0)::text
       FROM collector_custody_entries) AS balance`);
    expect(effects).toEqual({ payments: 1, applications: 1, cash: 1, collections: 1,
      remittances: 1, confirmations: 1, balance: '0.00' });
  });

  it('serializes cancellation against a manual remittance and writes one reversal', async () => {
    const precollection = await heldPrecollection();
    const cancellationKey = randomUUID();
    const [cancellation, manual] = await Promise.allSettled([
      cancelPrecollection.execute(precollection.id, 'Duplicate collection', cancellationKey, actor),
      remittance('100.00'),
    ]);
    expect(cancellation.status).toBe('fulfilled');
    expect(manual.status).toBe('rejected');
    await expect(cancelPrecollection.execute(precollection.id, 'Duplicate collection', cancellationKey, actor))
      .resolves.toMatchObject({ status: 'CANCELLED' });
    const [state] = await db.query(`SELECT cp.status,
      (SELECT COUNT(*)::int FROM collector_custody_entries WHERE entry_type='REVERSAL') AS reversals,
      (SELECT COUNT(*)::int FROM collector_custody_entries WHERE entry_type='REMITTANCE_TO_COMPANY') AS remittances,
      (SELECT COALESCE(SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END),0)::text
       FROM collector_custody_entries) AS balance
      FROM collector_precollections cp WHERE cp.id=$1`, [precollection.id]);
    expect(state).toEqual({ status: 'CANCELLED', reversals: 1, remittances: 0, balance: '0.00' });
  });

  it('keeps a cancelled receipt number and assigns the next number without duplicating retries', async () => {
    const firstLoan = await newLoan();
    const createKey = randomUUID();
    const command = { ...firstLoan, paymentMethodId: ids.method, custodyTreatment: 'COLLECTOR_HELD' as const,
      amount: '25.00', effectiveDate: day, reference: null, notes: 'Receipt sequence test',
      idempotencyKey: createKey };
    const first = await createPrecollection.execute(command, actor);
    const replayed = await createPrecollection.execute(command, actor);
    expect(replayed).toMatchObject({ id: first.id, receiptNumber: first.receiptNumber });

    const cancellationKey = randomUUID();
    const cancelled = await cancelPrecollection.execute(first.id, 'Duplicate collection', cancellationKey, actor);
    const cancellationReplay = await cancelPrecollection.execute(first.id, 'Duplicate collection', cancellationKey, actor);
    expect(cancelled).toMatchObject({ id: first.id, status: 'CANCELLED', receiptNumber: first.receiptNumber });
    expect(cancellationReplay).toMatchObject({ id: first.id, status: 'CANCELLED', receiptNumber: first.receiptNumber });

    const secondLoan = await newLoan();
    const second = await createPrecollection.execute({ ...command, ...secondLoan,
      idempotencyKey: randomUUID() }, actor);
    expect(second.receiptNumber).not.toBe(first.receiptNumber);
    expect(Number(second.receiptNumber.slice(3))).toBe(Number(first.receiptNumber.slice(3)) + 1);

    const [receipts] = await db.query(`SELECT COUNT(*)::int AS count,
      COUNT(DISTINCT receipt_number)::int AS distinct,
      MIN(receipt_number) FILTER (WHERE id=$1) AS "cancelledReceipt"
      FROM collector_precollections WHERE id IN ($1,$2)`, [first.id, second.id]);
    expect(receipts).toEqual({ count: 2, distinct: 2, cancelledReceipt: first.receiptNumber });
  });

  it('blocks reassignment obligations and serializes one user across two collectors', async () => {
    const repository = new CollectorTypeOrmRepository(db.getRepository(CollectorOrmEntity),
      db.getRepository(UserOrmEntity), db);
    await expect(repository.reassignUser(ids.collector, ids.replacement, ids.actor))
      .rejects.toMatchObject({ reasonCode: 'COLLECTOR_HAS_ACTIVE_ROUTE_ASSIGNMENTS' });
    await db.query(`UPDATE collector_route_assignments SET ended_at=now() WHERE collector_user_id=$1`, [ids.actor]);
    const otherCollector = randomUUID();
    await db.query(`INSERT INTO collectors
      (id,identification,first_name,first_last_name,phone,birth_date,address)
      VALUES ($1,'COLLECTOR-FINANCE-OTHER','Other','Collector','00000000','2000-01-01','Test')`, [otherCollector]);
    const results = await Promise.allSettled([
      repository.reassignUser(ids.collector, ids.replacement, ids.actor),
      repository.reassignUser(otherCollector, ids.replacement, ids.actor),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const [active] = await db.query(`SELECT COUNT(*)::int AS count FROM collector_user_assignments
      WHERE user_id=$1 AND ended_at IS NULL`, [ids.replacement]);
    expect(active.count).toBe(1);
  });
});
