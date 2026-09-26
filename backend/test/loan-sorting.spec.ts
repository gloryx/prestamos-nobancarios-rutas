import 'reflect-metadata';
import { validate } from 'class-validator';
import { ListLoansUseCase } from '../src/application/loan/loan.use-case';
import { LoanListQueryDto } from '../src/presentation/loan/loan.dto';

describe('active loan list sorting', () => {
  it('rejects values outside the public sort allowlists', async () => {
    const query = Object.assign(new LoanListQueryDto(), { sortBy: 'createdAt', sortOrder: 'ASC' });
    const errors = await validate(query);
    expect(errors.flatMap((error) => Object.values(error.constraints ?? {}))).toEqual(expect.arrayContaining([
      'sortBy must be one of the following values: number, customer, startDate, principal, interest, total, frequency, pending',
      'sortOrder must be one of the following values: asc, desc',
    ]));
  });

  it.each([
    ['number', 'l.loan_number'], ['customer', 'LOWER(CONCAT_WS'], ['startDate', 'l.start_date'],
    ['principal', 'l.principal'], ['interest', 'l.interest_amount'], ['total', 'l.total_amount'],
    ['frequency', 'LOWER(pf.name)'], ['pending', 'COALESCE((SELECT SUM(pe.pending_amount)'],
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
    const dataSource = { query: async (sql: string) => { queries.push(sql); return sql.startsWith('SELECT COUNT') ? [{ total: 1 }] : []; } };
    await new ListLoansUseCase(dataSource as never).execute({ page: 1, pageSize: 20 });

    expect(queries[0]).toContain("ORDER BY l.loan_number DESC, l.id ASC LIMIT");
    expect(queries[1]).toContain("WHERE l.status = 'ACTIVE'");
  });
});
