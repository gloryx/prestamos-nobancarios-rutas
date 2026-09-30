import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { LoanFinancialTotalsQuery } from '../src/application/loan/loan-financial-totals.reader';
import { cents, evaluateLoanFinancialIntegrity } from '../src/domain/loan/loan-financial-integrity';
import { LoanFinancialBatchTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-batch.reader';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { UncollectibleEligibilityTypeormReader } from '../src/infrastructure/database/typeorm/repositories/uncollectible-eligibility.reader';
import { LoanController } from '../src/presentation/loan/loan.controller';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const loans = Array.from({ length: 10 }, (_, index) => ({ id: id(index + 1), principal: '100.00', interestAmount: '20.00', totalAmount: '120.00' }));
loans[8] = { id: id(9), principal: '90071992547409.91', interestAmount: '0.09', totalAmount: '90071992547410.00' };
type PaymentFact = { loanId: string; status: 'VALID' | 'ANNULLED'; amount: string; principalApplied: string; interestApplied: string };
const payment = (n: number, amount: string, principalApplied: string, interestApplied: string, status: PaymentFact['status'] = 'VALID'): PaymentFact =>
  ({ loanId: id(n), amount, principalApplied, interestApplied, status });
const payments: PaymentFact[] = [
  payment(2, '25.50', '20.00', '5.50'), payment(2, '20.00', '20.00', '0.00'),
  payment(2, '99.00', '99.00', '0.00', 'ANNULLED'),
  payment(3, '15.00', '10.00', '4.00'), payment(3, '15.00', '10.00', '6.00'),
  payment(4, '5.00', '-1.00', '6.00'), payment(5, '101.00', '101.00', '0.00'),
  payment(6, '21.00', '0.00', '21.00'), payment(7, '10.00', '10.00', '0.00'),
  payment(8, '120.00', '100.00', '20.00'), payment(9, '0.01', '0.00', '0.01'),
  payment(10, '90.00', '90.00', '0.00'),
];
const plan = [
  { loanId: id(1), pendingAmount: '120.00' }, { loanId: id(1), pendingAmount: '0.00' },
  { loanId: id(1), pendingAmount: '-1.00' }, // Adversarial fixture: the database rejects negative pending entries.
  { loanId: id(2), pendingAmount: '74.50' }, { loanId: id(3), pendingAmount: '90.00' },
  { loanId: id(4), pendingAmount: '115.00' }, { loanId: id(5), pendingAmount: '19.00' },
  { loanId: id(6), pendingAmount: '99.00' }, { loanId: id(7), pendingAmount: '109.99' },
  { loanId: id(8), pendingAmount: '0.00' }, { loanId: id(9), pendingAmount: '90071992547409.99' },
  { loanId: id(10), pendingAmount: '30.00' },
];
const amount = (value: string) => BigInt(value.replace('.', ''));
const money = (value: bigint) => {
  const positive = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${positive / 100n}.${(positive % 100n).toString().padStart(2, '0')}`;
};
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

// Execute only the SELECT shapes used by the real readers against the same raw payment and plan facts.
function fixtureExecutor() {
  const query = jest.fn(async (sql: string, parameters: unknown[]): Promise<unknown[]> => {
    if (!/^SELECT\b/.test(sql)) throw new Error(`Non-SELECT SQL: ${sql}`);
    const matches = (loanId: string) => {
      if (/\b(?:id|loan_id) = ANY\(\$1::uuid\[\]\)/.test(sql))
        return (parameters[0] as string[]).some((requested) => sameId(loanId, requested));
      if (/\b(?:id|loan_id) = \$1\b/.test(sql)) return sameId(loanId, parameters[0] as string);
      return true;
    };
    if (sql.includes('FROM loans')) return loans.filter((loan) => matches(loan.id));
    if (sql.includes('FROM payments')) {
      const grouped = sql.includes('GROUP BY loan_id');
      if (grouped && !sql.includes('loan_id = ANY($1::uuid[])')) throw new Error('Unbounded grouped payments.');
      const selected = payments.filter((row) => matches(row.loanId) &&
        (!sql.includes("status = 'VALID'") || row.status === 'VALID'));
      const sum = (rows: PaymentFact[], key: 'amount' | 'principalApplied' | 'interestApplied') =>
        rows.length ? money(rows.reduce((total, row) => total + amount(row[key]), 0n)) : '0';
      const aggregate = (rows: PaymentFact[]) => ({
        paidAmount: sum(rows, 'amount'), paidPrincipal: sum(rows, 'principalApplied'), paidInterest: sum(rows, 'interestApplied'),
        invalidCount: sql.includes('COUNT(*) FILTER (WHERE amount <= 0 OR principal_applied < 0 OR interest_applied < 0 OR amount <> principal_applied + interest_applied)')
          ? rows.filter((row) => amount(row.amount) <= 0n || amount(row.principalApplied) < 0n ||
            amount(row.interestApplied) < 0n || amount(row.amount) !== amount(row.principalApplied) + amount(row.interestApplied)).length : 0,
      });
      return grouped ? [...new Set(selected.map((row) => row.loanId))].map((loanId) =>
        ({ loanId, ...aggregate(selected.filter((row) => sameId(row.loanId, loanId))) })) : [aggregate(selected)];
    }
    if (sql.includes('FROM payment_plan_entries')) {
      const grouped = sql.includes('GROUP BY loan_id');
      if (grouped && !sql.includes('loan_id = ANY($1::uuid[])')) throw new Error('Unbounded grouped plan.');
      const selected = plan.filter((row) => matches(row.loanId) &&
        (!sql.includes('pending_amount > 0') || amount(row.pendingAmount) > 0n));
      const aggregate = (loanId: string) => ({ pendingAmount: money(selected.filter((row) => sameId(row.loanId, loanId))
        .reduce((sum, row) => sum + amount(row.pendingAmount), 0n)) });
      return grouped ? [...new Set(selected.map((row) => row.loanId))].map((loanId) => ({ loanId, ...aggregate(loanId) }))
        : [{ pendingAmount: selected.length ? money(selected.reduce((sum, row) => sum + amount(row.pendingAmount), 0n)) : '0' }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  return { query };
}

describe('internal batch loan financial integrity', () => {
  const reader = new LoanFinancialBatchTypeormReader();

  it('does not query the executor for an empty request', async () => {
    const executor = fixtureExecutor();
    await expect(reader.readLoanFinancialIntegrityBatch(executor, [])).resolves.toEqual(new Map());
    expect(executor.query).not.toHaveBeenCalled();
  });

  it('projects independent loans with canonical per-payment integrity in exactly three bounded SELECTs', async () => {
    const executor = fixtureExecutor();
    const requested = [id(2).toUpperCase(), ...loans.slice(0, 9).map((loan) => loan.id), id(99), id(2).toUpperCase()];
    const actual = await reader.readLoanFinancialIntegrityBatch(executor, requested);
    const calls = executor.query.mock.calls;
    expect(calls).toHaveLength(3);
    expect([...actual.keys()]).toEqual([id(2), id(1), ...loans.slice(2, 9).map((loan) => loan.id)]);
    for (const [sql, parameters] of calls) {
      expect(sql).toMatch(/^SELECT\b/);
      expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|FOR UPDATE)\b/i);
      expect(sql).not.toMatch(/\bJOIN\b/i);
      expect(sql).toMatch(/= ANY\(\$1::uuid\[\]\)/);
      expect(parameters).toEqual([[id(2), id(1), ...loans.slice(2, 9).map((loan) => loan.id), id(99)]]);
    }
    expect(calls[1][0]).toContain("FROM payments WHERE loan_id = ANY($1::uuid[]) AND status = 'VALID' GROUP BY loan_id");
    expect(calls[2][0]).toContain('FROM payment_plan_entries WHERE loan_id = ANY($1::uuid[]) AND pending_amount > 0 GROUP BY loan_id');

    const single = new LoanFinancialTotalsTypeormReader();
    const pending = new UncollectibleEligibilityTypeormReader();
    for (const loan of loans.slice(0, 9)) {
      const totals = await single.readValidTotals(executor as unknown as LoanFinancialTotalsQuery, loan.id);
      const pendingText = await pending.readPendingPlanAmount(executor as unknown as LoanFinancialTotalsQuery, loan.id);
      expect(totals).toBeDefined();
      expect(pendingText).toBeDefined();
      expect(actual.get(loan.id)).toStrictEqual({ loanId: loan.id,
        financialSnapshot: { principal: loan.principal, interestAmount: loan.interestAmount, totalAmount: loan.totalAmount,
          validTotals: totals, pendingPlanAmount: pendingText },
        integrityResult: evaluateLoanFinancialIntegrity(loan, totals!, cents(pendingText!)) });
    }
    expect(actual.get(id(1))?.financialSnapshot.validTotals).toEqual({ paidAmount: '0', paidPrincipal: '0', paidInterest: '0', invalidCount: 0 });
    expect(actual.get(id(2))?.financialSnapshot.validTotals).toEqual({ paidAmount: '45.50', paidPrincipal: '40.00', paidInterest: '5.50', invalidCount: 0 });
    expect(actual.get(id(3))?.financialSnapshot.validTotals).toEqual({ paidAmount: '30.00', paidPrincipal: '20.00', paidInterest: '10.00', invalidCount: 2 });
    expect(actual.get(id(4))?.financialSnapshot.validTotals.invalidCount).toBe(1);
    expect(actual.get(id(5))?.integrityResult.outstandingPrincipal).toBe(-100n);
    expect(actual.get(id(6))?.integrityResult.outstandingInterest).toBe(-100n);
    expect(actual.get(id(7))?.integrityResult.valid).toBe(false);
    expect(actual.get(id(8))?.integrityResult).toMatchObject({ valid: true, pendingPlanAmount: 0n, financialBalance: 0n });
    expect(actual.get(id(9))?.integrityResult).toMatchObject({ valid: true, pendingPlanAmount: 9007199254740999n });
    expect([1, 2, 8, 9].map((n) => actual.get(id(n))?.integrityResult.valid)).toEqual([true, true, true, true]);
    expect([3, 4, 5, 6, 7].map((n) => actual.get(id(n))?.integrityResult.valid)).toEqual([false, false, false, false, false]);
    expect(actual.has(id(99))).toBe(false);
    expect(actual.has(id(10))).toBe(false);
  });

  it('distinguishes absent aggregate groups from malformed numeric facts', async () => {
    const executor = { query: jest.fn(async (sql: string) => sql.includes('FROM loans') ? [loans[0]]
      : sql.includes('FROM payments') ? [{ loanId: id(1), paidAmount: 'NaN', paidPrincipal: '0', paidInterest: '0', invalidCount: 0 }] : []) };
    await expect(reader.readLoanFinancialIntegrityBatch(executor, [id(1)])).rejects.toThrow('Invalid loan financial batch payment totals.');
    const badPlan = { query: jest.fn(async (sql: string) => sql.includes('FROM loans') ? [loans[0]]
      : sql.includes('FROM payments') ? [] : [{ loanId: id(1), pendingAmount: '1.001' }]) };
    await expect(reader.readLoanFinancialIntegrityBatch(badPlan, [id(1)])).rejects.toThrow('Invalid loan financial batch plan total.');
  });

  it('makes missing SQL filters and grouping observable in the fixture, not just string assertions', async () => {
    const facts = fixtureExecutor();
    const without = (fragment: string) => ({ query: (sql: string, parameters: unknown[]) =>
      facts.query(sql.replace(fragment, ''), parameters) });
    const annulledIncluded = await reader.readLoanFinancialIntegrityBatch(without(" AND status = 'VALID'"), [id(2)]);
    expect(annulledIncluded.get(id(2))?.financialSnapshot.validTotals.paidAmount).toBe('144.50');
    const nonpositiveIncluded = await reader.readLoanFinancialIntegrityBatch(without(' AND pending_amount > 0'), [id(1)]);
    expect(nonpositiveIncluded.get(id(1))?.financialSnapshot.pendingPlanAmount).toBe('119.00');
    await expect(reader.readLoanFinancialIntegrityBatch(without(' WHERE id = ANY($1::uuid[])'), [id(1)]))
      .rejects.toThrow('Invalid loan financial batch loan.');
    await expect(reader.readLoanFinancialIntegrityBatch(without('loan_id = ANY($1::uuid[]) AND '), [id(2)]))
      .rejects.toThrow('Unbounded grouped payments.');
    const withoutPlanScope = { query: (sql: string, parameters: unknown[]) => facts.query(
      sql.includes('FROM payment_plan_entries') ? sql.replace('loan_id = ANY($1::uuid[]) AND ', '') : sql, parameters) };
    await expect(reader.readLoanFinancialIntegrityBatch(withoutPlanScope, [id(2)]))
      .rejects.toThrow('Unbounded grouped plan.');
    await expect(reader.readLoanFinancialIntegrityBatch(without(' GROUP BY loan_id'), [id(2)]))
      .rejects.toThrow('Invalid loan financial batch payment totals.');
  });

  it('retains existing loan routes when the uncollectible read endpoint is added', () => {
    const routes = Object.getOwnPropertyNames(LoanController.prototype).filter((method) => method !== 'constructor' &&
      Reflect.hasOwnMetadata(PATH_METADATA, LoanController.prototype[method as keyof LoanController]));
    expect(routes).toEqual(['customerOptions', 'listLoans', 'cancelledLoans', 'overdueLoans', 'uncollectibleLoans', 'createLoan', 'markAsUncollectible', 'reactivate', 'detail']);
  });
});
