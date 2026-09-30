import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { EvaluateUncollectibleEligibilityUseCase, UncollectibleEligibilityReadError, UNCOLLECTIBLE_ELIGIBILITY_READER,
  type EligibilityLoan, type FirstOperationalRow } from '../src/application/loan/uncollectible-eligibility.use-case';
import { LOAN_FINANCIAL_TOTALS_READER, type LoanFinancialTotalsQuery } from '../src/application/loan/loan-financial-totals.reader';
import type { ValidPaymentTotals } from '../src/domain/loan/loan-financial-integrity';
import { UncollectibleEligibilityTypeormReader } from '../src/infrastructure/database/typeorm/repositories/uncollectible-eligibility.reader';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { LoanModule } from '../src/presentation/loan/loan.module';

const loan: EligibilityLoan = { id: 'loan-1', status: 'ACTIVE', principal: '100000.00', interestAmount: '20000.00', totalAmount: '120000.00' };
const valid: ValidPaymentTotals = { paidAmount: '20000.00', paidPrincipal: '15000.00', paidInterest: '5000.00', invalidCount: 0 };
const overdue: FirstOperationalRow = { id: 'entry-overdue', dueDate: '2026-01-01', pendingAmount: '40000.00' };
type PaymentFact = { status: 'VALID' | 'ANNULLED'; amount: string; principalApplied: string; interestApplied: string };
type PlanFact = FirstOperationalRow & { sequence: number };
type Snapshot = { loan: EligibilityLoan | null; totals: ValidPaymentTotals | null; pending: string | null; first: FirstOperationalRow | null;
  payments?: PaymentFact[]; plan?: PlanFact[] };
const factCents = (value: string) => BigInt(value.replace('.', ''));
const factMoney = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

function harness(overrides: Partial<Snapshot> = {}, requestedLoanId = 'loan-1') {
  const snapshot: Snapshot = { loan, totals: valid, pending: '100000.00', first: overdue, ...overrides };
  const query = jest.fn(async (sql: string, parameters: unknown[]) => {
    expect(parameters).toEqual([requestedLoanId]);
    if (sql.includes('FROM loans WHERE')) return snapshot.loan ? [snapshot.loan] : [];
    if (sql.includes('FROM payments WHERE')) {
      if (!snapshot.payments) return snapshot.totals ? [snapshot.totals] : [];
      const rows = sql.includes("status = 'VALID'") ? snapshot.payments.filter(({ status }) => status === 'VALID') : snapshot.payments;
      const paid = (key: 'amount' | 'principalApplied' | 'interestApplied') =>
        factMoney(rows.reduce((sum, payment) => sum + factCents(payment[key]), 0n));
      return [{ paidAmount: paid('amount'), paidPrincipal: paid('principalApplied'), paidInterest: paid('interestApplied'), invalidCount: 0 }];
    }
    if (sql.includes('SUM(pending_amount)')) {
      if (!snapshot.plan) return snapshot.pending === null ? [] : [{ pendingAmount: snapshot.pending }];
      const rows = sql.includes('pending_amount > 0') ? snapshot.plan.filter((row) => factCents(row.pendingAmount) > 0n) : snapshot.plan;
      return [{ pendingAmount: factMoney(rows.reduce((sum, row) => sum + factCents(row.pendingAmount), 0n)) }];
    }
    if (sql.includes('FROM payment_plan_entries')) {
      if (!snapshot.plan) return snapshot.first ? [snapshot.first] : [];
      const rows = sql.includes('pending_amount > 0') ? snapshot.plan.filter((row) => factCents(row.pendingAmount) > 0n) : [...snapshot.plan];
      if (sql.includes('ORDER BY due_date ASC, sequence ASC, id ASC')) rows.sort((a, b) =>
        a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence || a.id.localeCompare(b.id));
      return rows.slice(0, sql.includes('LIMIT 1') ? 1 : undefined).map(({ id, dueDate, pendingAmount }) => ({ id, dueDate, pendingAmount }));
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const executor = { query };
  const totalsReader = new LoanFinancialTotalsTypeormReader();
  const reader = new UncollectibleEligibilityTypeormReader();
  const useCase = new EvaluateUncollectibleEligibilityUseCase(totalsReader, reader);
  return { query, executor, evaluate: (today = '2026-02-01') => useCase.evaluate(executor as never, requestedLoanId, today) };
}

describe('internal read-only uncollectible eligibility', () => {
  it('reuses the caller executor for four fixed, parameterized SELECTs with canonical VALID-only totals', async () => {
    const future: FirstOperationalRow = { id: 'entry-future', dueDate: '2026-12-01', pendingAmount: '60000.00' };
    const plan = [overdue, future];
    const { query, evaluate } = harness({ first: plan[0], pending: '100000.00' });
    await expect(evaluate()).resolves.toEqual({ loanId: 'loan-1', status: 'ACTIVE', financialBalance: 10000000n,
      pendingPlanAmount: 10000000n, firstOperationalRow: overdue, isOverdue: true,
      isFinanciallyValid: true, canMarkUncollectible: true, blockingReason: null });
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements).toHaveLength(4);
    expect(statements[0]).toContain('SELECT id, status, principal::text AS principal, interest_amount::text AS "interestAmount", total_amount::text AS "totalAmount" FROM loans WHERE id = $1');
    expect(statements[1]).toContain("FROM payments WHERE loan_id = $1 AND status = 'VALID'");
    expect(statements[1]).toContain('COUNT(*) FILTER (WHERE amount <= 0 OR principal_applied < 0');
    expect(statements[2]).toContain('COALESCE(SUM(pending_amount), 0)::text AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0');
    expect(statements[3]).toContain('due_date::text AS "dueDate", pending_amount::text AS "pendingAmount"');
    expect(statements[3]).toContain('WHERE loan_id = $1 AND pending_amount > 0 ORDER BY due_date ASC, sequence ASC, id ASC LIMIT 1');
    for (const sql of statements) {
      expect(sql).toMatch(/^SELECT\b/);
      expect(sql).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|FOR UPDATE|BEGIN|COMMIT|ROLLBACK)\b/i);
    }
    expect(query.mock.calls.map(([, parameters]) => parameters)).toEqual(Array.from({ length: 4 }, () => ['loan-1']));
  });

  it('accepts an uppercase PostgreSQL UUID request and returns the canonical persisted loan ID', async () => {
    const canonicalId = 'a9f2c6b4-0e31-4d85-a927-71bc35f8e240';
    const requestedId = canonicalId.toUpperCase();
    const { query, evaluate } = harness({ loan: { ...loan, id: canonicalId } }, requestedId);
    await expect(evaluate()).resolves.toMatchObject({ loanId: canonicalId, financialBalance: 10000000n,
      canMarkUncollectible: true, blockingReason: null });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls.map(([, parameters]) => parameters)).toEqual(Array.from({ length: 4 }, () => [requestedId]));
  });

  it('passes the identical executor object into the existing VALID-only reader and each plan read', async () => {
    const executor = { query: jest.fn(async (sql: string) => sql.includes('FROM loans WHERE') ? [loan]
      : sql.includes('FROM payments WHERE') ? [valid]
        : sql.includes('SUM(pending_amount)') ? [{ pendingAmount: '100000.00' }] : [overdue]) };
    const actual = new LoanFinancialTotalsTypeormReader();
    const totalsReader = { readValidTotals: jest.fn((supplied: LoanFinancialTotalsQuery, id: string) => {
      expect(supplied).toBe(executor);
      return actual.readValidTotals(supplied, id);
    }) };
    const actualPlan = new UncollectibleEligibilityTypeormReader();
    const planReader = {
      readLoan: jest.fn((supplied: LoanFinancialTotalsQuery, id: string) => { expect(supplied).toBe(executor); return actualPlan.readLoan(supplied, id); }),
      readPendingPlanAmount: jest.fn((supplied: LoanFinancialTotalsQuery, id: string) => { expect(supplied).toBe(executor); return actualPlan.readPendingPlanAmount(supplied, id); }),
      readFirstOperationalRow: jest.fn((supplied: LoanFinancialTotalsQuery, id: string) => { expect(supplied).toBe(executor); return actualPlan.readFirstOperationalRow(supplied, id); }),
    };
    const evaluator = new EvaluateUncollectibleEligibilityUseCase(totalsReader, planReader);
    expect((await evaluator.evaluate(executor as never, 'loan-1', '2026-02-01')).canMarkUncollectible).toBe(true);
    expect(executor.query).toHaveBeenCalledTimes(4);
  });

  it.each(['2026-02-01', '2026-12-01'])('does not treat a due date of %s as overdue when today is 2026-02-01', async (dueDate) => {
    const { evaluate } = harness({ first: { ...overdue, dueDate } });
    await expect(evaluate()).resolves.toMatchObject({ isOverdue: false, isFinanciallyValid: true,
      canMarkUncollectible: false, blockingReason: 'LOAN_NOT_OVERDUE' });
  });

  it.each(['CANCELLED', 'UNCOLLECTIBLE', 'REFINANCED', 'ANNULLED'] as const)('returns a business blocker for %s without a technical error', async (status) => {
    await expect(harness({ loan: { ...loan, status } }).evaluate()).resolves.toMatchObject({ status,
      financialBalance: 10000000n, isOverdue: true, canMarkUncollectible: false, blockingReason: 'LOAN_NOT_ACTIVE' });
  });

  it('applies balance, operational row, integrity, then overdue precedence', async () => {
    const paid: ValidPaymentTotals = { paidAmount: '120000.00', paidPrincipal: '100000.00', paidInterest: '20000.00', invalidCount: 0 };
    await expect(harness({ totals: paid, pending: '0', first: null }).evaluate()).resolves.toMatchObject({
      financialBalance: 0n, isFinanciallyValid: true, isOverdue: false, blockingReason: 'NO_OUTSTANDING_BALANCE' });
    await expect(harness({ pending: '0', first: null }).evaluate()).resolves.toMatchObject({
      financialBalance: 10000000n, isFinanciallyValid: false, isOverdue: false, blockingReason: 'NO_OPERATIONAL_OBLIGATION' });
    await expect(harness({ pending: '90000.00' }).evaluate()).resolves.toMatchObject({
      pendingPlanAmount: 9000000n, isOverdue: true, isFinanciallyValid: false, blockingReason: 'FINANCIAL_INTEGRITY_ERROR' });
    await expect(harness({ totals: { ...valid, invalidCount: 1 }, first: { ...overdue, dueDate: '2026-12-01' } }).evaluate()).resolves.toMatchObject({
      isOverdue: false, isFinanciallyValid: false, blockingReason: 'FINANCIAL_INTEGRITY_ERROR' });
  });

  it('excludes ANNULLED payment facts when computing eligibility through the existing SQL reader', async () => {
    const payments: PaymentFact[] = [
      { status: 'ANNULLED', amount: '30000.00', principalApplied: '25000.00', interestApplied: '5000.00' },
      { status: 'VALID', amount: '20000.00', principalApplied: '15000.00', interestApplied: '5000.00' },
    ];
    const { query, evaluate } = harness({ payments });
    await expect(evaluate()).resolves.toMatchObject({ financialBalance: 10000000n, pendingPlanAmount: 10000000n,
      isFinanciallyValid: true, canMarkUncollectible: true });
    expect(query.mock.calls[1][0]).toContain("status = 'VALID'");
  });

  it('preserves bigint cents beyond Number.MAX_SAFE_INTEGER', async () => {
    const amount = '90071992547410.00';
    const { query, evaluate } = harness({ loan: { ...loan, principal: '90071992547409.91', interestAmount: '0.09', totalAmount: amount },
      totals: { paidAmount: '0.01', paidPrincipal: '0.00', paidInterest: '0.01', invalidCount: 0 },
      pending: '90071992547409.99', first: { ...overdue, pendingAmount: '90071992547409.99' } });
    await expect(evaluate()).resolves.toMatchObject({ financialBalance: 9007199254740999n,
      pendingPlanAmount: 9007199254740999n, isFinanciallyValid: true, canMarkUncollectible: true });
    expect(query.mock.calls[1][0]).toContain("status = 'VALID'");
    expect(query.mock.calls[1][0]).not.toContain("status = 'ANNULLED'");
  });

  it('uses the database first row, ordered by due date before sequence, then id on ties', async () => {
    const plan: PlanFact[] = [
      { id: 'future', sequence: 1, dueDate: '2026-12-01', pendingAmount: '60000.00' },
      { id: 'historical-zero', sequence: 5, dueDate: '2025-01-01', pendingAmount: '0.00' },
      { id: 'c', sequence: 9, dueDate: '2026-01-01', pendingAmount: '10000.00' },
      { id: 'b', sequence: 2, dueDate: '2026-01-01', pendingAmount: '10000.00' },
      { id: 'a', sequence: 2, dueDate: '2026-01-01', pendingAmount: '20000.00' },
    ];
    const { query, evaluate } = harness({ plan });
    await expect(evaluate()).resolves.toMatchObject({ firstOperationalRow: { id: 'a', pendingAmount: '20000.00' },
      pendingPlanAmount: 10000000n, isFinanciallyValid: true, isOverdue: true, canMarkUncollectible: true });
    expect(query.mock.calls[3][0]).toContain('ORDER BY due_date ASC, sequence ASC, id ASC LIMIT 1');
  });

  it.each([
    [{ loan: null }, 'Loan financial data is unavailable.'],
    [{ loan: { ...loan, id: null as never } }, 'Loan financial data is unavailable.'],
    [{ loan: { ...loan, principal: 'NaN' } }, 'Loan financial data is unavailable.'],
    [{ loan: { ...loan, status: 'UNKNOWN' as never } }, 'Loan financial data is unavailable.'],
    [{ totals: null }, 'Valid payment totals are unavailable.'],
    [{ totals: { ...valid, paidAmount: 'not a number' } }, 'Valid payment totals are unavailable.'],
    [{ pending: null }, 'Pending plan total is unavailable.'],
    [{ pending: '12.345' }, 'Pending plan total is unavailable.'],
    [{ first: { ...overdue, dueDate: '2026-02-30' } }, 'First operational plan row is unavailable.'],
    [{ first: { ...overdue, pendingAmount: '0.00' } }, 'First operational plan row is unavailable.'],
  ] as [Partial<Snapshot>, string][])('fails closed on missing or malformed source data %#', async (overrides, message) => {
    await expect(harness(overrides).evaluate()).rejects.toThrow(new UncollectibleEligibilityReadError(message));
  });

  it('rejects a malformed caller calendar day before issuing a SELECT', async () => {
    const { query, evaluate } = harness();
    await expect(evaluate('2026-02-30')).rejects.toThrow(UncollectibleEligibilityReadError);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a controlled read error with the original SQL failure as its cause', async () => {
    const cause = new Error('SQL unavailable');
    const evaluator = new EvaluateUncollectibleEligibilityUseCase(new LoanFinancialTotalsTypeormReader(), new UncollectibleEligibilityTypeormReader());
    const executor = { query: jest.fn().mockRejectedValue(cause) };
    await expect(evaluator.evaluate(executor, 'loan-1', '2026-02-01'))
      .rejects.toMatchObject({ message: 'Loan eligibility read failed.', cause });
    expect(executor.query).toHaveBeenCalledTimes(1);
  });

  it('registers the internal readers and evaluator in LoanModule without touching PaymentModule or routes', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, LoanModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.map((provider) => provider.provide)).toEqual(expect.arrayContaining([
      LOAN_FINANCIAL_TOTALS_READER, UNCOLLECTIBLE_ELIGIBILITY_READER, EvaluateUncollectibleEligibilityUseCase]));
    expect(providers.find((provider) => provider.provide === EvaluateUncollectibleEligibilityUseCase)?.inject)
      .toEqual([LOAN_FINANCIAL_TOTALS_READER, UNCOLLECTIBLE_ELIGIBILITY_READER]);
  });
});
