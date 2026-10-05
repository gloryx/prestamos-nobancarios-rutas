import { FinancialCloseTypeOrmStore } from '../src/infrastructure/database/typeorm/repositories/financial-close.typeorm-store';

describe('financial close TypeORM store', () => {
  it('reads first-period cash balances independently and preserves reversal source concepts', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('initial_available_amount::text')) return [{ openingDate: '2026-01-15', initialAvailableAmount: '100.00',
        initialPortfolio: '80.00', initialUncollectibleAmount: '10.00' }];
      if (sql.includes('initial_portfolio::numeric')) return [{ date: '2026-01-15', initialPortfolio: '80.00' }];
      if (sql.includes('FROM loans l')) return [];
      if (sql.includes('FROM loan_refinancings')) return [];
      if (sql.includes('FROM payments p')) return [];
      if (sql.includes('original.concept AS "reversedConcept"')) return [{ direction: 'INFLOW', concept: 'REVERSAL',
        amount: '20.00', date: '2026-01-20', reversedConcept: 'LOAN_DISBURSEMENT' }];
      if (sql.includes('AS opening') && sql.includes('AS closing')) return [{ opening: '100.00', closing: '120.00' }];
      if (sql.includes('FROM loan_status_history')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const source = { transaction: jest.fn(async (_level: string, work: (manager: unknown) => unknown) => work({ query })) };
    const result = await new FinancialCloseTypeOrmStore(source as never).previewSource('2026-01-01', '2026-01-31');
    expect(result.effectiveFromDate).toBe('2026-01-15');
    expect(result.openingEconomic).toBeNull();
    expect(result.cashBalances).toEqual({ opening: '100.00', closing: '120.00' });
    expect(result.cashFacts[0]).toMatchObject({ concept: 'REVERSAL', reversedConcept: 'LOAN_DISBURSEMENT' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('movement.movement_date < $1::date'))).toBe(true);
  });

  it('confirms under SERIALIZABLE isolation and the financial-close advisory lock', async () => {
    const query = jest.fn(async () => []);
    const transaction = jest.fn(async (level: string, work: (manager: unknown) => unknown) => work({ query }));
    const store = new FinancialCloseTypeOrmStore({ transaction } as never);
    await store.confirm(async (tx) => { await tx.lock(); return 'ok'; });
    expect(transaction.mock.calls[0][0]).toBe('SERIALIZABLE');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock(hashtext('financial-closes-v2'))"));
  });

  it('inserts the unsealed header, appends details, seals once, and only then exposes the snapshot', async () => {
    const sqlOrder: string[] = [];
    const query = jest.fn(async (sql: string) => {
      sqlOrder.push(sql);
      if (sql.includes('INSERT INTO financial_closes')) return [{ id: 'close-1' }];
      if (sql.includes('INSERT INTO financial_close_concepts')) return [];
      if (sql.includes('UPDATE financial_closes SET confirmed_at')) return [{ confirmedAt: new Date() }];
      if (sql.includes('FROM financial_closes fc')) return [{ id: 'close-1', period: '2026-01', sequence: 1, modelVersion: 2,
        fromDate: '2026-01-01', toDate: '2026-01-31', integrityStatus: 'COMPLETE', blockingIssues: [], warnings: [],
        confirmedAt: new Date(), confirmedById: 'actor', confirmedByName: 'Actor' }];
      if (sql.includes('FROM financial_close_concepts')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const source = { transaction: jest.fn(async (_level: string, work: (manager: unknown) => unknown) => work({ query })) };
    const store = new FinancialCloseTypeOrmStore(source as never);
    await store.confirm((tx) => tx.insert({ modelVersion: 2, period: '2026-01', fromDate: '2026-01-01', toDate: '2026-01-31',
      integrity: { status: 'COMPLETE', blockingIssues: [], warnings: [] }, sections: [{ code: 'LIQUIDITY', concepts: [{
        section: 'LIQUIDITY', code: 'SALDO_CAJA_FINAL', label: 'Saldo final', classification: 'BALANCE', amount: '10.00', ordinal: 1,
      }] }] }, 1, 'actor'));
    const headerInsert = sqlOrder.findIndex((sql) => sql.includes('INSERT INTO financial_closes'));
    const conceptInsert = sqlOrder.findIndex((sql) => sql.includes('INSERT INTO financial_close_concepts'));
    const seal = sqlOrder.findIndex((sql) => sql.includes('UPDATE financial_closes SET confirmed_at'));
    const read = sqlOrder.findIndex((sql) => sql.includes('FROM financial_closes fc'));
    expect(headerInsert).toBeLessThan(conceptInsert);
    expect(conceptInsert).toBeLessThan(seal);
    expect(seal).toBeLessThan(read);
    expect(sqlOrder[headerInsert]).not.toContain('confirmed_at');
    expect(sqlOrder[read]).toContain('fc.confirmed_at IS NOT NULL');
  });
});
