import type { DataSource } from 'typeorm';
import { CreateLoanUseCase } from '../src/application/loan/loan.use-case';
import { LoanController } from '../src/presentation/loan/loan.controller';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

describe('loan detail operational read contract', () => {
  const loan = { id: 'loan-1', loanNumber: '31', status: 'UNCOLLECTIBLE', principal: '100.00', interestAmount: '20.00', totalAmount: '120.00', paymentFrequencyId: 'frequency-1', frequencyName: 'Monthly', preferredPaymentMethodId: 'method-1', preferredPaymentMethod: 'Cash' };
  const plan = [{ id: 'entry-3', sequence: 3, dueDate: '2026-04-02', pendingAmount: '95.00' }];
  const facts = [
    { id: 'payment-a', paymentDate: '2026-04-01', amount: '15.00', status: 'VALID' },
    { id: 'payment-b', paymentDate: '2026-04-01', amount: '10.00', status: 'VALID' },
  ];

  function reader() {
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      expect(params).toEqual(['loan-1']);
      if (sql.startsWith('SELECT l.id')) return [loan];
      if (sql.includes('FROM payment_plan_entries')) return plan;
      if (sql.includes('FROM payments WHERE')) return facts;
      if (sql.includes('FROM payment_applications pa')) return [];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const unboundQuery = jest.fn(() => { throw new Error('A read escaped the transaction.'); });
    const transaction = jest.fn(async (isolation: string, callback: (manager: { query: typeof query }) => Promise<unknown>) => {
      expect(isolation).toBe('REPEATABLE READ');
      return callback({ query });
    });
    const useCase = new CreateLoanUseCase({ manager: { query: unboundQuery }, transaction } as unknown as DataSource, {} as never);
    return { query, transaction, unboundQuery, useCase };
  }

  it('keeps the existing loans.view route and independent payments.view guard', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LoanController.prototype.detail)).toEqual(['loans.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentController.prototype.detail)).toEqual(['payments.view']);
  });

  it('reads the loan, plan, VALID payments and carry provenance in one transaction', async () => {
    const { query, transaction, unboundQuery, useCase } = reader();
    const controller = new LoanController(useCase, {} as never, {} as never, {} as never, {} as never, {} as never);
    expect(await controller.detail('loan-1')).toMatchObject({ ...loan, plan, validPayments: facts, financialBalance: '95.00' });
    expect(query).toHaveBeenCalledTimes(4);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(unboundQuery).not.toHaveBeenCalled();
    expect(query.mock.calls[1][0]).toContain('SELECT id, sequence, due_date::text');
    expect(query.mock.calls[2][0]).toContain("status='VALID'");
    expect(query.mock.calls[3][0]).toContain('FROM payment_applications pa');
    expect(query.mock.calls.every(([sql]) => !/\b(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(true);
    expect(query.mock.calls[0][0]).toContain('pf.id AS "paymentFrequencyId", pf.name AS "frequencyName"');
    expect(query.mock.calls[0][0]).toContain('pm.id AS "preferredPaymentMethodId", pm.name AS "preferredPaymentMethod"');
    expect(query.mock.calls[0][0]).toContain('LEFT JOIN loan_disbursements d ON d.loan_id=l.id');
  });

  it('keeps the creation/replay detail shape and avoids operational payment reads', async () => {
    const { query, transaction, useCase } = reader();
    expect(await useCase.detail({ query } as never, 'loan-1')).toEqual({ ...loan, plan });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).not.toContain('SELECT id, sequence');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not mix a pre-payment header/plan with payments committed during the read', async () => {
    const before = { header: { ...loan, status: 'ACTIVE' }, plan, payments: facts };
    let outside = { ...before };
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT l.id')) {
        outside = { header: { ...loan, status: 'CANCELLED' }, plan: [], payments: [{ ...facts[0], amount: '120.00' }] };
        return [before.header];
      }
      return sql.includes('FROM payment_plan_entries') ? before.plan : sql.includes('FROM payment_applications pa') ? [] : before.payments;
    });
    const unboundQuery = jest.fn(async (sql: string) => sql.includes('FROM payment_plan_entries') ? outside.plan : outside.payments);
    const transaction = jest.fn(async (isolation: string, callback: (manager: { query: typeof query }) => Promise<unknown>) => {
      expect(isolation).toBe('REPEATABLE READ');
      return callback({ query });
    });
    const useCase = new CreateLoanUseCase({ transaction, manager: { query: unboundQuery } } as unknown as DataSource, {} as never);
    expect(await useCase.get('loan-1')).toMatchObject({ status: 'ACTIVE', plan, validPayments: facts, financialBalance: '95.00' });
    expect(query).toHaveBeenCalledTimes(4);
    expect(unboundQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['CANCELLED', [{ ...facts[0], amount: '120.00' }], '0.00'],
    ['UNCOLLECTIBLE', facts, '95.00'],
  ])('keeps the actual balance for %s independently of loan status', async (status, payments, balance) => {
    const query = jest.fn(async (sql: string) => sql.startsWith('SELECT l.id') ? [{ ...loan, status }] : sql.includes('FROM payments WHERE') ? payments : plan);
    const transaction = jest.fn(async (_isolation: string, callback: (manager: { query: typeof query }) => Promise<unknown>) => callback({ query }));
    expect((await new CreateLoanUseCase({ transaction } as unknown as DataSource, {} as never).get('loan-1')).financialBalance).toBe(balance);
  });
});
