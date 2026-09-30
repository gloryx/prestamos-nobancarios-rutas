import 'reflect-metadata';
import { validate } from 'class-validator';
import { ListLoansUseCase } from '../src/application/loan/loan.use-case';
import { ACTIVE_LOAN_OVERDUE_SQL } from '../src/application/loan/active-loan-condition.sql';
import { PaymentContextUseCase } from '../src/application/payment/payment.use-case';
import { LoanListQueryDto } from '../src/presentation/loan/loan.dto';

describe('active loan list sorting', () => {
  it('rejects values outside the public sort allowlists', async () => {
    const query = Object.assign(new LoanListQueryDto(), { sortBy: 'createdAt', sortOrder: 'ASC' });
    const errors = await validate(query);
    expect(errors.flatMap((error) => Object.values(error.constraints ?? {}))).toEqual(expect.arrayContaining([
      'sortBy must be one of the following values: number, customer, startDate, principal, interest, total, frequency, pending, condition',
      'sortOrder must be one of the following values: asc, desc',
    ]));
    expect(await validate(Object.assign(new LoanListQueryDto(), { sortBy: 'condition', sortOrder: 'asc' }))).toEqual([]);
  });

  it.each([
    ['number', 'l.loan_number'], ['customer', 'LOWER(CONCAT_WS'], ['startDate', 'l.start_date'],
    ['principal', 'l.principal'], ['interest', 'l.interest_amount'], ['total', 'l.total_amount'],
    ['frequency', 'LOWER(pf.name)'], ['pending', 'COALESCE((SELECT SUM(pe.pending_amount)'], ['condition', '"isOverdue"'],
  ] as const)('sorts by %s in both directions before pagination', async (sortBy, expression) => {
    const queries: string[] = [];
    const dataSource = { query: async (sql: string) => { queries.push(sql); return sql.startsWith('SELECT COUNT') ? [{ total: 2 }] : []; } };
    const useCase = new ListLoansUseCase(dataSource as never);

    await useCase.execute({ page: 2, pageSize: 20, sortBy, sortOrder: 'asc', search: 'ana', frequencyId: 'frequency-1', fromDate: '2026-01-01', toDate: '2026-12-31' });
    await useCase.execute({ page: 1, pageSize: 20, sortBy, sortOrder: 'desc' });

    expect(queries[0]).toContain(`ORDER BY ${expression}`);
    expect(queries[0]).toContain(sortBy === 'number' ? ' ASC, l.id ASC LIMIT' : ' ASC, l.loan_number DESC, l.id ASC LIMIT');
    expect(queries[0].indexOf('ORDER BY')).toBeLessThan(queries[0].indexOf('LIMIT'));
    expect(queries[0]).toContain("l.status = 'ACTIVE'");
    expect(queries[0]).toContain('l.payment_frequency_id = $1');
    expect(queries[0]).toContain('l.start_date >= $2');
    expect(queries[0]).toContain('l.start_date <= $3');
    expect(queries[2]).toContain(`ORDER BY ${expression}`);
    expect(queries[2]).toContain(sortBy === 'number' ? ' DESC, l.id ASC LIMIT' : ' DESC, l.loan_number DESC, l.id ASC LIMIT');
  });

  it('uses the default loan number descending order and preserves active-only counting', async () => {
    const queries: string[] = [];
    const dataSource = { query: async (sql: string) => { queries.push(sql); return sql.startsWith('SELECT COUNT') ? [{ total: 1 }] : [{ id: 'loan-1', isOverdue: false, pendingTotal: '20.00' }]; } };
    const result = await new ListLoansUseCase(dataSource as never).execute({ page: 1, pageSize: 20 });

    expect(queries[0]).toContain("ORDER BY l.loan_number DESC, l.id ASC LIMIT");
    expect(queries[1]).toContain("WHERE l.status = 'ACTIVE'");
    expect(result).toMatchObject({ items: [{ id: 'loan-1', isOverdue: false, pendingTotal: '20.00' }], total: 1, page: 1, pageSize: 20 });
  });

  it('projects the exact payment-selector predicate without joins or extra per-loan requests', async () => {
    const sql: string[] = [];
    const dataSource = { query: async (statement: string) => { sql.push(statement); return statement.includes('COUNT(*)') ? [{ total: 2 }] : []; } };
    await new ListLoansUseCase(dataSource as never).execute({ page: 2, pageSize: 20 });
    await new PaymentContextUseCase(dataSource as never, {} as never).listLoans({ page: 1, pageSize: 20 });

    const lists = sql.filter((statement) => statement.includes(' AS "isOverdue"'));
    expect(lists).toHaveLength(2);
    for (const statement of lists) {
      expect(statement).toContain(`${ACTIVE_LOAN_OVERDUE_SQL} AS "isOverdue"`);
      expect(statement).toContain("l.status = 'ACTIVE'");
      expect(statement).toContain('LIMIT');
      expect(statement).not.toContain('JOIN payment_plan_entries');
    }
    expect(ACTIVE_LOAN_OVERDUE_SQL).toBe('EXISTS (SELECT 1 FROM payment_plan_entries e WHERE e.loan_id = l.id AND e.pending_amount > 0 AND e.due_date < CURRENT_DATE)');
    expect(sql).toHaveLength(4);
    expect(sql.filter((statement) => statement.includes('COUNT(*)'))).toHaveLength(2);
  });

  it('keeps condition sorting ahead of pagination and filtered count with stable loan and id ties', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const dataSource = { query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return sql.includes('COUNT(*)') ? [{ total: 43 }] : []; } };
    const list = new ListLoansUseCase(dataSource as never);
    const filters = { search: 'Ana', frequencyId: 'frequency-1', fromDate: '2026-01-01', toDate: '2026-09-29' };
    const asc = await list.execute({ page: 2, pageSize: 20, ...filters, sortBy: 'condition', sortOrder: 'asc' });
    const desc = await list.execute({ page: 1, pageSize: 20, ...filters, sortBy: 'condition', sortOrder: 'desc' });

    expect(asc).toMatchObject({ total: 43, page: 2, pageSize: 20 });
    expect(desc).toMatchObject({ total: 43, page: 1, pageSize: 20 });
    expect(calls[0].sql).toContain('ORDER BY "isOverdue" ASC, l.loan_number DESC, l.id ASC LIMIT $5 OFFSET $6');
    expect(calls[2].sql).toContain('ORDER BY "isOverdue" DESC, l.loan_number DESC, l.id ASC LIMIT $5 OFFSET $6');
    expect(calls[0].params).toEqual(['frequency-1', '2026-01-01', '2026-09-29', '%Ana%', 20, 20]);
    expect(calls[2].params).toEqual(['frequency-1', '2026-01-01', '2026-09-29', '%Ana%', 20, 0]);
    expect(calls[1].sql).toContain("WHERE l.status = 'ACTIVE' AND l.payment_frequency_id = $1 AND l.start_date >= $2 AND l.start_date <= $3");
    expect(calls[1].sql).toContain('c.secondary_phone ILIKE $4');
    expect(calls[1].sql).not.toContain('LIMIT');
    expect(calls[1].params).toEqual(calls[0].params.slice(0, -2));
  });

  it('encodes strictly earlier positive obligations even if sequence differs', () => {
    const asOf = '2026-09-29';
    const cases = [
      { entries: [{ due: asOf, pending: 10, sequence: 1 }], overdue: false },
      { entries: [{ due: '2026-09-28', pending: 10, sequence: 1 }], overdue: true },
      { entries: [{ due: '2026-09-01', pending: 0, sequence: 1 }, { due: asOf, pending: 10, sequence: 2 }], overdue: false },
      { entries: [{ due: asOf, pending: 10, sequence: 1 }, { due: '2026-09-01', pending: 1, sequence: 9 }], overdue: true },
    ];
    expect(ACTIVE_LOAN_OVERDUE_SQL).toContain('e.pending_amount > 0 AND e.due_date < CURRENT_DATE');
    expect(ACTIVE_LOAN_OVERDUE_SQL).not.toContain('sequence');
    for (const { entries, overdue } of cases) {
      expect(entries.some(({ due, pending }) => pending > 0 && due < asOf)).toBe(overdue);
    }
  });
});
