import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { RegisterPaymentUseCase } from '../src/application/payment/payment.use-case';
import { EditLoanUseCase, LoanEditConflictError, LoanEditValidationError, type LoanEditWriter } from '../src/application/loan/edit-loan.use-case';
import { normalizeLoanEditCommand } from '../src/application/loan/loan-edit.command';
import { cents, evaluateLoanFinancialIntegrity } from '../src/domain/loan/loan-financial-integrity';
import type { LoanEditBaseline, LoanEditInput } from '../src/domain/loan/loan-edit.types';
import { CashMovementOrmEntity } from '../src/infrastructure/database/typeorm/entities/cash-movement.orm-entity';
import { PaymentMethodOrmEntity } from '../src/infrastructure/database/typeorm/entities/payment-method.orm-entity';
import { PermissionOrmEntity } from '../src/infrastructure/database/typeorm/entities/permission.orm-entity';
import { RoleOrmEntity } from '../src/infrastructure/database/typeorm/entities/role.orm-entity';
import { RolePermissionOrmEntity } from '../src/infrastructure/database/typeorm/entities/role-permission.orm-entity';
import { UserOrmEntity } from '../src/infrastructure/database/typeorm/entities/user.orm-entity';
import { UserSessionOrmEntity } from '../src/infrastructure/database/typeorm/entities/user-session.orm-entity';
import { CashMovementTypeOrmRepository } from '../src/infrastructure/database/typeorm/repositories/cash-movement.typeorm-repository';
import { EditLoanTypeormWriter } from '../src/infrastructure/database/typeorm/repositories/edit-loan.writer';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';

const suite = process.env.RUN_LOAN_EDIT_B51_POSTGRES === '1' ? describe : describe.skip;
const database = 'prestamos_nobancarios';
const tables = ['migrations', 'roles', 'role_permissions', 'users', 'user_sessions', 'customers', 'customer_addresses',
  'payment_methods', 'payment_frequencies', 'financial_openings', 'loans', 'loan_status_history', 'loan_disbursements',
  'payment_plan_entries', 'payments', 'payment_applications', 'payment_annulments', 'cash_movements', 'loan_edit_operations'];
function fixture() {
  const tag = randomUUID();
  const day = new Date().toISOString().slice(0, 10);
  const due = (days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  return { tag, day, due: [due(1), due(32)] as const, role: randomUUID(), actor: randomUUID(), customer: randomUUID(),
    method: randomUUID(), frequency: randomUUID(), loan: randomUUID(), disbursement: randomUUID(),
    plan: [randomUUID(), randomUUID()] as const,
    number: (100_000_000_000_000n + BigInt(`0x${randomBytes(6).toString('hex')}`)).toString(),
    payments: [`b51-p1-${tag}`, `b51-p2-${tag}`, `b51-race-${tag}`] as const,
    edits: [`b51-a-${tag}`, `b51-b-${tag}`, `b51-c-${tag}`, `b51-d-${tag}`, `b51-stale-${tag}`, `b51-race-edit-${tag}`, `b51-after-annul-${tag}`] as const,
    annul: `b51-annul-${tag}` };
}
type Fixture = ReturnType<typeof fixture>;

function guardedSource(): DataSource {
  if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST ?? '')
    || process.env.DB_PORT !== '5432' || process.env.DB_DATABASE !== database
    || !process.env.DB_USERNAME || !process.env.DB_PASSWORD) throw new Error('B5.1 requires explicit approved loopback process credentials.');
  return new DataSource({ type: 'postgres', host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : process.env.DB_HOST,
    port: 5432, database, username: process.env.DB_USERNAME, password: process.env.DB_PASSWORD,
    entities: [CashMovementOrmEntity, PaymentMethodOrmEntity, UserOrmEntity, RoleOrmEntity,
      RolePermissionOrmEntity, PermissionOrmEntity, UserSessionOrmEntity],
    synchronize: false, migrationsRun: false, logging: false,
    extra: { max: 4, connectionTimeoutMillis: 3000,
      options: '-c search_path=public -c statement_timeout=8000 -c idle_in_transaction_session_timeout=9000' } });
}

async function preflight(db: DataSource, f: Fixture): Promise<void> {
  const [identity] = await db.query(`SELECT host(inet_server_addr()) AS address, inet_server_port() AS port,
    current_database() AS database, current_schema() AS schema, current_setting('search_path') AS path`);
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(identity.address) || identity.port !== 5432
    || identity.database !== database || identity.schema !== 'public' || identity.path !== 'public') throw new Error('B5.1 rejected the database identity.');
  const [shape] = await db.query(`SELECT COUNT(*)::int AS count FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`, [tables]);
  const [migrations] = await db.query(`SELECT COUNT(*)::int AS count FROM public.migrations WHERE (timestamp, name) IN
    ((1760800000000, 'CustomerSiteSecurity1760800000000'), (1761100000000, 'CreateFinancialOpenings1761100000000'), (1761200000000, 'CreateCashMovements1761200000000'),
     (1761300000000, 'CreateLoans1761300000000'), (1761400000000, 'CreatePayments1761400000000'),
     (1761500000000, 'CreateLoanStatusHistory1761500000000'),
     (1761600000000, 'AddLoanStatusHistorySequence1761600000000'),
     (1761700000000, 'CreateLoanEditOperations1761700000000'))`);
  const [opening] = await db.query(`SELECT COUNT(*)::int AS count FROM public.financial_openings
    WHERE singleton_key = 'DEFAULT' AND opening_date <= CURRENT_DATE AND opening_date <= $1::date`, [f.day]);
  const [counts] = await db.query(`SELECT (SELECT COUNT(*)::int FROM public.loans) AS loans,
    (SELECT COUNT(*)::int FROM public.payments) AS payments`);
  if (shape.count !== tables.length || migrations.count !== 8 || opening.count !== 1
    || counts.loans !== 14 || counts.payments !== 17) throw new Error('B5.1 rejected schema, opening or original row counts.');
}

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('B5.1 concurrent work timed out')), milliseconds);
  })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function setup(manager: EntityManager, db: DataSource, f: Fixture): Promise<void> {
  await manager.query('INSERT INTO public.roles (id, code, name) VALUES ($1,$2,$3)', [f.role, `B51_${f.tag}`, `B51 ${f.tag}`]);
  await manager.query(`INSERT INTO public.users (id, username, full_name, password_hash, role_id)
    VALUES ($1,$2,'B5.1 Fixture','!disabled-test-account!',$3)`, [f.actor, `b51_${f.tag}`, f.role]);
  await manager.query(`INSERT INTO public.customers (id, identification_type, identification, first_name, first_last_name,
    gender, birth_date, primary_phone, nationality) VALUES ($1,'NATIONAL',$2,'Test','Fixture','MALE','2000-01-01','00000000','COSTA_RICAN')`,
  [f.customer, `b51_${f.tag}`]);
  await manager.query('INSERT INTO public.payment_methods (id, name, display_order) VALUES ($1,$2,1)', [f.method, `B51 method ${f.tag}`]);
  await manager.query(`INSERT INTO public.payment_frequencies (id, name, interval_unit, interval_value, display_order)
    VALUES ($1,$2,'MONTH',1,1)`, [f.frequency, `B51 frequency ${f.tag}`]);
  // Explicit number avoids advancing the shared, non-rollbackable loan sequence.
  await manager.query(`INSERT INTO public.loans (id, loan_number, customer_id, payment_frequency_id,
    preferred_payment_method_id, start_date, principal, interest_amount, total_amount, observations,
    status, created_by_user_id, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,100,20,120,'ORIGINAL','ACTIVE',$7,$8)`,
  [f.loan, f.number, f.customer, f.frequency, f.method, f.day, f.actor, `b51-loan-${f.tag}`]);
  await manager.query(`INSERT INTO public.loan_status_history (loan_id, event_sequence, event_kind, from_status,
    to_status, changed_at, changed_by_user_id) VALUES ($1,1,'CREATED',NULL,'ACTIVE',now(),$2)`, [f.loan, f.actor]);
  for (const [i, id] of f.plan.entries()) await manager.query(`INSERT INTO public.payment_plan_entries
    (id, loan_id, sequence, due_date, pending_amount) VALUES ($1,$2,$3,$4,60)`, [id, f.loan, i + 1, f.due[i]]);
  await manager.query(`INSERT INTO public.loan_disbursements (id, loan_id, amount, payment_method_id,
    disbursement_date, created_by_user_id) VALUES ($1,$2,100,$3,$4,$5)`, [f.disbursement, f.loan, f.method, f.day, f.actor]);
  const cash = new CashMovementTypeOrmRepository(db.getRepository(CashMovementOrmEntity), db);
  const movement = await cash.recordWithManager(manager, { direction: 'OUTFLOW', concept: 'LOAN_DISBURSEMENT',
    amount: '100.00', movementDate: f.day, paymentMethodId: f.method, observations: `B5.1 disbursement ${f.tag}`,
    loanDisbursementId: f.disbursement, createdByUserId: f.actor, idempotencyKey: `loan-disbursement:${f.disbursement}`,
    idempotencyFingerprint: createHash('sha256').update(`${f.disbursement}:100.00`).digest('hex') });
  expect(movement).toMatchObject({ loanDisbursementId: f.disbursement, amount: '100.00' });
}

async function snapshot(db: DataSource, f: Fixture) {
  const read = async (table: string, predicate: string, args: unknown[]) =>
    (await db.query(`SELECT row_to_json(t)::text AS value FROM public.${table} t WHERE ${predicate} ORDER BY t.id`, args) as { value: string }[])
      .map((row) => row.value);
  const payments = 'SELECT p.id FROM public.payments p WHERE p.loan_id = $1';
  return {
    loan: await read('loans', 't.id = $1', [f.loan]),
    plan: await read('payment_plan_entries', 't.loan_id = $1', [f.loan]),
    payments: await read('payments', 't.loan_id = $1 OR t.created_by_user_id = $2', [f.loan, f.actor]),
    applications: await read('payment_applications', `t.payment_id IN (${payments}) OR t.payment_plan_entry_id = ANY($2::uuid[])`, [f.loan, f.plan]),
    cash: await read('cash_movements', 't.created_by_user_id = $1 OR t.loan_disbursement_id = $2', [f.actor, f.disbursement]),
    disbursements: await read('loan_disbursements', 't.loan_id = $1 OR t.created_by_user_id = $2', [f.loan, f.actor]),
    status: await read('loan_status_history', 't.loan_id = $1 OR t.changed_by_user_id = $2', [f.loan, f.actor]),
    annulments: await read('payment_annulments', `t.payment_id IN (${payments}) OR t.created_by_user_id = $2`, [f.loan, f.actor]),
    receipts: await read('loan_edit_operations', 't.loan_id = $1 OR t.created_by_user_id = $2', [f.loan, f.actor]),
  };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
function historyUnchanged(before: Snapshot, after: Snapshot): void {
  for (const table of ['payments', 'applications', 'cash', 'disbursements', 'status', 'annulments'] as const)
    expect(after[table]).toEqual(before[table]);
  expect(Number(JSON.parse(after.loan[0])?.principal).toFixed(2)).toBe('100.00');
}
async function integrity(db: DataSource, f: Fixture, paid: string, interest: string, balance: string): Promise<void> {
  const [loan] = await db.query(`SELECT principal::text, interest_amount::text AS "interestAmount",
    total_amount::text AS "totalAmount", status FROM public.loans WHERE id = $1`, [f.loan]);
  const totals = await new LoanFinancialTotalsTypeormReader().readValidTotals(db, f.loan);
  const [plan] = await db.query(`SELECT COALESCE(SUM(pending_amount),0)::text AS pending
    FROM public.payment_plan_entries WHERE loan_id = $1`, [f.loan]);
  expect(loan).toMatchObject({ principal: '100.00', interestAmount: interest, status: 'ACTIVE' });
  expect(totals).toMatchObject({ paidAmount: paid, paidPrincipal: paid === '50.00' ? '50.00' : '100.00',
    paidInterest: paid === '50.00' ? '0.00' : paid === '105.00' ? '5.00' : '6.00', invalidCount: 0 });
  expect(evaluateLoanFinancialIntegrity(loan, totals!, cents(plan.pending))).toMatchObject({ valid: true, financialBalance: cents(balance) });
}
function baseline(f: Fixture, interest: string, balance: string, pending: string, original = false): LoanEditBaseline {
  return { interestAmount: interest, paymentFrequencyId: f.frequency, preferredPaymentMethodId: f.method,
    observations: 'ORIGINAL', financialBalance: balance, plan: original
      ? [{ id: f.plan[0], dueDate: f.due[0], pendingAmount: '60.00' }, { id: f.plan[1], dueDate: f.due[1], pendingAmount: '60.00' }]
      : [{ id: f.plan[1], dueDate: f.due[1], pendingAmount: pending }] };
}
function edit(f: Fixture, key: string, base: LoanEditBaseline, interest: string, pending: string): LoanEditInput {
  return { idempotencyKey: key, baseline: base, changes: { interestAmount: interest },
    plan: [{ id: f.plan[1], dueDate: f.due[1], pendingAmount: pending }] };
}

function affected(result: unknown): number {
  return Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === 'number' ? result[1] : -1;
}
async function verifyAbsent(db: DataSource, f: Fixture): Promise<void> {
  const [row] = await db.query(`SELECT (SELECT COUNT(*)::int FROM public.loans) AS loans,
    (SELECT COUNT(*)::int FROM public.payments) AS payments,
    (SELECT COUNT(*)::int FROM public.loans WHERE id = $1 OR idempotency_key = $7) AS owned_loan,
    (SELECT COUNT(*)::int FROM public.roles WHERE id = $2) AS role,
    (SELECT COUNT(*)::int FROM public.users WHERE id = $3) AS actor,
    (SELECT COUNT(*)::int FROM public.customers WHERE id = $4) AS customer,
    (SELECT COUNT(*)::int FROM public.payment_methods WHERE id = $5) AS method,
    (SELECT COUNT(*)::int FROM public.payment_frequencies WHERE id = $6) AS frequency,
    (SELECT COUNT(*)::int FROM public.loan_disbursements WHERE id = $8) AS disbursement,
    (SELECT COUNT(*)::int FROM public.payments WHERE idempotency_key = ANY($9::text[])) AS owned_payments,
    (SELECT COUNT(*)::int FROM public.loan_edit_operations WHERE idempotency_key = ANY($10::text[])) AS owned_edits,
    (SELECT COUNT(*)::int FROM public.payment_annulments WHERE idempotency_key = $11) AS owned_annulment,
    (SELECT COUNT(*)::int FROM public.cash_movements WHERE created_by_user_id = $3 OR loan_disbursement_id = $8 OR idempotency_key = ANY($13::text[])) AS owned_cash,
    (SELECT COUNT(*)::int FROM public.payment_plan_entries WHERE id = ANY($12::uuid[])) AS owned_plan`,
  [f.loan, f.role, f.actor, f.customer, f.method, f.frequency, `b51-loan-${f.tag}`, f.disbursement, f.payments, f.edits, f.annul, f.plan,
    [`loan-disbursement:${f.disbursement}`, ...f.payments.map((key) => `payment:${key}`), `payment-annulment:${f.annul}`]]);
  if (Object.entries(row).some(([name, count]) => count !== (name === 'loans' ? 14 : name === 'payments' ? 17 : 0)))
    throw new Error('B5.1 original counts or owned-marker cleanup differ.');
}

async function cleanup(db: DataSource, f: Fixture, committed: boolean): Promise<void> {
  const [marker] = await db.query(`SELECT COUNT(*)::int AS count FROM public.loans
    WHERE id = $1 AND loan_number = $2 AND idempotency_key = $3`, [f.loan, f.number, `b51-loan-${f.tag}`]);
  if (marker.count !== 1) {
    if (committed) throw new Error('B5.1 fixture ownership changed; cleanup refused.');
    await verifyAbsent(db, f);
    return;
  }
  await db.transaction(async (manager) => {
    for (const [table, id] of [['roles', f.role], ['users', f.actor], ['customers', f.customer],
      ['payment_methods', f.method], ['payment_frequencies', f.frequency], ['loans', f.loan]] as const) {
      if ((await manager.query(`SELECT id FROM public.${table} WHERE id = $1 FOR UPDATE`, [id])).length !== 1)
        throw new Error('B5.1 fixture root changed; cleanup refused.');
    }
    const [root] = await manager.query(`SELECT loan_number::text AS number, customer_id, payment_frequency_id,
      preferred_payment_method_id, created_by_user_id, idempotency_key, principal::text, status
      FROM public.loans WHERE id = $1`, [f.loan]);
    if (root.number !== f.number || root.customer_id !== f.customer || root.payment_frequency_id !== f.frequency
      || root.preferred_payment_method_id !== f.method || root.created_by_user_id !== f.actor
      || root.idempotency_key !== `b51-loan-${f.tag}` || root.principal !== '100.00' || root.status !== 'ACTIVE')
      throw new Error('B5.1 loan changed; cleanup refused.');
    const [parents] = await manager.query(`SELECT
      (SELECT code FROM public.roles WHERE id = $1) AS role,
      (SELECT username FROM public.users WHERE id = $2) AS actor,
      (SELECT identification FROM public.customers WHERE id = $3) AS customer,
      (SELECT name FROM public.payment_methods WHERE id = $4) AS method,
      (SELECT name FROM public.payment_frequencies WHERE id = $5) AS frequency`,
    [f.role, f.actor, f.customer, f.method, f.frequency]);
    if (parents.role !== `B51_${f.tag}` || parents.actor !== `b51_${f.tag}` || parents.customer !== `b51_${f.tag}`
      || parents.method !== `B51 method ${f.tag}` || parents.frequency !== `B51 frequency ${f.tag}`)
      throw new Error('B5.1 fixture parent ownership changed; cleanup refused.');
    const rows = (sql: string, args: unknown[]) => manager.query(sql + ' FOR UPDATE', args) as Promise<Record<string, string | null>[]>;
    const plan = await rows('SELECT id, loan_id FROM public.payment_plan_entries WHERE loan_id = $1 OR id = ANY($2::uuid[])', [f.loan, f.plan]);
    const disbursements = await rows(`SELECT id, loan_id, payment_method_id, created_by_user_id FROM public.loan_disbursements
      WHERE loan_id = $1 OR created_by_user_id = $2`, [f.loan, f.actor]);
    const payments = await rows(`SELECT id, loan_id, method_id, created_by_user_id, idempotency_key FROM public.payments
      WHERE loan_id = $1 OR created_by_user_id = $2 OR idempotency_key = ANY($3::text[])`, [f.loan, f.actor, f.payments]);
    const ids = payments.map((p) => p.id);
    const applications = await rows(`SELECT id, payment_id, payment_plan_entry_id, carried_to_plan_entry_id FROM public.payment_applications
      WHERE payment_id = ANY($1::uuid[]) OR payment_plan_entry_id = ANY($2::uuid[])`, [ids, f.plan]);
    const annulments = await rows(`SELECT id, payment_id, created_by_user_id, idempotency_key FROM public.payment_annulments
      WHERE payment_id = ANY($1::uuid[]) OR created_by_user_id = $2 OR idempotency_key = $3`, [ids, f.actor, f.annul]);
    const history = await rows(`SELECT id, loan_id, changed_by_user_id, event_kind, payment_id, payment_annulment_id
      FROM public.loan_status_history WHERE loan_id = $1 OR changed_by_user_id = $2 OR payment_id = ANY($3::uuid[])`, [f.loan, f.actor, ids]);
    const receipts = await rows(`SELECT id, loan_id, created_by_user_id, idempotency_key FROM public.loan_edit_operations
      WHERE loan_id = $1 OR created_by_user_id = $2 OR idempotency_key = ANY($3::text[])`, [f.loan, f.actor, f.edits]);
    const cash = await rows(`SELECT id, payment_id, loan_disbursement_id, reversed_movement_id, created_by_user_id,
      payment_method_id, direction, concept, idempotency_key FROM public.cash_movements
      WHERE created_by_user_id = $1 OR payment_id = ANY($2::uuid[]) OR loan_disbursement_id = $3 OR idempotency_key = ANY($4::text[])
        OR reversed_movement_id IN (SELECT id FROM public.cash_movements WHERE payment_id = ANY($2::uuid[]) OR loan_disbursement_id = $3)`,
    [f.actor, ids, f.disbursement, [`loan-disbursement:${f.disbursement}`, ...f.payments.map((key) => `payment:${key}`), `payment-annulment:${f.annul}`]]);
    const [foreign] = await manager.query(`SELECT EXISTS (SELECT 1 FROM public.role_permissions WHERE role_id = $1)
      OR EXISTS (SELECT 1 FROM public.user_sessions WHERE user_id = $2)
      OR EXISTS (SELECT 1 FROM public.customer_addresses WHERE customer_id = $3 OR site_data_updated_by_user_id = $2)
      OR EXISTS (SELECT 1 FROM public.users WHERE role_id = $1 AND id <> $2) AS blocked`, [f.role, f.actor, f.customer]);
    const ownedPayment = (id: string | null) => !!id && ids.includes(id);
    if (foreign.blocked || plan.length !== 2 || plan.some((p) => p.loan_id !== f.loan || !f.plan.includes(p.id as typeof f.plan[number]))
      || disbursements.length !== 1 || disbursements[0].id !== f.disbursement || disbursements[0].loan_id !== f.loan
      || disbursements[0].payment_method_id !== f.method || disbursements[0].created_by_user_id !== f.actor
      || payments.some((p) => p.loan_id !== f.loan || p.method_id !== f.method || p.created_by_user_id !== f.actor
        || !f.payments.includes(p.idempotency_key as typeof f.payments[number]))
      || applications.some((a) => !ownedPayment(a.payment_id) || !f.plan.includes(a.payment_plan_entry_id as typeof f.plan[number])
        || (a.carried_to_plan_entry_id !== null && !f.plan.includes(a.carried_to_plan_entry_id as typeof f.plan[number])))
      || annulments.some((a) => !ownedPayment(a.payment_id) || a.created_by_user_id !== f.actor || a.idempotency_key !== f.annul)
      || history.length !== 1 || history[0].loan_id !== f.loan || history[0].changed_by_user_id !== f.actor
      || history[0].event_kind !== 'CREATED' || history[0].payment_id !== null || history[0].payment_annulment_id !== null
      || receipts.some((r) => r.loan_id !== f.loan || r.created_by_user_id !== f.actor
        || !f.edits.includes(r.idempotency_key as typeof f.edits[number]))
      || cash.length !== 1 + payments.length + annulments.length
      || cash.some((c) => c.created_by_user_id !== f.actor || c.payment_method_id !== f.method
        || (c.concept === 'LOAN_DISBURSEMENT' ? c.loan_disbursement_id !== f.disbursement
          || c.payment_id !== null || c.direction !== 'OUTFLOW' || c.idempotency_key !== `loan-disbursement:${f.disbursement}`
          : c.concept === 'CUSTOMER_PAYMENT' ? !ownedPayment(c.payment_id) || c.loan_disbursement_id !== null
            || c.direction !== 'INFLOW' || !f.payments.some((key) => c.idempotency_key === `payment:${key}`)
            : c.concept !== 'REVERSAL' || c.payment_id !== null || c.loan_disbursement_id !== null
              || c.direction !== 'OUTFLOW' || c.idempotency_key !== `payment-annulment:${f.annul}`
              || !cash.some((original) => original.id === c.reversed_movement_id && original.concept === 'CUSTOMER_PAYMENT'))))
      throw new Error('B5.1 found an unowned or missing child; cleanup refused.');
    const remove = async (table: string, id: string) => {
      if (affected(await manager.query(`DELETE FROM public.${table} WHERE id = $1 RETURNING id`, [id])) !== 1)
        throw new Error('B5.1 scoped cleanup failed.');
    };
    for (const row of history) await remove('loan_status_history', row.id!);
    for (const row of receipts) await remove('loan_edit_operations', row.id!);
    for (const row of annulments) await remove('payment_annulments', row.id!);
    for (const row of applications) await remove('payment_applications', row.id!);
    for (const row of cash.filter((c) => c.concept === 'REVERSAL')) await remove('cash_movements', row.id!);
    for (const row of cash.filter((c) => c.concept !== 'REVERSAL')) await remove('cash_movements', row.id!);
    for (const row of payments) await remove('payments', row.id!);
    for (const row of plan) await remove('payment_plan_entries', row.id!);
    await remove('loan_disbursements', f.disbursement);
    await remove('loans', f.loan);
    for (const [table, id] of [['customers', f.customer], ['payment_frequencies', f.frequency],
      ['payment_methods', f.method], ['users', f.actor], ['roles', f.role]] as const) await remove(table, id);
  });
  await verifyAbsent(db, f);
}

suite('B5.1 historical payments and unpublished loan edit on local PostgreSQL', () => {
  it('preserves payments across edits and rejects a stale concurrent edit after payment', async () => {
    const f = fixture();
    let db: DataSource | undefined;
    let started = false;
    let committed = false;
    let failure: unknown;
    try {
      db = guardedSource();
      try { await db.initialize(); } catch { throw new Error('B5.1 connection failed; inspect the approved target privately.'); }
      await preflight(db, f);
      started = true;
      await db.transaction((manager) => setup(manager, db!, f));
      committed = true;
      const totals = new LoanFinancialTotalsTypeormReader();
      const editor = new EditLoanUseCase(new EditLoanTypeormWriter(db), totals);
      const payer = new RegisterPaymentUseCase(db, totals);
      const command = (body: LoanEditInput) => normalizeLoanEditCommand(body, f.loan, f.actor);
       const pay = (amount: string, key: string, source = payer) => source.execute({ loanId: f.loan, methodId: f.method, paymentDate: f.day, amount, idempotencyKey: key }, f.actor);
      const old = baseline(f, '20.00', '120.00', '60.00', true);
      const first = await pay('50.00', f.payments[0]);
      expect(first).toMatchObject({ amount: '50.00', principalApplied: '50.00', interestApplied: '0.00', cashId: expect.any(String) });
      const second = await pay('55.00', f.payments[1]);
      expect(second).toMatchObject({ amount: '55.00', principalApplied: '50.00', interestApplied: '5.00', cashId: expect.any(String) });
      await integrity(db, f, '105.00', '20.00', '15.00');
      const paid = await snapshot(db, f);
      expect(paid.payments).toHaveLength(2);
      expect(paid.applications.length).toBeGreaterThanOrEqual(2);
      expect(paid.cash).toHaveLength(3);
      expect(paid.disbursements).toHaveLength(1);
      expect(paid.plan.map((row) => JSON.parse(row)).sort((a, b) => a.sequence - b.sequence).map((row) => Number(row.pending_amount).toFixed(2))).toEqual(['0.00', '15.00']);
      expect(await pay('55.00', f.payments[1])).toEqual(second);
      expect(await snapshot(db, f)).toEqual(paid);
      await expect(editor.execute(command(edit(f, f.edits[4], old, '30.00', '25.00')))).rejects.toBeInstanceOf(LoanEditConflictError);
      expect(await snapshot(db, f)).toEqual(paid);

      const a = edit(f, f.edits[0], baseline(f, '20.00', '15.00', '15.00'), '30.00', '25.00');
      const receiptA = await editor.execute(command(a));
      const afterA = await snapshot(db, f);
      historyUnchanged(paid, afterA);
      expect(afterA.receipts).toHaveLength(1);
      expect(afterA.plan.map((row) => JSON.parse(row)).sort((a, b) => a.sequence - b.sequence).map((row) => Number(row.pending_amount).toFixed(2))).toEqual(['0.00', '25.00']);
      await integrity(db, f, '105.00', '30.00', '25.00');
      expect(await editor.execute(command(a))).toEqual(receiptA);
      expect(await snapshot(db, f)).toEqual(afterA);

      const b = edit(f, f.edits[1], baseline(f, '30.00', '25.00', '25.00'), '10.00', '5.00');
      await editor.execute(command(b));
      const afterB = await snapshot(db, f);
      historyUnchanged(afterA, afterB);
      expect(afterB.receipts).toHaveLength(2);
      expect(afterB.plan.map((row) => JSON.parse(row)).sort((a, b) => a.sequence - b.sequence).map((row) => Number(row.pending_amount).toFixed(2))).toEqual(['0.00', '5.00']);
      await integrity(db, f, '105.00', '10.00', '5.00');
      const base = baseline(f, '10.00', '5.00', '5.00');
      for (const [key, interest] of [[f.edits[2], '4.00'], [f.edits[3], '0.00']] as const) {
        await expect(editor.execute(command(edit(f, key, base, interest, '1.00')))).rejects.toBeInstanceOf(LoanEditValidationError);
        expect(await snapshot(db, f)).toEqual(afterB);
      }

       const holder = db.createQueryRunner(); let paymentPid = 0, editPid = 0; let releaseError: unknown, completionError: unknown;
       let racePayment: ReturnType<typeof pay> | undefined, raceEdit: ReturnType<EditLoanUseCase['execute']> | undefined;
       try {
         await holder.connect(); await holder.startTransaction(); expect(await holder.query('SELECT id FROM public.loans WHERE id = $1 FOR UPDATE', [f.loan])).toHaveLength(1);
         const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid'))[0].pid as number;
         const waitsFor = async (pid: () => number, blocker: number) => {
           const until = Date.now() + 2500; while (Date.now() < until) {
             if (pid() && (await db!.query(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity waiter WHERE waiter.pid = $1
               AND waiter.state = 'active' AND waiter.wait_event_type = 'Lock' AND $2::int = ANY(pg_blocking_pids(waiter.pid))) AS blocked`, [pid(), blocker]))[0].blocked) return;
             await new Promise((resolve) => setTimeout(resolve, 50));
           }
           throw new Error('B5.1 contender did not wait behind the preceding loan lock request.');
         };
         const racePayer = new RegisterPaymentUseCase({ transaction: <T>(run: (manager: EntityManager) => Promise<T>) =>
           db!.transaction(async (manager) => { paymentPid = (await manager.query('SELECT pg_backend_pid() AS pid'))[0].pid; return run(manager); }), } as unknown as DataSource, totals);
         racePayment = pay('1.00', f.payments[2], racePayer); void racePayment.catch(() => undefined);
         await waitsFor(() => paymentPid, holderPid);
         const observedWriter: LoanEditWriter = { transaction: (run) => new EditLoanTypeormWriter(db!).transaction(async (tx) => {
           editPid = (await tx.executor.query('SELECT pg_backend_pid() AS pid', []) as unknown as { pid: number }[])[0].pid; return run(tx);
         }) };
         raceEdit = new EditLoanUseCase(observedWriter, totals).execute(command(edit(f, f.edits[5], base, '20.00', '15.00'))); void raceEdit.catch(() => undefined);
         // PostgreSQL reports an earlier conflicting waiter as a soft blocker.
         await waitsFor(() => editPid, paymentPid); await waitsFor(() => paymentPid, holderPid);
       } finally {
         try { if (holder.isTransactionActive) await holder.rollbackTransaction(); } catch (error) { releaseError = error; }
         try { await holder.release(); } catch (error) { releaseError ??= error; }
         const completed = Promise.allSettled([racePayment, raceEdit]);
         try { await bounded(completed, 15000); } catch (error) { completionError = error; await completed; }
       }
       if (completionError || releaseError) throw completionError ?? releaseError;
       const [paymentOutcome, editOutcome] = await Promise.allSettled([racePayment!, raceEdit!]);
       if (paymentOutcome.status === 'rejected') throw paymentOutcome.reason;
       if (editOutcome.status === 'fulfilled') throw new Error('B5.1 stale concurrent edit unexpectedly succeeded.');
       expect(editOutcome.reason).toBeInstanceOf(LoanEditConflictError); expect(editOutcome.reason.message).toBe('The loan changed since it was opened.');
       const last = paymentOutcome.value; expect(last).toMatchObject({ amount: '1.00', principalApplied: '0.00', interestApplied: '1.00' });
       await integrity(db, f, '106.00', '10.00', '4.00');
       const afterRace = await snapshot(db, f); expect(afterRace.receipts).toEqual(afterB.receipts); expect(afterRace.payments).toHaveLength(3); expect(afterRace.cash).toHaveLength(4);
       expect(afterRace.plan.map((row) => JSON.parse(row)).sort((a, b) => a.sequence - b.sequence).map((row) => Number(row.pending_amount).toFixed(2))).toEqual(['0.00', '4.00']);
       const annulled = await payer.annul(last.id, 'B5.1 controlled annulment', f.annul, f.actor); expect(annulled).toMatchObject({ id: last.id, status: 'ANNULLED' });
       await integrity(db, f, '105.00', '10.00', '5.00');
        const afterAnnul = await snapshot(db, f); expect(afterAnnul.annulments).toHaveLength(1); expect(JSON.parse(afterAnnul.annulments[0]).payment_id).toBe(last.id);
       expect(JSON.parse(afterAnnul.payments.find((row) => JSON.parse(row).id === last.id)!).status).toBe('ANNULLED');
        const reversals = afterAnnul.cash.map((row) => JSON.parse(row)).filter((row) => row.concept === 'REVERSAL');
        expect(reversals).toHaveLength(1); expect(reversals[0].reversed_movement_id).toBe(last.cashId); expect(afterAnnul.cash).toHaveLength(5);
        const postAnnulEdit = await editor.execute(command(edit(f, f.edits[6], baseline(f, '10.00', '5.00', '5.00'), '11.00', '6.00')));
        const afterPostAnnulEdit = await snapshot(db, f); expect(postAnnulEdit.loanId).toBe(f.loan); historyUnchanged(afterAnnul, afterPostAnnulEdit); await integrity(db, f, '105.00', '11.00', '6.00'); expect(afterPostAnnulEdit.receipts).toHaveLength(3);
       for (const after of [afterRace, afterAnnul]) {
         expect(after.receipts).toEqual(afterB.receipts); expect(after.disbursements).toEqual(afterB.disbursements); expect(after.status).toEqual(afterB.status);
         for (const table of ['payments', 'applications', 'cash'] as const) {
           const historical = new Set(afterB[table].map((row) => JSON.parse(row).id)); expect(after[table].filter((row) => historical.has(JSON.parse(row).id))).toEqual(afterB[table]);
         }
       }
    } catch (error) { failure = error; }
    finally {
      if (db) {
        try { if (started && db.isInitialized) await cleanup(db, f, committed); }
        catch (error) { failure = failure ? new AggregateError([failure, error], 'B5.1 test and cleanup failed') : error; }
        try { if (db.isInitialized) await db.destroy(); }
        catch { const error = new Error('B5.1 connection release failed');
          failure = failure ? new AggregateError([failure, error], 'B5.1 test and release failed') : error; }
      }
    }
    if (failure) throw failure;
  }, 60000);
});
