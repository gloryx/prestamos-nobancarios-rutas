import type { DataSource, QueryRunner } from 'typeorm';
import type { TransactionalCashMovementRecorder } from '../src/application/cash-movement/cash-movement.use-cases';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { LoanRefinancingTypeormStore } from '../src/infrastructure/database/typeorm/repositories/loan-refinancing.store';
import { CreateLoanRefinancings1761900000000 } from '../src/infrastructure/database/typeorm/migrations/1761900000000-create-loan-refinancings';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

describe('refinancing persistence contracts without a database connection', () => {
  it('searches ACTIVE candidates by loan number, identification or full name in two page-scoped SQL reads', async () => {
    const query = jest.fn(async (sql: string, args: unknown[]) => {
      if (sql.startsWith('SELECT COUNT')) return [{ total: 21 }];
      expect(sql).toContain('WITH page AS');
      expect(sql).toContain("l.status = 'ACTIVE'");
      expect(sql).toContain('l.loan_number::text ILIKE $1');
      expect(sql).toContain('c.identification ILIKE $1');
      expect(sql).toContain("concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) ILIKE $1");
      expect(sql).toContain("p.status = 'VALID' AND p.loan_id IN (SELECT id FROM page)");
      expect(sql).toContain('LIMIT $2 OFFSET $3');
      expect(args).toEqual(['%Customer%', 10, 10]);
      return [{ loanId: uuid(1), paidAmount: '30000.00', financialBalance: '150000.00' }];
    });
    const transaction = jest.fn(async (isolation: string, work: (manager: { query: typeof query }) => Promise<unknown>) => {
      expect(isolation).toBe('REPEATABLE READ');
      return work({ query });
    });
    const store = new LoanRefinancingTypeormStore({ transaction } as unknown as DataSource,
      new LoanFinancialTotalsTypeormReader(), {} as never);
    expect(await store.search({ search: 'Customer', page: 2, pageSize: 10 })).toEqual({
      total: 21, items: [{ loanId: uuid(1), paidAmount: '30000.00', financialBalance: '150000.00' }],
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('declares unique chain links, customer/cycle guards, immutable composition and paired refinancing cash', async () => {
    const statements: string[] = [];
    const q = { query: async (sql: string) => { statements.push(sql); return []; } } as unknown as QueryRunner;
    const migration = new CreateLoanRefinancings1761900000000();
    await migration.up(q);
    const sql = statements.join('\n');
    for (const required of ['UQ_refinancing_origin', 'UQ_refinancing_successor', 'UQ_refinancing_key',
      'origin_customer <> successor_customer', 'Refinancing cycle is not allowed', 'trg_refinancing_immutable',
      'outstanding_principal_transferred', 'capitalized_outstanding_interest', 'new_money_disbursed',
      'new_contractual_principal', 'new_contractual_total', 'loan_disbursement_id IS NOT NULL',
      'REFINANCING_NEW_MONEY_DISBURSEMENT', 'new_money_disbursed = d_amount', 'loans.refinance.create']) {
      expect(sql).toContain(required);
    }
    expect(sql).not.toContain('INSERT INTO role_permissions');
    const down: string[] = [];
    await migration.down({ query: async (statement: string) => { down.push(statement); return []; } } as unknown as QueryRunner);
    expect(down[0]).toContain('Cannot roll back refinancing schema with operations or granted permissions');
    expect(down.join('\n')).toContain('DROP TABLE loan_refinancings');
  });

  it('records only the positive new-money disbursement and linked cash through the SAME transaction manager', async () => {
    const manager = { query: jest.fn(async (sql: string, args?: unknown[]) => {
      if (sql.includes('INSERT INTO loan_disbursements')) {
        expect(args?.[1]).toBe('50000.00');
        return [{ id: uuid(4) }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }) };
    const transaction = jest.fn(async (work: (tx: typeof manager) => Promise<unknown>) => work(manager));
    const recorder = { recordWithManager: jest.fn(async () => ({ id: uuid(5) })) } as unknown as TransactionalCashMovementRecorder;
    const store = new LoanRefinancingTypeormStore({ transaction } as unknown as DataSource,
      new LoanFinancialTotalsTypeormReader(), recorder);
    await store.transaction(async (tx) => tx.disburseNewMoney({ refinancingId: uuid(8), newLoanId: uuid(2),
      amount: '50000.00', date: '2026-09-30', methodId: uuid(3), actorId: uuid(6) }));
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(recorder.recordWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({ direction: 'OUTFLOW',
      concept: 'REFINANCING_NEW_MONEY_DISBURSEMENT', amount: '50000.00', loanDisbursementId: uuid(4),
      paymentMethodId: uuid(3), movementDate: '2026-09-30' }));
  });

  it('uses a locked origin and conflict-safe insertion', async () => {
    const statements: string[] = [];
    const manager = { query: jest.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.startsWith('SELECT id FROM loans')) return [{ id: uuid(1) }];
      if (sql.includes('FROM loans l JOIN customers c')) return [{ id: uuid(1), principal: '1.00' }];
      if (sql.includes('FROM payment_plan_entries')) return [];
      if (sql.includes('FROM payments WHERE loan_id')) return [{ paidAmount: '0', paidPrincipal: '0', paidInterest: '0', invalidCount: 0 }];
      return [];
    }) };
    const transaction = jest.fn(async (...args: unknown[]) => {
      const work = args.at(-1) as (tx: typeof manager) => Promise<unknown>;
      return work(manager);
    });
    const store = new LoanRefinancingTypeormStore({ transaction } as unknown as DataSource,
      new LoanFinancialTotalsTypeormReader(), {} as never);
    await store.transaction(async (tx) => {
      await tx.lockOrigin(uuid(1));
      await tx.insertRefinancing({ originLoanId: uuid(1), newLoanId: uuid(2), outstandingPrincipalTransferred: '1.00',
        capitalizedOutstandingInterest: '0.00', newMoneyDisbursed: '0.00', newInterestAmount: '0.00',
        newContractualPrincipal: '1.00', newContractualTotal: '1.00', refinancingDate: '2026-09-30',
        createdByUserId: uuid(3), idempotencyKey: 'key', idempotencyFingerprint: 'fingerprint' });
    });
    expect(statements[0]).toContain('FOR UPDATE');
    expect(statements.find((sql) => sql.includes('INSERT INTO loan_refinancings'))).toContain('ON CONFLICT DO NOTHING RETURNING id');
  });

  it('removes data corrections from every cutoff while keeping cash refunds effective until their real date', async () => {
    const query = jest.fn(async (sql: string, args?: unknown[]) => {
      if (sql.includes('FROM payments p LEFT JOIN payment_annulments')) {
        expect(sql).toContain("p.status = 'ANNULLED'");
        expect(sql).toContain("(p.status = 'VALID') <> (annulment.id IS NULL)");
        expect(sql).toContain("annulment.annulled_at AT TIME ZONE 'America/Costa_Rica'");
        expect(sql).toContain("annulment.annulment_type = 'CASH_REFUND'");
        expect(sql).toContain("annulment.annulment_type = 'DATA_CORRECTION'");
        expect(sql).toContain('annulment.annulled_at AT TIME ZONE');
        expect(sql).toContain('p.payment_date > $2::date');
        expect(args).toEqual([uuid(1), '2026-09-30']);
        return [{ paidAmount: '30040.00', paidPrincipal: '30040.00', paidInterest: '0.00',
          invalidCount: 0, lastValidPaymentDate: '2026-09-10', laterPaymentCount: 0 }];
      }
      return [];
    });
    const transaction = jest.fn(async (work: (tx: { query: typeof query }) => Promise<unknown>) => work({ query }));
    const store = new LoanRefinancingTypeormStore({ transaction } as unknown as DataSource,
      new LoanFinancialTotalsTypeormReader(), {} as never);
    await store.transaction(async (tx) => {
      await expect(tx.readHistoricalPayments(uuid(1), '2026-09-30')).resolves.toEqual({
        totals: { paidAmount: '30040.00', paidPrincipal: '30040.00', paidInterest: '0.00', invalidCount: 0 },
        lastValidPaymentDate: '2026-09-10', laterPaymentCount: 0,
      });
    });
  });

  it('loads each customer graph in three bounded queries regardless of chain length', async () => {
    const query = jest.fn(async (sql: string, args: unknown[]) => {
      if (sql.includes('FROM loans l JOIN customers c')) return [{ id: uuid(6), fullName: 'Customer', identification: '123' }];
      if (sql.includes('FROM customers c WHERE')) return [{ id: uuid(6), fullName: 'Customer', identification: '123' }];
      if (sql.includes('FROM loan_refinancings r')) {
        expect(args).toEqual([uuid(6), 2049]);
        return [{ refinancingId: uuid(8), originLoanId: uuid(1), newLoanId: uuid(2),
          capitalizedOutstandingInterest: '20000.00', newMoneyDisbursed: '52000.00' }];
      }
      expect(args).toEqual([[uuid(1), uuid(2)]]);
      return [{ loanId: uuid(1), principal: '100000.00', paidAmount: '72000.00', invalidCount: 0 },
        { loanId: uuid(2), principal: '100000.00', paidAmount: '0.00', invalidCount: 0 }];
    });
    const transaction = jest.fn(async (isolation: string, work: (manager: { query: typeof query }) => Promise<unknown>) => {
      expect(isolation).toBe('REPEATABLE READ'); return work({ query });
    });
    const store = new LoanRefinancingTypeormStore({ transaction } as unknown as DataSource,
      new LoanFinancialTotalsTypeormReader(), {} as never);
    expect(await store.chainGraphForLoan(uuid(2))).toMatchObject({ customer: { id: uuid(6) },
      transitions: [{ capitalizedOutstandingInterest: '20000.00' }], loans: [{ paidAmount: '72000.00' }, {}] });
    expect(await store.chainsForCustomer(uuid(6))).toMatchObject({ customer: { id: uuid(6) },
      transitions: [{ newMoneyDisbursed: '52000.00' }] });
    expect(query).toHaveBeenCalledTimes(6);
    const edgeSql = query.mock.calls[1][0];
    expect(edgeSql).toContain('WHERE origin.customer_id = $1 OR successor.customer_id = $1');
    expect(edgeSql).toContain('LIMIT $2');
    expect(edgeSql).toContain('r.capitalized_outstanding_interest::text AS "capitalizedOutstandingInterest"');
    const loanSql = query.mock.calls[2][0];
    expect(loanSql).toContain("WHERE status = 'VALID' AND loan_id = ANY($1::uuid[])");
    expect(loanSql).toContain('SUM(principal_applied)');
    expect(loanSql).toContain('SUM(interest_applied)');
    expect(loanSql).toContain('FROM payment_plan_entries WHERE loan_id = ANY($1::uuid[])');
    expect(loanSql).toContain('LEFT JOIN loan_disbursements d ON d.loan_id = l.id');
    expect(loanSql).not.toContain('WITH RECURSIVE');
  });

  it('reads confirmation/detail with nullable disbursement and joins names without additional round trips', async () => {
    const query = jest.fn(async (sql: string) => {
      expect(sql).toContain('LEFT JOIN loan_disbursements d ON d.loan_id = successor.id');
      expect(sql).toContain('LEFT JOIN payment_methods dm ON dm.id = d.payment_method_id');
      expect(sql).toContain('JOIN customers c ON c.id = successor.customer_id');
      expect(sql).toContain('JOIN payment_frequencies pf ON pf.id = successor.payment_frequency_id');
      expect(sql).toContain('successor.observations');
      return [{ id: uuid(9), disbursementId: null, cashMovementId: null, disbursementPaymentMethodName: null }];
    });
    const transaction = jest.fn(async (isolation: string, work: (manager: { query: typeof query }) => Promise<unknown>) => {
      expect(isolation).toBe('REPEATABLE READ');
      return work({ query });
    });
    const store = new LoanRefinancingTypeormStore({ transaction } as unknown as DataSource,
      new LoanFinancialTotalsTypeormReader(), {} as never);
    expect(await store.detail(uuid(9))).toMatchObject({ disbursementId: null, disbursementPaymentMethodName: null });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
