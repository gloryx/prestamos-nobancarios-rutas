import { randomUUID } from 'node:crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import { LoanRefinancingUseCase, RefinancingConflictError, RefinancingValidationError, type RefinancingRequest } from '../src/application/loan-refinancing/refinancing.use-case';
import { RegisterPaymentUseCase, PaymentConflictError } from '../src/application/payment/payment.use-case';
import { GetLoanEditContextUseCase, LoanEditContextConflictError } from '../src/application/loan/loan-edit-context.use-case';
import { CreateLoanUseCase } from '../src/application/loan/loan.use-case';
import { cents, evaluateLoanFinancialIntegrity } from '../src/domain/loan/loan-financial-integrity';
import type { TransactionalCashMovementRecorder } from '../src/application/cash-movement/cash-movement.use-cases';
import type { RefinancingStore } from '../src/application/loan-refinancing/refinancing.port';
import { CashMovementOrmEntity, PaymentMethodOrmEntity, PermissionOrmEntity, RoleOrmEntity, RolePermissionOrmEntity, UserOrmEntity, UserSessionOrmEntity } from '../src/infrastructure/database/typeorm/entities';
import { CashMovementTypeOrmRepository } from '../src/infrastructure/database/typeorm/repositories/cash-movement.typeorm-repository';
import { LoanEditContextTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-edit-context.reader';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { LoanRefinancingTypeormStore } from '../src/infrastructure/database/typeorm/repositories/loan-refinancing.store';
import { CreateDta2026Tables1760000000000 } from '../src/infrastructure/database/typeorm/migrations/1760000000000-create-dta-2026-tables';
import { SimplifyDtaTerritorialKeys1760100000000 } from '../src/infrastructure/database/typeorm/migrations/1760100000000-simplify-dta-territorial-keys';

const suite = process.env.RUN_REFINANCING_POSTGRES === '1' ? describe : describe.skip;
const expectedDatabase = process.env.TEST_REFINANCING_PG_DATABASE ?? '';
const expectedPort = Number(process.env.TEST_REFINANCING_PG_PORT);
const zero = '0.00';

function guardedSource(): DataSource {
  if (process.env.TEST_REFINANCING_PG_HOST !== '127.0.0.1' ||
    !Number.isInteger(expectedPort) || expectedPort < 1024 || expectedPort === 5432 ||
    !/^prestamos_refinancing_test_[0-9]{8}$/.test(expectedDatabase) ||
    !/[/\\]Temp[/\\]opencode[/\\]refinancing-pg-[a-f0-9]{32}$/i.test(process.env.TEST_REFINANCING_PG_DIRECTORY ?? '')) {
    throw new Error('A newly created, isolated refinancing test cluster is required.');
  }
  return new DataSource({ type: 'postgres', host: '127.0.0.1', port: expectedPort,
    database: expectedDatabase, username: 'refinancing_test_admin', password: 'integration-only',
    entities: [CashMovementOrmEntity, PaymentMethodOrmEntity, UserOrmEntity, RoleOrmEntity,
      RolePermissionOrmEntity, PermissionOrmEntity, UserSessionOrmEntity],
    synchronize: false, migrationsRun: false, logging: false,
    extra: { max: 6, connectionTimeoutMillis: 5000, options: '-c search_path=public -c statement_timeout=10000' } });
}

suite('refinancing on an isolated PostgreSQL 18 cluster', () => {
  jest.setTimeout(45000);
  let db: DataSource;
  let refinancing: LoanRefinancingUseCase;
  let payment: RegisterPaymentUseCase;
  let cash: CashMovementTypeOrmRepository;
  const totals = new LoanFinancialTotalsTypeormReader();
  const ids = { role: randomUUID(), actor: randomUUID(), customer: randomUUID(), otherCustomer: randomUUID(),
    method: randomUUID(), frequency: randomUUID(), collector: randomUUID() };
  const day = new Date().toISOString().slice(0, 10);
  const later = (days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const invoice = (originLoanId: string, baseline: string, key: string, newMoney = zero,
    newInterestAmount = '20000.00', total = '170000.00'): RefinancingRequest => ({
    originLoanId, refinancingDate: day, newMoney, ...(newMoney !== zero ? { disbursementPaymentMethodId: ids.method } : {}),
    newInterestAmount, paymentFrequencyId: ids.frequency, preferredPaymentMethodId: ids.method,
    plan: [{ sequence: 1, dueDate: later(1), pendingAmount: String(Number(total) / 2) },
      { sequence: 2, dueDate: later(2), pendingAmount: String(Number(total) / 2) }],
    baseline, idempotencyKey: key,
  });
  async function newOrigin(customerId = ids.customer) {
    const [loan]: [{ id: string }] = await db.query(`INSERT INTO loans (customer_id, payment_frequency_id,
      preferred_payment_method_id, start_date, principal, interest_amount, total_amount, status, created_by_user_id)
      VALUES ($1,$2,$3,$4,150000,30000,180000,'ACTIVE',$5) RETURNING id`,
    [customerId, ids.frequency, ids.method, day, ids.actor]);
    await db.query(`INSERT INTO loan_status_history (loan_id,event_sequence,event_kind,from_status,to_status,changed_at,changed_by_user_id)
      VALUES ($1,1,'CREATED',NULL,'ACTIVE',now(),$2)`, [loan.id, ids.actor]);
    for (const [index, due] of [later(1), later(2)].entries()) await db.query(
      `INSERT INTO payment_plan_entries (loan_id,sequence,due_date,pending_amount) VALUES ($1,$2,$3,90000)`, [loan.id, index + 1, due]);
    return loan.id;
  }
  async function paidOrigin() {
    const id = await newOrigin();
    const receipt = await payment.execute({ loanId: id, amount: '30000.00', paymentDate: day,
      methodId: ids.method, collectorId: ids.collector, idempotencyKey: randomUUID() }, ids.actor);
    return { id, paymentId: receipt.id as string };
  }
  async function counts() {
    const [row]: [{ loans: number; refinancings: number; plan: number; disbursements: number; cash: number }] = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM loans) AS loans, (SELECT COUNT(*)::int FROM loan_refinancings) AS refinancings,
      (SELECT COUNT(*)::int FROM payment_plan_entries) AS plan, (SELECT COUNT(*)::int FROM loan_disbursements) AS disbursements,
      (SELECT COUNT(*)::int FROM cash_movements) AS cash`);
    return row;
  }
  async function assertIntegrity(id: string, balance: string, paidAmount: string) {
    const [loan] = await db.query(`SELECT principal::text, interest_amount::text AS "interestAmount",
      total_amount::text AS "totalAmount" FROM loans WHERE id=$1`, [id]);
    const [plan] = await db.query(`SELECT COALESCE(SUM(pending_amount),0)::text AS pending FROM payment_plan_entries WHERE loan_id=$1`, [id]);
    const actual = await totals.readValidTotals(db, id);
    expect(cents(actual!.paidAmount)).toBe(cents(paidAmount));
    if (paidAmount === zero) {
      expect(cents(actual!.paidPrincipal)).toBe(0n);
      expect(cents(actual!.paidInterest)).toBe(0n);
    }
    expect(evaluateLoanFinancialIntegrity(loan, actual!, cents(plan.pending))).toMatchObject({ valid: true,
      financialBalance: cents(balance), pendingPlanAmount: cents(plan.pending) });
  }

  beforeAll(async () => {
    db = guardedSource();
    await db.initialize();
    const [identity] = await db.query(`SELECT host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_database() AS database, current_setting('data_directory') AS directory`);
    if (identity.host !== '127.0.0.1' || identity.port !== expectedPort || identity.database !== expectedDatabase ||
      identity.directory.replace(/\\/g, '/').toLowerCase() !== process.env.TEST_REFINANCING_PG_DIRECTORY!.replace(/\\/g, '/').toLowerCase()) {
      throw new Error(`Refinancing PostgreSQL session identity mismatch: ${JSON.stringify(identity)}; expected directory ${process.env.TEST_REFINANCING_PG_DIRECTORY}.`);
    }
    const [state] = await db.query(`SELECT (SELECT COUNT(*)::int FROM migrations) AS migrations,
      (SELECT COUNT(*)::int FROM loans) AS loans, (SELECT COUNT(*)::int FROM payments) AS payments,
      (SELECT COUNT(*)::int FROM customers) AS customers, (SELECT COUNT(*)::int FROM loan_refinancings) AS refinancings`);
    if (Object.entries(state).some(([name, count]) => count !== (name === 'migrations' ? 21 : 0))) {
      throw new Error('Refinancing tests require all migrations and zero business rows.');
    }
    cash = new CashMovementTypeOrmRepository(db.getRepository(CashMovementOrmEntity), db);
    refinancing = new LoanRefinancingUseCase(new LoanRefinancingTypeormStore(db, totals, cash));
    payment = new RegisterPaymentUseCase(db, totals);
    await db.transaction(async (manager) => {
      await manager.query(`INSERT INTO roles (id,code,name) VALUES ($1,'REFINANCING_TEST','Refinancing Test')`, [ids.role]);
      await manager.query(`INSERT INTO users (id,username,full_name,password_hash,role_id)
        VALUES ($1,'refinancing_test_actor','TEST REFINANCING ACTOR','!disabled-test-account!',$2)`, [ids.actor, ids.role]);
      for (const [id, identification] of [[ids.customer, 'TEST-REFINANCING-A'], [ids.otherCustomer, 'TEST-REFINANCING-B']]) {
        await manager.query(`INSERT INTO customers (id,identification_type,identification,first_name,first_last_name,
          gender,birth_date,primary_phone,nationality)
          VALUES ($1,'NATIONAL',$2,'TEST REFINANCING','CUSTOMER','MALE','2000-01-01','00000000','COSTA_RICAN')`, [id, identification]);
      }
      await manager.query(`INSERT INTO payment_methods (id,name,display_order) VALUES ($1,'TEST REFINANCING METHOD',1)`, [ids.method]);
      await manager.query(`INSERT INTO collectors (id,identification,first_name,first_last_name,phone,birth_date,address,is_active)
        VALUES ($1,'TEST-REFINANCING-COLLECTOR','TEST','COLLECTOR','00000000','2000-01-01','TEST',true)`, [ids.collector]);
      await manager.query(`INSERT INTO payment_frequencies (id,name,interval_unit,interval_value,display_order)
        VALUES ($1,'TEST REFINANCING DAILY','DAY',1,1)`, [ids.frequency]);
      await manager.query(`INSERT INTO financial_openings (opening_date,initial_available_amount,initial_portfolio,
        initial_uncollectible_amount,historical_seed_capital,opened_by_user_id)
        VALUES ($1,1000000,0,0,0,$2)`, [day, ids.actor]);
    });
  });
  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

  it('regresses empty DTA migration without using preexisting production data', async () => {
    const runner = db.createQueryRunner();
    await runner.connect(); await runner.startTransaction();
    try {
      const schema = `refinancing_migration_${randomUUID().replace(/-/g, '')}`;
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET LOCAL search_path TO "${schema}"`);
      await new CreateDta2026Tables1760000000000().up(runner);
      await new SimplifyDtaTerritorialKeys1760100000000().up(runner);
      const [state] = await runner.query('SELECT COUNT(*)::int AS provinces FROM provinces');
      expect(state.provinces).toBe(0);
    } finally { await runner.rollbackTransaction(); await runner.release(); }
  });

  it('checks the migrated keys, money, chain, cash and permission constraints in pg_catalog', async () => {
    const constraints: Array<{ conname: string; contype: string }> = await db.query(`SELECT conname, contype
      FROM pg_constraint WHERE conrelid = 'loan_refinancings'::regclass`);
    for (const [name, type] of [['FK_refinancing_origin','f'],['FK_refinancing_successor','f'],
      ['UQ_refinancing_origin','u'],['UQ_refinancing_successor','u'],['UQ_refinancing_key','u'],
      ['CHK_refinancing_amounts','c'],['CHK_refinancing_distinct','c']]) {
      expect(constraints).toContainEqual({ conname: name, contype: type });
    }
    const triggers: Array<{ tgname: string }> = await db.query(`SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'loan_refinancings'::regclass AND NOT tgisinternal`);
    expect(triggers.map(({ tgname }) => tgname)).toEqual(expect.arrayContaining(['trg_refinancing_chain','trg_refinancing_immutable']));
    const [cashCheck] = await db.query(`SELECT pg_get_constraintdef(oid) AS rule FROM pg_constraint
      WHERE conrelid = 'cash_movements'::regclass AND conname = 'CHK_cash_loan_disbursement_pair'`);
    expect(cashCheck.rule).toContain('REFINANCING_NEW_MONEY_DISBURSEMENT');
    const permissions = await db.query(`SELECT code FROM permissions WHERE code LIKE 'loans.refinance.%'`);
    expect(permissions.map((row: { code: string }) => row.code).sort()).toEqual(['loans.refinance.create','loans.refinance.view']);
    const [grants] = await db.query(`SELECT COUNT(*)::int AS count FROM role_permissions`);
    expect(grants.count).toBe(0);
  });

  let caseA: { origin: string; successor: string; paymentId: string; refinancingId: string };
  it('persists the 150000/30000 case with 30000 capital-first payment and only 50000 of new cash', async () => {
    const { id, paymentId } = await paidOrigin();
    const historical = await db.query(`SELECT row_to_json(p)::text AS value FROM payments p WHERE id=$1`, [paymentId]);
    const applied = await db.query(`SELECT row_to_json(pa)::text AS value FROM payment_applications pa WHERE payment_id=$1`, [paymentId]);
    const originalPlan = await db.query(`SELECT id,pending_amount::text AS amount FROM payment_plan_entries WHERE loan_id=$1 ORDER BY sequence`, [id]);
    const preview = await refinancing.preview(id);
    expect(preview).toMatchObject({ eligible: true, paidAmount: '30000.00', paidPrincipal: '30000.00', paidInterest: zero,
      outstandingPrincipal: '120000.00', outstandingInterest: '30000.00', financialBalance: '150000.00' });
    const request = invoice(id, preview.baseline, randomUUID(), '50000.00', '40000.00', '240000.00');
    const receipt = await refinancing.confirm(request, ids.actor);
    caseA = { origin: id, successor: receipt.newLoanId, paymentId, refinancingId: receipt.id };
    expect(receipt).toMatchObject({ originStatus: 'REFINANCED', newStatus: 'ACTIVE',
      outstandingPrincipalTransferred: '120000.00', capitalizedOutstandingInterest: '30000.00',
      newMoneyDisbursed: '50000.00', newContractualPrincipal: '200000.00',
      newInterestAmount: '40000.00', newContractualTotal: '240000.00',
      disbursementAmount: '50000.00', cashAmount: '50000.00', cashDirection: 'OUTFLOW' });
    const [successor] = await db.query(`SELECT status,principal::text,interest_amount::text AS interest,
      total_amount::text AS total,customer_id FROM loans WHERE id=$1`, [receipt.newLoanId]);
    expect(successor).toMatchObject({ status: 'ACTIVE', principal: '200000.00', interest: '40000.00',
      total: '240000.00', customer_id: ids.customer });
    const [origin] = await db.query('SELECT status FROM loans WHERE id=$1', [id]);
    expect(origin.status).toBe('REFINANCED');
    const [operation] = await db.query(`SELECT origin_loan_id,new_loan_id,
      outstanding_principal_transferred::text,capitalized_outstanding_interest::text,
      new_money_disbursed::text,new_contractual_principal::text,new_interest_amount::text,new_contractual_total::text
      FROM loan_refinancings WHERE id=$1`, [receipt.id]);
    expect(operation).toMatchObject({ origin_loan_id: id, new_loan_id: receipt.newLoanId,
      outstanding_principal_transferred: '120000.00', capitalized_outstanding_interest: '30000.00',
      new_money_disbursed: '50000.00', new_contractual_principal: '200000.00',
      new_interest_amount: '40000.00', new_contractual_total: '240000.00' });
    const [pair] = await db.query(`SELECT d.amount::text AS disbursement,m.amount::text AS cash,
      m.direction,m.concept,d.disbursement_date::text AS date,m.movement_date::text AS cash_date,
      m.payment_method_id AS method FROM loan_disbursements d JOIN cash_movements m ON m.loan_disbursement_id=d.id
      WHERE d.loan_id=$1`, [receipt.newLoanId]);
    expect(pair).toMatchObject({ disbursement: '50000.00', cash: '50000.00', direction: 'OUTFLOW',
      concept: 'REFINANCING_NEW_MONEY_DISBURSEMENT', date: day, cash_date: day, method: ids.method });
    const [movements] = await db.query(`SELECT COUNT(*)::int AS outflows,
      COUNT(*) FILTER (WHERE amount <> 50000)::int AS wrong_amounts FROM cash_movements
      WHERE concept='REFINANCING_NEW_MONEY_DISBURSEMENT'`);
    expect(movements).toEqual({ outflows: 1, wrong_amounts: 0 });
    const [disbursements] = await db.query(`SELECT COUNT(*)::int AS count FROM loan_disbursements WHERE loan_id=$1`, [receipt.newLoanId]);
    expect(disbursements.count).toBe(1);
    const rows = await db.query(`SELECT sequence,due_date::text,pending_amount::text FROM payment_plan_entries WHERE loan_id=$1 ORDER BY sequence`, [receipt.newLoanId]);
    expect(rows).toEqual([{ sequence: 1, due_date: later(1), pending_amount: '120000.00' },
      { sequence: 2, due_date: later(2), pending_amount: '120000.00' }]);
    expect(await db.query(`SELECT id,pending_amount::text AS amount FROM payment_plan_entries WHERE loan_id=$1 ORDER BY sequence`, [id])).toEqual(originalPlan);
    expect(await db.query(`SELECT row_to_json(p)::text AS value FROM payments p WHERE id=$1`, [paymentId])).toEqual(historical);
    expect(await db.query(`SELECT row_to_json(pa)::text AS value FROM payment_applications pa WHERE payment_id=$1`, [paymentId])).toEqual(applied);
    const [cashIncome] = await db.query(`SELECT COUNT(*)::int AS count FROM cash_movements WHERE concept='CUSTOMER_PAYMENT' AND payment_id=$1`, [paymentId]);
    expect(cashIncome.count).toBe(1); // Created by the original payment, not by refinancing.
    const [paidInterest] = await db.query(`SELECT COALESCE(SUM(interest_applied),0)::text AS amount FROM payments WHERE loan_id=$1`, [id]);
    expect(paidInterest.amount).toBe(zero);
    const statuses = await db.query(`SELECT loan_id,event_sequence,event_kind,from_status,to_status,
      changed_by_user_id,changed_at,reason FROM loan_status_history WHERE loan_id IN ($1,$2)
      ORDER BY loan_id,event_sequence`, [id, receipt.newLoanId]);
    expect(statuses.filter((row: { loan_id: string }) => row.loan_id === id)).toMatchObject([
      { event_sequence: 1, event_kind: 'CREATED', to_status: 'ACTIVE', changed_by_user_id: ids.actor },
      { event_sequence: 2, event_kind: 'TRANSITION', from_status: 'ACTIVE', to_status: 'REFINANCED',
        changed_by_user_id: ids.actor, reason: `Refinancing ${receipt.id}` },
    ]);
    expect(statuses.filter((row: { loan_id: string }) => row.loan_id === receipt.newLoanId)).toMatchObject([
      { event_sequence: 1, event_kind: 'CREATED', to_status: 'ACTIVE', changed_by_user_id: ids.actor },
    ]);
    expect(statuses.every((row: { changed_at: Date }) => Boolean(row.changed_at))).toBe(true);
    await assertIntegrity(id, '150000.00', '30000.00');
    await assertIntegrity(receipt.newLoanId, '240000.00', zero);
    expect(await refinancing.detail(receipt.id)).toMatchObject({ disbursementAmount: '50000.00', cashAmount: '50000.00' });
  });

  let caseB: { origin: string; successor: string; paymentId: string; refinancingId: string };
  it('confirms zero new money with no disbursement or outflow and readable detail', async () => {
    const { id, paymentId } = await paidOrigin();
    const preview = await refinancing.preview(id);
    const before = await counts();
    const receipt = await refinancing.confirm(invoice(id, preview.baseline, randomUUID()), ids.actor);
    caseB = { origin: id, successor: receipt.newLoanId, paymentId, refinancingId: receipt.id };
    expect(receipt).toMatchObject({ originStatus: 'REFINANCED', newStatus: 'ACTIVE',
      outstandingPrincipalTransferred: '120000.00', capitalizedOutstandingInterest: '30000.00',
      newMoneyDisbursed: zero, newContractualPrincipal: '150000.00',
      newInterestAmount: '20000.00', newContractualTotal: '170000.00',
      disbursementId: null, cashMovementId: null });
    const after = await counts();
    expect(after).toMatchObject({ loans: before.loans + 1, refinancings: before.refinancings + 1,
      plan: before.plan + 2, disbursements: before.disbursements, cash: before.cash });
    const [newLoan] = await db.query(`SELECT principal::text,interest_amount::text AS interest,total_amount::text AS total,
      status FROM loans WHERE id=$1`, [receipt.newLoanId]);
    expect(newLoan).toMatchObject({ principal: '150000.00', interest: '20000.00', total: '170000.00', status: 'ACTIVE' });
    const [plan] = await db.query(`SELECT SUM(pending_amount)::text AS sum, COUNT(*)::int AS count,
      bool_and(pending_amount>0) AS positive FROM payment_plan_entries WHERE loan_id=$1`, [receipt.newLoanId]);
    expect(plan).toEqual({ sum: '170000.00', count: 2, positive: true });
    expect(await refinancing.detail(receipt.id)).toMatchObject({ disbursementId: null, cashMovementId: null });
    expect((await refinancing.chain(receipt.newLoanId)).loans.map((row) => row.loanId)).toEqual([id, receipt.newLoanId]);
    const detail = await new CreateLoanUseCase(db, cash).get(receipt.newLoanId);
    expect(detail).toMatchObject({ status: 'ACTIVE', pendingTotal: '170000.00', disbursementPaymentMethod: null });
    await assertIntegrity(receipt.newLoanId, '170000.00', zero);
  });

  it('replays one operation for the same key/payload and rejects a changed payload without a duplicate', async () => {
    const { id } = await paidOrigin();
    const original = invoice(id, (await refinancing.preview(id)).baseline, randomUUID(), '50000.00', '40000.00', '240000.00');
    const first = await refinancing.confirm(original, ids.actor);
    const before = await counts();
    const replay = await refinancing.confirm(original, ids.actor);
    expect(replay).toMatchObject({ id: first.id, newLoanId: first.newLoanId });
    expect(await counts()).toEqual(before);
    await expect(refinancing.confirm({ ...original, observations: 'CHANGED' }, ids.actor))
      .rejects.toMatchObject({ reasonCode: 'IDEMPOTENCY_CONFLICT' });
    expect(await counts()).toEqual(before);
  });

  it('rejects a baseline stale after a real new payment, with no partial write', async () => {
    const { id } = await paidOrigin();
    const baseline = (await refinancing.preview(id)).baseline;
    await payment.execute({ loanId: id, amount: '1000.00', paymentDate: day, methodId: ids.method, collectorId: ids.collector,
      idempotencyKey: randomUUID() }, ids.actor);
    const before = await counts();
    await expect(refinancing.confirm(invoice(id, baseline, randomUUID(), '50000.00', '40000.00', '240000.00'), ids.actor))
      .rejects.toMatchObject({ reasonCode: 'STALE_DATA' });
    expect(await counts()).toEqual(before);
    const [origin] = await db.query('SELECT status FROM loans WHERE id=$1', [id]);
    expect(origin.status).toBe('ACTIVE');
  });

  it('serializes two real PostgreSQL transactions on one origin and writes one successor only', async () => {
    const { id } = await paidOrigin();
    const baseline = (await refinancing.preview(id)).baseline;
    const before = await counts();
    const [first, second] = await Promise.allSettled([
      refinancing.confirm(invoice(id, baseline, randomUUID(), '50000.00', '40000.00', '240000.00'), ids.actor),
      refinancing.confirm(invoice(id, baseline, randomUUID(), '50000.00', '40000.00', '240000.00'), ids.actor),
    ]);
    const results = [first, second];
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((row) => row.status === 'rejected')).toHaveLength(1);
    expect((results.find((row) => row.status === 'rejected') as PromiseRejectedResult).reason)
      .toBeInstanceOf(RefinancingConflictError);
    const after = await counts();
    expect(after).toMatchObject({ loans: before.loans + 1, refinancings: before.refinancings + 1,
      disbursements: before.disbursements + 1, cash: before.cash + 1 });
    const [links] = await db.query(`SELECT COUNT(*)::int AS count FROM loan_refinancings WHERE origin_loan_id=$1`, [id]);
    expect(links.count).toBe(1);
  });

  it('rolls back the origin transition and new plan if the real transaction cash adapter fails', async () => {
    const { id } = await paidOrigin();
    const brokenCash = { recordWithManager: async () => { throw new Error('SYNTHETIC_CASH_FAILURE'); } } as unknown as TransactionalCashMovementRecorder;
    const useCase = new LoanRefinancingUseCase(new LoanRefinancingTypeormStore(db, totals, brokenCash));
    const before = await counts();
    await expect(useCase.confirm(invoice(id, (await useCase.preview(id)).baseline, randomUUID(),
      '50000.00', '40000.00', '240000.00'), ids.actor)).rejects.toThrow('SYNTHETIC_CASH_FAILURE');
    expect(await counts()).toEqual(before);
    expect((await db.query('SELECT status FROM loans WHERE id=$1', [id]))[0].status).toBe('ACTIVE');
  });

  it('rolls back a controlled plan insert failure after creating the successor', async () => {
    const { id } = await paidOrigin();
    const adapter = new LoanRefinancingTypeormStore(db, totals, cash);
    const broken = Object.create(adapter) as RefinancingStore;
    broken.transaction = (work) => adapter.transaction((tx) => work({ ...tx,
      insertPlan: async () => { throw new Error('SYNTHETIC_PLAN_FAILURE'); } }));
    const useCase = new LoanRefinancingUseCase(broken);
    const before = await counts();
    await expect(useCase.confirm(invoice(id, (await useCase.preview(id)).baseline, randomUUID()), ids.actor))
      .rejects.toThrow('SYNTHETIC_PLAN_FAILURE');
    expect(await counts()).toEqual(before);
    expect((await db.query('SELECT status FROM loans WHERE id=$1', [id]))[0].status).toBe('ACTIVE');
    const badPlan = invoice(id, (await refinancing.preview(id)).baseline, randomUUID());
    badPlan.plan[0].pendingAmount = zero;
    await expect(refinancing.confirm(badPlan, ids.actor)).rejects.toBeInstanceOf(RefinancingValidationError);
    expect(await counts()).toEqual(before);
  });

  it('rejects a second successor, reused successor, cross-customer edge, broken money and a cycle in PostgreSQL', async () => {
    const insert = (origin: string, successor: string, key = randomUUID(), total = '1.00') => db.query(`INSERT INTO loan_refinancings
      (origin_loan_id,new_loan_id,outstanding_principal_transferred,capitalized_outstanding_interest,
      new_money_disbursed,new_interest_amount,new_contractual_principal,new_contractual_total,
      refinancing_date,created_by_user_id,idempotency_key,idempotency_fingerprint)
      VALUES ($1,$2,1,0,0,0,1,$3,$4,$5,$6,'synthetic')`, [origin, successor, total, day, ids.actor, key]);
    const freeA = await newOrigin();
    const freeB = await newOrigin();
    const other = await newOrigin(ids.otherCustomer);
    const before = await counts();
    await expect(insert(caseA.origin, freeA)).rejects.toMatchObject({ driverError: { code: '23505', constraint: 'UQ_refinancing_origin' } });
    await expect(insert(freeA, caseA.successor)).rejects.toMatchObject({ driverError: { code: '23505', constraint: 'UQ_refinancing_successor' } });
    await expect(insert(freeA, other)).rejects.toThrow('Refinancing loans must belong to the same customer');
    await expect(insert(freeA, freeB, randomUUID(), '2.00')).rejects.toMatchObject({ driverError: { constraint: 'CHK_refinancing_amounts' } });
    expect(await counts()).toEqual(before);
  });

  it('builds a real A → B → C chain and rejects C → A at the database trigger', async () => {
    await payment.execute({ loanId: caseA.successor, amount: '40000.00', paymentDate: day,
      methodId: ids.method, collectorId: ids.collector, idempotencyKey: randomUUID() }, ids.actor);
    const quote = await refinancing.preview(caseA.successor);
    expect(quote.eligible).toBe(true);
    const receipt = await refinancing.confirm(invoice(caseA.successor, quote.baseline, randomUUID(), zero, '10000.00', '210000.00'), ids.actor);
    const expected = [caseA.origin, caseA.successor, receipt.newLoanId];
    for (const id of expected) {
      const rows = await refinancing.chain(id);
      expect(rows.loans.map((row) => row.loanId)).toEqual(expected);
      expect(rows.transitions).toHaveLength(2);
    }
    const before = await counts();
    await expect(db.query(`INSERT INTO loan_refinancings
      (origin_loan_id,new_loan_id,outstanding_principal_transferred,capitalized_outstanding_interest,
      new_money_disbursed,new_interest_amount,new_contractual_principal,new_contractual_total,
      refinancing_date,created_by_user_id,idempotency_key,idempotency_fingerprint)
      VALUES ($1,$2,1,0,0,0,1,1,$3,$4,$5,'synthetic')`,
    [receipt.newLoanId, caseA.origin, day, ids.actor, randomUUID()])).rejects.toThrow('Refinancing cycle is not allowed');
    expect(await counts()).toEqual(before);
  });

  it('protects historical payment annulment and ordinary edit of a REFINANCED origin', async () => {
    const before = await db.query('SELECT row_to_json(p)::text AS value FROM payments p WHERE id=$1', [caseB.paymentId]);
    const applications = await db.query(`SELECT row_to_json(pa)::text AS value FROM payment_applications pa WHERE payment_id=$1`, [caseB.paymentId]);
    const successor = await db.query('SELECT row_to_json(l)::text AS value FROM loans l WHERE id=$1', [caseB.successor]);
    await expect(payment.annul(caseB.paymentId, 'TEST forbidden historical annulment', randomUUID(), ids.actor))
      .rejects.toBeInstanceOf(PaymentConflictError);
    const edit = new GetLoanEditContextUseCase(new LoanEditContextTypeormReader(db, totals));
    await expect(edit.execute(caseB.origin)).rejects.toBeInstanceOf(LoanEditContextConflictError);
    expect(await db.query('SELECT row_to_json(p)::text AS value FROM payments p WHERE id=$1', [caseB.paymentId])).toEqual(before);
    expect(await db.query(`SELECT row_to_json(pa)::text AS value FROM payment_applications pa WHERE payment_id=$1`, [caseB.paymentId])).toEqual(applications);
    expect(await db.query('SELECT row_to_json(l)::text AS value FROM loans l WHERE id=$1', [caseB.successor])).toEqual(successor);
  });
});
