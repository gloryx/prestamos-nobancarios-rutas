import type { DataSource } from 'typeorm';
import { PaymentContextUseCase } from '../src/application/payment/payment.use-case';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';

const totalsReader = new LoanFinancialTotalsTypeormReader();

describe('payment selector and context', () => {
  it('counts every filtered active loan while limiting the requested page', async () => {
    const query = jest.fn().mockImplementation(async (sql: string) => sql.includes('COUNT(*)')
      ? [{ total: 37 }]
      : [{ id: 'loan-21', loanNumber: '21', identification: '101', customerName: 'Ana', financialBalance: '40.00', isOverdue: true }]);
    const useCase = new PaymentContextUseCase({ query } as unknown as DataSource, totalsReader);
    const result = await useCase.listLoans({ search: ' Ana ', page: 2, pageSize: 5 });
    expect(result).toMatchObject({ total: 37, page: 2, pageSize: 5, items: [{ isOverdue: true, identification: '101' }] });
    const [listSql, listParams] = query.mock.calls.find(([sql]) => String(sql).includes('LIMIT'))!;
    const [countSql, countParams] = query.mock.calls.find(([sql]) => String(sql).includes('COUNT(*)'))!;
    expect(listSql).toContain("l.status = 'ACTIVE'");
    expect(listSql).toContain('l.loan_number::text ILIKE $1');
    expect(listSql).toContain('c.identification ILIKE $1');
    expect(listSql).toContain('c.primary_phone ILIKE $1');
    expect(listSql).toContain('c.first_name');
    expect(listSql).toContain('EXISTS (SELECT 1 FROM payment_plan_entries');
    expect(listSql).toContain('e.pending_amount > 0 AND e.due_date < CURRENT_DATE');
    expect(listSql).toContain('LIMIT $2 OFFSET $3');
    expect(listParams).toEqual(['%Ana%', 5, 5]);
    expect(countSql).toContain("l.status = 'ACTIVE'");
    expect(countSql).toContain('c.identification ILIKE $1');
    expect(countSql).toContain('c.primary_phone ILIKE $1');
    expect(countSql).not.toContain('LIMIT');
    expect(countParams).toEqual(['%Ana%']);
    expect(await useCase.listLoans({ page: 1, pageSize: 20 })).toMatchObject({ total: 37, page: 1 });
    const controller = new PaymentController({} as never, useCase, {} as never);
    await controller.loans({ page: '3', pageSize: '5', search: '101' });
    const [, params] = query.mock.calls.filter(([sql]) => String(sql).includes('LIMIT')).at(-1)!;
    expect(params).toEqual(['%101%', 5, 10]);
    await controller.loans({ page: 'Infinity', pageSize: '0' });
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('LIMIT')).at(-1)![1]).toEqual([20, 0]);
  });

  it('returns valid payments separately from only positive current obligations', async () => {
    const query = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM loans l JOIN customers c')) return [{ loanId: 'loan-1', loanNumber: '7', customerName: 'Ana', identification: '101', totalAmount: '100.00', principal: '70.00', interestAmount: '30.00', paidAmount: '40.00', pendingAmount: '60.00', preferredMethodId: 'method-1' }];
      if (sql.includes('SUM(principal_applied)')) return [{ paidAmount: '40.00', paidPrincipal: '40.00', paidInterest: '0.00', invalidCount: 0 }];
      if (sql.includes('FROM payments WHERE loan_id')) return [
        { id: 'p1', paymentDate: '2026-01-02', amount: '40.00', status: 'VALID' },
        { id: 'p2', paymentDate: '2026-01-03', amount: '10.00', status: 'ANNULLED' },
      ];
      if (sql.includes('FROM payment_plan_entries')) return [{ id: 'e1', dueDate: '2026-01-01', sequence: 1, pendingAmount: '60.00' }];
      if (sql.includes('FROM payment_methods')) return [{ id: 'method-1', name: 'Cash' }];
      if (sql.includes('FROM collectors')) return [];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const context = await new PaymentContextUseCase({ query } as unknown as DataSource, totalsReader).execute('loan-1');
    expect(context.summary).toMatchObject({ customerName: 'Ana', identification: '101', loanNumber: '7' });
    expect(context.balances).toEqual({ outstandingPrincipal: '30.00', outstandingInterest: '30.00', financialBalance: '60.00' });
    expect(context.validPayments).toEqual([{ id: 'p1', paymentDate: '2026-01-02', amount: '40.00', status: 'VALID' }]);
    expect(context.combinedPlan).toEqual([{ id: 'e1', dueDate: '2026-01-01', sequence: 1, pendingAmount: '60.00' }]);
    expect(context.firstOperationalRow).toEqual(context.combinedPlan[0]);
    expect(context.lastValidPayment).toMatchObject({ id: 'p1' });
    expect(context.firstOperationalRow?.dueDate).toBe('2026-01-01');
    expect(context.validPayments[0].paymentDate).toBe('2026-01-02');
    expect(context.lastValidPayment).toMatchObject({ paymentDate: '2026-01-02' });
    expect(context.preferredMethod).toMatchObject({ activeMethods: [{ id: 'method-1', name: 'Cash' }] });
    expect(query.mock.calls.find(([sql]) => String(sql).includes('FROM payment_plan_entries WHERE'))![0]).toContain('due_date::text AS "dueDate"');
    expect(query.mock.calls.find(([sql]) => String(sql).includes('FROM payments WHERE loan_id'))![0]).toContain('payment_date::text AS "paymentDate"');
  });
});
