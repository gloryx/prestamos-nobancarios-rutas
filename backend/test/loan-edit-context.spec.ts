import type { DataSource } from 'typeorm';
import { GetLoanEditContextUseCase, LoanEditContextConflictError, LoanEditContextNotFoundError,
  type LoanEditContextLoan, type LoanEditFrequencyOption, type LoanEditOption } from '../src/application/loan/loan-edit-context.use-case';
import { loanEditBaselineMatches, normalizeLoanEditCommand } from '../src/application/loan/loan-edit.command';
import type { ValidPaymentTotals } from '../src/domain/loan/loan-financial-integrity';
import { LoanEditContextTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-edit-context.reader';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const loan: LoanEditContextLoan = { id: id(1), loanNumber: '9007199254740993', status: 'ACTIVE',
  customer: { id: id(4), identification: '123', fullName: 'Jane Doe' }, principal: '100.00', interestAmount: '20.00',
  totalAmount: '120.00', startDate: '2026-09-01', paymentFrequencyId: id(2), paymentFrequencyName: 'Old frequency',
  preferredPaymentMethodId: id(3), preferredPaymentMethodName: 'Old method', observations: ' Current ' };
const plan = [{ id: id(11).toUpperCase(), dueDate: new Date(2026, 9, 1), pendingAmount: '74.50' },
  { id: id(12), dueDate: '2026-10-02', pendingAmount: '0.00' }];
const totals: ValidPaymentTotals = { paidAmount: '45.50', paidPrincipal: '40.00', paidInterest: '5.50', invalidCount: 0 };
const frequencies = [
  { id: id(8), name: 'Hidden', active: false, displayOrder: 0, intervalUnit: 'MONTH' as const, intervalValue: 1 },
  { id: id(5), name: 'Weekly', active: true, displayOrder: 2, intervalUnit: 'WEEK' as const, intervalValue: 1 },
  { id: id(2), name: 'Old frequency', active: false, displayOrder: 1, intervalUnit: 'DAY/15' as const, intervalValue: 1 },
  { id: id(6), name: 'Daily', active: true, displayOrder: 1, intervalUnit: 'DAY' as const, intervalValue: 1 },
];
const methods = [
  { id: id(9), name: 'Hidden', active: false, displayOrder: 0 },
  { id: id(7), name: 'Cash', active: true, displayOrder: 1 },
  { id: id(3), name: 'Old method', active: false, displayOrder: 2 },
];

function fixture(overrides: { loan?: LoanEditContextLoan | null; plan?: typeof plan; totals?: ValidPaymentTotals | null;
  protectedPlanEntryIds?: string[] } = {}) {
  const current = overrides.loan === undefined ? loan : overrides.loan;
  const rows = overrides.plan ?? plan;
  const paymentTotals = overrides.totals === undefined ? totals : overrides.totals;
  const frequencyOptions = (selected: string): LoanEditFrequencyOption[] => frequencies
    .filter((entry) => entry.active || entry.id === selected)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map(({ id, name, active, intervalUnit, intervalValue }) => ({ id, name, active, intervalUnit, intervalValue }));
  const methodOptions = (selected: string): LoanEditOption[] => methods
    .filter((entry) => entry.active || entry.id === selected)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map(({ id, name, active }) => ({ id, name, active }));
  const query = jest.fn(async (sql: string, parameters?: unknown[]): Promise<unknown[]> => {
    if (sql === 'SET TRANSACTION READ ONLY') return [];
    if (sql.includes('FROM loans l JOIN customers')) return current ? [{ ...current, customerId: current.customer.id,
      identification: current.customer.identification, customerName: current.customer.fullName, customer: undefined }] : [];
    if (sql.includes('FROM payment_plan_entries')) return rows;
    if (sql.includes('FROM payments')) return paymentTotals ? [paymentTotals] : [];
    if (sql.includes('FROM payment_frequencies WHERE')) return frequencyOptions(parameters![0] as string);
    if (sql.includes('FROM payment_methods WHERE')) return methodOptions(parameters![0] as string);
    if (sql.startsWith('SELECT DISTINCT protected.id')) return (overrides.protectedPlanEntryIds ?? []).map((entryId) => ({ id: entryId }));
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const transaction = jest.fn(async (_level: string, run: (manager: { query: typeof query }) => Promise<unknown>) => run({ query }));
  const reader = new LoanEditContextTypeormReader({ transaction } as unknown as DataSource, new LoanFinancialTotalsTypeormReader());
  return { useCase: new GetLoanEditContextUseCase(reader), query, transaction };
}

describe('GET loan edit context snapshot and SQL', () => {
  it('builds a PATCH-compatible canonical baseline, using the VALID totals reader and positive plan only', async () => {
    const { useCase, query, transaction } = fixture();
    const result = await useCase.execute(id(1));
    expect(result.loan).toEqual({ ...loan, observations: 'CURRENT' });
    expect(result.baseline).toEqual({ interestAmount: '20.00', paymentFrequencyId: id(2),
      preferredPaymentMethodId: id(3), observations: 'CURRENT', financialBalance: '74.50',
      plan: [{ id: id(11), dueDate: '2026-10-01', pendingAmount: '74.50' }] });
    expect(result.paymentFrequencyOptions).toEqual([
      { id: id(6), name: 'Daily', active: true, intervalUnit: 'DAY', intervalValue: 1 },
      { id: id(2), name: 'Old frequency', active: false, intervalUnit: 'DAY/15', intervalValue: 1 },
      { id: id(5), name: 'Weekly', active: true, intervalUnit: 'WEEK', intervalValue: 1 },
    ]);
    expect(result.preferredPaymentMethodOptions).toEqual([
      { id: id(7), name: 'Cash', active: true }, { id: id(3), name: 'Old method', active: false },
    ]);
    expect(result.protectedPlanEntryIds).toEqual([]);
    expect(normalizeLoanEditCommand({ idempotencyKey: 'example', baseline: result.baseline,
      changes: { observations: 'Revised' } }, id(1), id(10)).baseline.financialBalance).toBe(7450n);
    expect(loanEditBaselineMatches(normalizeLoanEditCommand({ idempotencyKey: 'example', baseline: result.baseline,
      changes: { observations: 'Revised' } }, id(1), id(10)).baseline,
    { ...loan, financialBalance: result.baseline.financialBalance, plan })).toBe(true);
    expect(JSON.stringify(result)).not.toContain('bigint');
    expect(transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    expect(query).toHaveBeenCalledTimes(7);
    expect(query.mock.calls[0][0]).toBe('SET TRANSACTION READ ONLY');
    const selects = query.mock.calls.slice(1);
    expect(selects.every(([sql]) => /^SELECT\b/.test(sql))).toBe(true);
    expect(selects.map(([sql]) => sql)).not.toEqual(expect.arrayContaining([expect.stringMatching(/\b(?:INSERT|UPDATE|DELETE|FOR UPDATE|FOR SHARE)\b/i)]));
    expect(selects[1][0]).toMatch(/ORDER BY due_date, sequence, id/);
    expect(selects[2][0]).toContain("FROM payments WHERE loan_id = $1 AND status = 'VALID'");
    expect(selects[2][0]).toContain('COUNT(*) FILTER (WHERE amount <= 0');
    for (const [index, currentId] of [[3, id(2)], [4, id(3)]] as const) {
      expect(selects[index][0]).toMatch(/WHERE is_active = true OR id = \$1 ORDER BY display_order, name, id/);
      expect(selects[index][1]).toEqual([currentId]);
    }
    expect(selects.every(([, args]) => (args as string[])[0] !== undefined)).toBe(true);
  });

  it('exposes positive obligations protected by VALID payment applications outside the PATCH baseline', async () => {
    const protectedId = id(11);
    const result = await fixture({ protectedPlanEntryIds: [protectedId] }).useCase.execute(id(1));
    expect(result.protectedPlanEntryIds).toEqual([protectedId]);
    expect(result.baseline.plan[0]).not.toHaveProperty('protected');
  });

  it('allows a valid fully paid ACTIVE loan with only zero historical plan entries', async () => {
    const { useCase } = fixture({ plan: [{ ...plan[0], pendingAmount: '0.00' }],
      totals: { paidAmount: '120.00', paidPrincipal: '100.00', paidInterest: '20.00', invalidCount: 0 } });
    await expect(useCase.execute(id(1))).resolves.toMatchObject({ baseline: { financialBalance: '0.00', plan: [] } });
  });

  it('distinguishes absent and nonACTIVE loans before attempting to edit', async () => {
    const absent = fixture({ loan: null });
    await expect(absent.useCase.execute(id(1))).rejects.toBeInstanceOf(LoanEditContextNotFoundError);
    expect(absent.query).toHaveBeenCalledTimes(2);
    const inactive = fixture({ loan: { ...loan, status: 'UNCOLLECTIBLE' } });
    await expect(inactive.useCase.execute(id(1))).rejects.toBeInstanceOf(LoanEditContextConflictError);
  });

  it.each([
    { totals: { ...totals, invalidCount: 1 } },
    { totals: { ...totals, paidAmount: '46.00' } },
    { totals: null },
    { plan: [{ ...plan[0], pendingAmount: '-1.00' }] },
    { plan: [{ ...plan[0], dueDate: '2026-02-30' }] },
  ])('rejects corrupt financial or baseline data as a typed conflict (%p)', async (overrides) => {
    await expect(fixture(overrides).useCase.execute(id(1))).rejects.toBeInstanceOf(LoanEditContextConflictError);
  });
});
