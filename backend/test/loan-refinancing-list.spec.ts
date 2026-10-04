import type { DataSource } from 'typeorm';
import { LoanRefinancingUseCase, RefinancingValidationError } from '../src/application/loan-refinancing/refinancing.use-case';
import type { RefinancingListItem, RefinancingListQuery, RefinancingStore } from '../src/application/loan-refinancing/refinancing.port';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';
import { LoanRefinancingTypeormStore } from '../src/infrastructure/database/typeorm/repositories/loan-refinancing.store';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const customerId = uuid(1);
const item = (number: number, date = '2026-10-02'): RefinancingListItem => ({
  refinancingId: uuid(number), refinancingDate: date,
  customer: { id: customerId, fullName: 'TEST REFINANCING CUSTOMER', identification: 'TEST-101' },
  originLoan: { id: uuid(number + 20), loanNumber: String(number + 100) },
  newLoan: { id: uuid(number + 30), loanNumber: String(number + 101) },
  outstandingPrincipalTransferred: '120000.00', capitalizedOutstandingInterest: '30000.00',
  newMoneyDisbursed: '50000.00', newContractualPrincipal: '200000.00',
  newInterestAmount: '40000.00', newContractualTotal: '240000.00',
});
const useCase = (items: RefinancingListItem[] = [], total = items.length) => {
  const list = jest.fn(async (_query: RefinancingListQuery) => ({ items, total }));
  return { list, useCase: new LoanRefinancingUseCase({ list } as unknown as RefinancingStore) };
};

describe('historical refinancing operations list', () => {
  it('returns an empty first page with the existing items envelope and defaults', async () => {
    const { list, useCase: service } = useCase();
    expect(await service.list({})).toEqual({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
    expect(list).toHaveBeenCalledWith({ search: undefined, customerId: undefined,
      dateFrom: undefined, dateTo: undefined, page: 1, pageSize: 20 });
  });

  it('keeps two operations of a sequence as separate rows and returns correct page metadata', async () => {
    const operations = [item(3), item(2, '2026-10-01')];
    const { list, useCase: service } = useCase(operations, 21);
    expect(await service.list({ page: 2, pageSize: 10 })).toEqual({ items: operations,
      page: 2, pageSize: 10, total: 21, totalPages: 3 });
    expect(operations.map((row) => row.refinancingId)).toEqual([uuid(3), uuid(2)]);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 10 }));
  });

  it('normalizes search whitespace, supports all filter combinations and preserves inclusive date strings', async () => {
    const { list, useCase: service } = useCase([item(3)]);
    for (const filters of [
      { search: '  TEST    refinancing   ' }, { customerId }, { dateFrom: '2026-10-01' },
      { dateTo: '2026-10-02' }, { dateFrom: '2026-10-01', dateTo: '2026-10-02' },
      { search: 'TEST', customerId }, { search: 'TEST', dateFrom: '2026-10-01', dateTo: '2026-10-02' },
      { customerId, dateFrom: '2026-10-01', dateTo: '2026-10-02' },
      { search: ' TEST  refinancing ', customerId, dateFrom: '2026-10-01', dateTo: '2026-10-02' },
    ]) {
      await service.list(filters);
      expect(list).toHaveBeenLastCalledWith({ search: filters.search?.replace(/\s+/g, ' ').trim(),
        customerId: filters.customerId, dateFrom: filters.dateFrom, dateTo: filters.dateTo, page: 1, pageSize: 20 });
    }
  });

  it.each([{ page: 0 }, { page: 1.5 }, { pageSize: 100 }, { pageSize: 0 },
    { page: Number.MAX_SAFE_INTEGER }, { search: 'a'.repeat(121) }, { customerId: 'invalid' },
    { dateFrom: '2026-02-30' }, { dateTo: '2026-13-01' },
    { dateFrom: '2026-10-03', dateTo: '2026-10-02' }])('validates list query %p before calling persistence', async (raw) => {
    const { list, useCase: service } = useCase();
    await expect(service.list(raw)).rejects.toBeInstanceOf(RefinancingValidationError);
    expect(list).not.toHaveBeenCalled();
  });

  it.each(['103', '104', 'test refinancing', 'REFINANCING', 'TEST-101'])(
    'binds partial search %s for origin, successor, customer name or identification', async (search) => {
      const query = jest.fn(async (sql: string, _params: unknown[]) =>
        sql.startsWith('SELECT COUNT') ? [{ total: 1 }] : [item(3)]);
      const transaction = async (_isolation: string, work: (manager: { query: typeof query }) => Promise<unknown>) =>
        work({ query });
      const store = new LoanRefinancingTypeormStore({ transaction } as unknown as DataSource,
        new LoanFinancialTotalsTypeormReader(), {} as never);
      const result = await store.list({ search, page: 1, pageSize: 20 });
      expect(result.items).toHaveLength(1);
      expect(query.mock.calls[0][1]).toEqual([`%${search}%`]);
      expect(query.mock.calls[1][1]).toEqual([`%${search}%`, 20, 0]);
    });

  it('uses two bounded SQL reads under one repeatable snapshot and filters using only operation fields and joins', async () => {
    const persisted = item(4);
    const query = jest.fn(async (sql: string, _params: unknown[]) =>
      sql.startsWith('SELECT COUNT') ? [{ total: 3 }] : [persisted]);
    const transaction = jest.fn(async (isolation: string, work: (manager: { query: typeof query }) => Promise<unknown>) => {
      expect(isolation).toBe('REPEATABLE READ');
      return work({ query });
    });
    const store = new LoanRefinancingTypeormStore({ transaction } as unknown as DataSource,
      new LoanFinancialTotalsTypeormReader(), {} as never);
    const filters: RefinancingListQuery = { search: 'aNa', customerId, dateFrom: '2026-10-02',
      dateTo: '2026-10-02', page: 2, pageSize: 10 };
    expect(await store.list(filters)).toEqual({ items: [persisted], total: 3 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    const [[countSql, countParams], [pageSql, pageParams]] = query.mock.calls;
    expect(countParams).toEqual(['%aNa%', customerId, '2026-10-02', '2026-10-02']);
    expect(pageParams).toEqual([...countParams, 10, 10]);
    for (const sql of [countSql, pageSql]) {
      expect(sql).toContain('FROM loan_refinancings r');
      expect(sql).toContain('JOIN loans origin ON origin.id = r.origin_loan_id');
      expect(sql).toContain('JOIN loans successor ON successor.id = r.new_loan_id');
      expect(sql).toContain('JOIN customers c ON c.id = successor.customer_id');
      expect(sql).toContain('origin.loan_number::text ILIKE $1');
      expect(sql).toContain('successor.loan_number::text ILIKE $1');
      expect(sql).toContain('c.identification ILIKE $1');
      expect(sql).toContain("concat_ws(' ',c.first_name,c.middle_name,c.first_last_name,c.second_last_name) ILIKE $1");
      expect(sql).toContain('c.id = $2');
      expect(sql).toContain('r.refinancing_date >= $3::date');
      expect(sql).toContain('r.refinancing_date <= $4::date');
      expect(sql).not.toMatch(/FROM payments|JOIN payments|payment_plan_entries|WITH RECURSIVE/);
    }
    expect(pageSql).toContain('ORDER BY r.refinancing_date DESC, r.id DESC');
    expect(pageSql).toContain('LIMIT $5 OFFSET $6');
    for (const [column, property] of [
      ['outstanding_principal_transferred', 'outstandingPrincipalTransferred'],
      ['capitalized_outstanding_interest', 'capitalizedOutstandingInterest'],
      ['new_money_disbursed', 'newMoneyDisbursed'],
      ['new_contractual_principal', 'newContractualPrincipal'],
      ['new_interest_amount', 'newInterestAmount'],
      ['new_contractual_total', 'newContractualTotal'],
    ]) expect(pageSql).toContain(`r.${column}::text AS "${property}"`);
    expect(pageSql).not.toMatch(/successor\.(principal|interest_amount|total_amount)/);
  });

  it('does not reconstruct historical money from the successor after its balance changes', async () => {
    const operation = item(10);
    const successor = { principal: '200000.00', totalAmount: '240000.00', paidAmount: '0.00' };
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT COUNT')) return [{ total: 1 }];
      return [{ ...operation,
        outstandingPrincipalTransferred: sql.includes('r.outstanding_principal_transferred::text') ?
          operation.outstandingPrincipalTransferred : successor.principal,
        newContractualTotal: sql.includes('r.new_contractual_total::text') ?
          operation.newContractualTotal : successor.totalAmount }];
    });
    const source = { transaction: async (_isolation: string, work: (manager: { query: typeof query }) => Promise<unknown>) =>
      work({ query }) } as unknown as DataSource;
    const store = new LoanRefinancingTypeormStore(source, new LoanFinancialTotalsTypeormReader(), {} as never);
    const before = await store.list({ page: 1, pageSize: 20 });
    successor.paidAmount = '150000.00'; successor.principal = '999.00'; successor.totalAmount = '999.00';
    const after = await store.list({ page: 1, pageSize: 20 });
    expect(after.items[0]).toEqual(before.items[0]);
    expect(after.items[0]).toMatchObject({ outstandingPrincipalTransferred: '120000.00',
      capitalizedOutstandingInterest: '30000.00', newMoneyDisbursed: '50000.00',
      newContractualPrincipal: '200000.00', newInterestAmount: '40000.00', newContractualTotal: '240000.00' });
    expect(query).toHaveBeenCalledTimes(4);
  });
});
