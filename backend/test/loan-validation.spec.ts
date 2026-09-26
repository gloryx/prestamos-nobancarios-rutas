import { calculateLoanTotal, CreateLoanUseCase, ListLoansUseCase, LoanConflictError, loanPlanDatesAreValid, loanPlanMatchesTotal, normalizeLoanInput } from '../src/application/loan/loan.use-case';

describe('loan validation seams', () => {
  const base = { customerId: 'customer', paymentFrequencyId: 'frequency', preferredPaymentMethodId: 'preferred', disbursementPaymentMethodId: 'disbursement', startDate: '2026-01-31', principal: '100.00', interestAmount: '10', plan: [{ sequence: 1, dueDate: '2026-02-28', pendingAmount: '110' }] };
  it('normalizes persisted money and sequence values before fingerprinting', () => expect(normalizeLoanInput(base)).toMatchObject({ principal: '100.00', interestAmount: '10.00', plan: [{ sequence: 1, pendingAmount: '110.00' }] }));
  it('calculates total money before SQL parameterization without floating-point arithmetic', () => {
    expect(calculateLoanTotal('50000.00', '10000.00')).toBe('60000.00');
    expect(calculateLoanTotal('100000.50', '20000.25')).toBe('120000.75');
    expect(calculateLoanTotal('50000.00', '0')).toBe('50000.00');
  });
  it('requires strictly later ordered dates and exact cent totals', () => { expect(loanPlanDatesAreValid(base)).toBe(true); expect(loanPlanMatchesTotal(base)).toBe(true); expect(loanPlanDatesAreValid({ ...base, plan: [{ ...base.plan[0], dueDate: base.startDate }] })).toBe(false); expect(loanPlanMatchesTotal({ ...base, plan: [{ ...base.plan[0], pendingAmount: '109.99' }] })).toBe(false); });
  it('recovers an idempotency race inside a nested savepoint before querying the winner', async () => {
    let idempotencyChecks = 0;
    let winningFingerprint = '';
    const detail = { id: 'loan-1', loanNumber: 1 };
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id, idempotency_fingerprint')) return idempotencyChecks++ === 0 ? [] : [{ id: 'loan-1', fingerprint: winningFingerprint }];
        if (sql.startsWith('SELECT opening_date')) return [{ openingDate: '2026-01-01' }];
        if (sql.startsWith('SELECT id FROM customers')) return [{ id: 'customer' }];
        if (sql.startsWith('SELECT id FROM payment_frequencies')) return [{ id: 'frequency' }];
        if (sql.startsWith('SELECT id FROM payment_methods')) return [{ id: 'preferred' }, { id: 'disbursement' }];
        if (sql.startsWith('SELECT l.id')) return [detail];
        if (sql.startsWith('SELECT sequence')) return [];
        return [];
      }),
      transaction: jest.fn(),
    };
     manager.transaction.mockImplementation(async (callback: (nestedManager: typeof manager) => Promise<unknown>) => callback({ ...manager, query: jest.fn(async (sql: string, params?: unknown[]) => { if (sql.startsWith('INSERT INTO loans')) { winningFingerprint = String(params?.[10]); throw { code: '23505' }; } return manager.query(sql); }) as typeof manager.query }));
    const dataSource = { transaction: jest.fn(async (callback: (transactionManager: typeof manager) => Promise<unknown>) => callback(manager)) } as never;
    const result = await new CreateLoanUseCase(dataSource, {} as never).execute({ ...base, idempotencyKey: 'same-key' }, 'actor');
    expect(result).toEqual({ ...detail, plan: [] });
    expect(manager.transaction).toHaveBeenCalledTimes(1);
    await expect(new CreateLoanUseCase(dataSource, {} as never).execute({ ...base, principal: '101.00', plan: [{ ...base.plan[0], pendingAmount: '111' }], idempotencyKey: 'same-key' }, 'actor')).rejects.toBeInstanceOf(LoanConflictError);
  });
  it('always constrains both active loan rows and count to ACTIVE', async () => {
    const queries: string[] = [];
    const dataSource = { query: jest.fn(async (sql: string) => { queries.push(sql); return sql.startsWith('SELECT COUNT') ? [{ total: 1 }] : []; }) } as never;
    await new ListLoansUseCase(dataSource).execute({ page: 1, pageSize: 20 });
    expect(queries).toHaveLength(2);
    expect(queries.every((sql) => sql.includes("l.status = 'ACTIVE'"))).toBe(true);
    expect(queries.some((sql) => sql.includes('CANCELLED'))).toBe(false);
  });
});
