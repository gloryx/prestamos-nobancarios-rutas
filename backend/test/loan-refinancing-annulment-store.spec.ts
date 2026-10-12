import type { DataSource } from 'typeorm';
import { LoanRefinancingAnnulmentTypeormStore } from '../src/infrastructure/database/typeorm/repositories/loan-refinancing-annulment.store';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

describe('refinancing annulment TypeORM transaction', () => {
  it('filters valid successor payments before candidate counting and applies server-side sorting', async () => {
    const sql: string[] = [];
    const manager = { query: jest.fn(async (text: string) => {
      sql.push(text);
      if (text.startsWith('SELECT COUNT(*)')) return [{ total: 0 }];
      if (text.startsWith('SELECT r.id')) return [];
      throw new Error(`Unexpected SQL: ${text}`);
    }) };
    const source = { transaction: async (_isolation: string, work: (value: typeof manager) => Promise<unknown>) => work(manager),
      query: jest.fn(async () => [{ id: uuid(1), name: 'Cash' }]) };
    const store = new LoanRefinancingAnnulmentTypeormStore(source as unknown as DataSource);

    await expect(store.listCandidates({ page: 1, pageSize: 10, sortBy: 'customer', sortDir: 'asc' }))
      .resolves.toEqual({ items: [], total: 0 });
    expect(sql[0]).toContain("NOT EXISTS (SELECT 1 FROM payments valid_payment");
    expect(sql[1]).toContain("ORDER BY lower(concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name)) ASC");
    await expect(store.listActivePaymentMethods()).resolves.toEqual([{ id: uuid(1), name: 'Cash' }]);
    expect(source.query).toHaveBeenCalledWith(expect.stringContaining('WHERE is_active = true'));
  });

  it('locks the edge and loans, reverses positive new money with the receiving method, links history and transitions all statuses', async () => {
    const sql: Array<{ text: string; params: unknown[] }> = [];
    const manager = { query: jest.fn(async (text: string, params: unknown[] = []) => {
      sql.push({ text, params });
      if (text.includes('FROM loan_refinancings r JOIN loans origin') && text.includes('FOR UPDATE OF r')) return [{
        refinancingId: uuid(1), status: 'CONFIRMED', refinancingDate: '2026-09-10',
        originLoanId: uuid(2), originLoanNumber: '100', originStatus: 'REFINANCED',
        successorLoanId: uuid(3), successorLoanNumber: '101', successorStatus: 'ACTIVE',
        outstandingPrincipalTransferred: '80.00', capitalizedOutstandingInterest: '20.00',
        newMoneyDisbursed: '50.00', newContractualTotal: '150.00', customer: { id: uuid(4) },
      }];
      if (text.startsWith('SELECT id FROM loans')) return [{ id: uuid(2) }, { id: uuid(3) }];
      if (text.startsWith('SELECT id FROM payment_methods')) return [{ id: params[0] }];
      if (text.includes('SUM(pending_amount) FILTER')) return [{ originPendingPlanAmount: '100.00', successorPendingPlanAmount: '150.00' }];
      if (text.startsWith('SELECT COUNT(*)::int AS count FROM loan_refinancings')) return [{ count: 0 }];
      if (text.includes('FROM loan_disbursements d')) return [{ id: uuid(5), amount: '50.00', date: '2026-09-10',
        methodId: uuid(6), cashMovementId: uuid(7), cashAmount: '50.00', cashDate: '2026-09-10',
        cashMethodId: uuid(6), cashDirection: 'OUTFLOW', cashConcept: 'REFINANCING_NEW_MONEY_DISBURSEMENT' }];
      if (text.includes('FROM payments p')) return [];
      if (text.startsWith('INSERT INTO loan_refinancing_annulments')) return [{ id: uuid(8) }];
      if (text.startsWith('INSERT INTO cash_movements')) return [{ id: uuid(9) }];
      if (text.startsWith('UPDATE loans')) return [[{ id: params[0] }], 1];
      if (text.startsWith('SELECT MAX(event_sequence)')) return [{ maxSequence: params[0] === uuid(2) ? 2 : 1 }];
      if (text.startsWith('INSERT INTO loan_status_history')) return [];
      if (text.startsWith('UPDATE loan_refinancings')) return [[{ id: uuid(1) }], 1];
      if (text.includes('FROM loan_refinancing_annulments a JOIN loan_refinancings')) return [{
        annulmentId: uuid(8), refinancingId: uuid(1), annulmentType: 'CASH_REFUND', effectiveDate: '2026-10-08',
        cashMovementId: uuid(9), originLoan: { id: uuid(2), loanNumber: '100', status: 'ACTIVE' },
        successorLoan: { id: uuid(3), loanNumber: '101', status: 'ANNULLED' },
      }];
      throw new Error(`Unexpected SQL: ${text}`);
    }) };
    const transaction = jest.fn(async (isolation: string, work: (value: typeof manager) => Promise<unknown>) => {
      expect(isolation).toBe('READ COMMITTED'); return work(manager);
    });
    const store = new LoanRefinancingAnnulmentTypeormStore({ transaction } as unknown as DataSource);
    const refundMethodId = uuid(11);
    await store.transaction(async (tx) => {
      const state = await tx.lockSnapshot(uuid(1));
      expect(state).toMatchObject({ status: 'CONFIRMED', originStatus: 'REFINANCED', successorStatus: 'ACTIVE' });
      await expect(tx.lockActivePaymentMethod(refundMethodId)).resolves.toBe(true);
      return tx.create({ refinancingId: uuid(1), annulmentType: 'CASH_REFUND', effectiveDate: '2026-10-08',
        disbursementResolution: 'RETURNED_IN_FULL', reason: 'Customer refund', actorId: uuid(10),
        refundPaymentMethodId: refundMethodId,
        idempotencyKey: 'refund-key', idempotencyFingerprint: 'fingerprint' });
    });

    expect(sql.find((row) => row.text.startsWith('SELECT id FROM loans'))?.text).toContain('ORDER BY id FOR UPDATE');
    expect(sql.find((row) => row.text.startsWith('SELECT id FROM payment_methods'))?.text).toContain('is_active = true FOR UPDATE');
    const cash = sql.find((row) => row.text.startsWith('INSERT INTO cash_movements'))!;
    expect(cash.text).toContain("VALUES ('INFLOW','REVERSAL'");
    expect(cash.text).toContain('refinancing_annulment_id');
    expect(cash.params.slice(0, 5)).toEqual(['50.00', '2026-10-08', refundMethodId, 'Customer refund', uuid(7)]);
    const histories = sql.filter((row) => row.text.startsWith('INSERT INTO loan_status_history'));
    expect(histories).toHaveLength(2);
    expect(histories.map((row) => row.params[6])).toEqual([null, 'RETURNED_IN_FULL']);
    expect(histories.map((row) => row.params.slice(-3))).toEqual([
      [uuid(1), uuid(8), 'ORIGIN'], [uuid(1), uuid(8), 'SUCCESSOR'],
    ]);
    expect(sql.findIndex((row) => row.text.startsWith('UPDATE loan_refinancings')))
      .toBeGreaterThan(sql.findLastIndex((row) => row.text.startsWith('INSERT INTO loan_status_history')));
  });

  it('compensates DATA_CORRECTION new money on the original date and method', async () => {
    const sql: Array<{ text: string; params: unknown[] }> = [];
    const manager = { query: jest.fn(async (text: string, params: unknown[] = []) => {
      sql.push({ text, params });
      if (text.includes('FROM loan_refinancings r JOIN loans origin') && text.includes('FOR UPDATE OF r')) return [{
        refinancingId: uuid(1), status: 'CONFIRMED', refinancingDate: '2026-09-10',
        originLoanId: uuid(2), originLoanNumber: '100', originStatus: 'REFINANCED',
        successorLoanId: uuid(3), successorLoanNumber: '101', successorStatus: 'ACTIVE',
        outstandingPrincipalTransferred: '80.00', capitalizedOutstandingInterest: '20.00',
        newMoneyDisbursed: '50.00', newContractualTotal: '150.00', customer: { id: uuid(4) },
      }];
      if (text.startsWith('SELECT id FROM loans')) return [{ id: uuid(2) }, { id: uuid(3) }];
      if (text.includes('SUM(pending_amount) FILTER')) return [{ originPendingPlanAmount: '100.00', successorPendingPlanAmount: '150.00' }];
      if (text.startsWith('SELECT COUNT(*)::int AS count FROM loan_refinancings')) return [{ count: 0 }];
      if (text.includes('FROM loan_disbursements d')) return [{ id: uuid(5), amount: '50.00', date: '2026-09-10',
        methodId: uuid(6), cashMovementId: uuid(7), cashAmount: '50.00', cashDate: '2026-09-10',
        cashMethodId: uuid(6), cashDirection: 'OUTFLOW', cashConcept: 'REFINANCING_NEW_MONEY_DISBURSEMENT' }];
      if (text.includes('FROM payments p')) return [];
      if (text.startsWith('INSERT INTO loan_refinancing_annulments')) return [{ id: uuid(8) }];
      if (text.startsWith('INSERT INTO cash_movements')) return [{ id: uuid(9) }];
      if (text.startsWith('UPDATE loans')) return [[{ id: params[0] }], 1];
      if (text.startsWith('SELECT MAX(event_sequence)')) return [{ maxSequence: params[0] === uuid(2) ? 2 : 1 }];
      if (text.startsWith('INSERT INTO loan_status_history')) return [];
      if (text.startsWith('UPDATE loan_refinancings')) return [[{ id: uuid(1) }], 1];
      if (text.includes('FROM loan_refinancing_annulments a JOIN loan_refinancings')) return [{
        annulmentId: uuid(8), refinancingId: uuid(1), annulmentType: 'DATA_CORRECTION', effectiveDate: '2026-09-10',
        cashMovementId: uuid(9), originLoan: { id: uuid(2), status: 'ACTIVE' },
        successorLoan: { id: uuid(3), status: 'ANNULLED' },
      }];
      throw new Error(`Unexpected SQL: ${text}`);
    }) };
    const source = { transaction: async (_isolation: string, work: (value: typeof manager) => Promise<unknown>) => work(manager) };
    const store = new LoanRefinancingAnnulmentTypeormStore(source as unknown as DataSource);
    await store.transaction(async (tx) => {
      await tx.lockSnapshot(uuid(1));
      return tx.create({ refinancingId: uuid(1), annulmentType: 'DATA_CORRECTION', effectiveDate: '2026-09-10',
        disbursementResolution: 'NOT_DELIVERED', reason: 'Incorrect refinancing', actorId: uuid(10), refundPaymentMethodId: null,
        idempotencyKey: 'correction-key', idempotencyFingerprint: 'fingerprint' });
    });
    const cash = sql.find((row) => row.text.startsWith('INSERT INTO cash_movements'))!;
    expect(cash.params.slice(0, 5)).toEqual(['50.00', '2026-09-10', uuid(6), 'Incorrect refinancing', uuid(7)]);
    expect(sql.filter((row) => row.text.startsWith('INSERT INTO loan_status_history')).map((row) => row.params[6]))
      .toEqual([null, 'NOT_DELIVERED']);
  });
});
