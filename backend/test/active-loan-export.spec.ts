import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { ExportActiveLoansUseCase } from '../src/application/loan/export-active-loans.use-case';
import { ActiveLoanExportTypeormReader } from '../src/infrastructure/database/typeorm/repositories/active-loan-export.reader';
import { LoanController } from '../src/presentation/loan/loan.controller';

const loanId = '00000000-0000-4000-8000-000000000001';
const candidate = { id: loanId, loanNumber: '42', identification: '101110111', customerName: 'Ana Mora', phone: '88888888',
  startDate: '2026-01-02', principal: '1000.00', interestAmount: '200.00', totalAmount: '1200.00',
  frequencyName: 'Mensual', dueDate: '2026-06-02', status: 'ACTIVE' as const };

describe('active loan export', () => {
  it('exports every active candidate with canonical payment allocation balances and exact summary totals', async () => {
    const integrityResult = { valid: true, validPaidAmount: 45000n, validPrincipalApplied: 40000n, validInterestApplied: 5000n,
      pendingPlanAmount: 75000n, financialBalance: 75000n, outstandingPrincipal: 60000n, outstandingInterest: 15000n };
    const useCase = new ExportActiveLoansUseCase({ read: async () => ({ candidates: [candidate], financial: new Map([[loanId, {
      loanId, financialSnapshot: { principal: '1000.00', interestAmount: '200.00', totalAmount: '1200.00',
        validTotals: { paidAmount: '450.00', paidPrincipal: '400.00', paidInterest: '50.00', invalidCount: 0 }, pendingPlanAmount: '750.00' },
      integrityResult,
    }]]) }) });
    const { id: _id, ...exportedCandidate } = candidate;

    const exported = await useCase.execute();
    expect(exported).toEqual({ items: [{ ...exportedCandidate,
      outstandingPrincipal: '600.00', outstandingInterest: '150.00', financialBalance: '750.00' }],
    summary: { totalActiveLoans: 1, capitalPlaced: '1000.00', outstandingPrincipal: '600.00',
      outstandingInterest: '150.00', financialBalance: '750.00' } });
    await expect(useCase.executeSummary()).resolves.toEqual(exported.summary);
    expect(BigInt(exported.summary.financialBalance.replace('.', ''))).toBe(
      BigInt(exported.summary.outstandingPrincipal.replace('.', '')) + BigInt(exported.summary.outstandingInterest.replace('.', '')));
  });

  it('reads all active loans in one unpaginated snapshot and batches financial facts without N+1 queries', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const manager = { query: jest.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes('JOIN payment_frequencies')) return [candidate];
      if (sql.includes('FROM loans WHERE id = ANY')) return [{ id: loanId, principal: '1000.00', interestAmount: '200.00', totalAmount: '1200.00' }];
      if (sql.includes('FROM payments')) return [];
      if (sql.includes('FROM payment_plan_entries')) return [{ loanId, pendingAmount: '1200.00' }];
      throw new Error(`Unexpected SQL: ${sql}`);
    }) };
    const dataSource = { transaction: jest.fn(async (isolation: string, work: (executor: typeof manager) => unknown) => {
      expect(isolation).toBe('REPEATABLE READ'); return work(manager);
    }) };

    const snapshot = await new ActiveLoanExportTypeormReader(dataSource as never).read();

    expect(snapshot.candidates).toEqual([candidate]);
    expect(queries).toHaveLength(4);
    expect(queries[0].sql).toContain("WHERE l.status = 'ACTIVE'");
    expect(queries[0].sql).toContain('MAX(pe.due_date)');
    expect(queries[0].sql).not.toMatch(/\bLIMIT\b|\bOFFSET\b/);
    for (const query of queries.slice(1)) expect(query.params).toEqual([[loanId]]);
  });

  it('protects export and summary with their existing centralized permissions', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype.exportActiveLoans)).toEqual(['loans.export']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype.activeLoanSummary)).toEqual(['loans.view']);
  });
});
