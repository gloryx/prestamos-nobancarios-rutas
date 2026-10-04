import { describe, expect, it, vi } from 'vitest';
import type { LoanRefinancingList, RefinancingCustomerLookup } from '../ports/loan-refinancing.repository';
import type { RefinancingListResult } from '../../domain/entities/loan-refinancing';
import { RefinancingListController } from './refinancing-list-controller';

const result: RefinancingListResult = { items: [], total: 21, page: 1, pageSize: 20, totalPages: 2 };
const customer = { id: 'customer-1', fullName: 'TEST REFINANCING CUSTOMER', identification: 'TEST-101' };
function setup() {
  const repository: LoanRefinancingList = { list: vi.fn(async (query) => ({ ...result, page: query.page, pageSize: query.pageSize })) };
  const customers: RefinancingCustomerLookup = { search: vi.fn(async () => ({ items: [customer], total: 1 })) };
  const controller = new RefinancingListController(repository, customers);
  return { controller, repository, customers };
}

describe('refinancing operations list controller', () => {
  it('loads a first page once with server defaults and keeps the backend total', async () => {
    const { controller, repository } = setup();
    await controller.load();
    expect(repository.list).toHaveBeenCalledExactlyOnceWith({ page: 1, pageSize: 20, search: '' });
    expect(controller.getSnapshot()).toMatchObject({ page: 1, pageSize: 20, loading: false,
      data: { total: 21, totalPages: 2 } });
  });

  it('resets the page for search, customer, dates and page size and sends all combined filters', async () => {
    const { controller, repository } = setup();
    controller.setPage(3);
    controller.setFilter('search', '  #101  ');
    expect(controller.getSnapshot().page).toBe(1);
    await controller.load();
    expect(repository.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, search: '#101' });
    controller.setPage(2);
    controller.selectCustomer(customer);
    expect(controller.getSnapshot().page).toBe(1);
    controller.setFilter('dateFrom', '2026-10-01');
    controller.setFilter('dateTo', '2026-10-02');
    await controller.load();
    expect(repository.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, search: '#101',
      customerId: 'customer-1', dateFrom: '2026-10-01', dateTo: '2026-10-02' });
    controller.setPage(2);
    await controller.load();
    expect(repository.list).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, search: '#101',
      customerId: 'customer-1', dateFrom: '2026-10-01', dateTo: '2026-10-02' });
    for (const size of [10, 20, 50] as const) {
      controller.setPageSize(size);
      expect(controller.getSnapshot().page).toBe(1);
      await controller.load();
      expect(repository.list).toHaveBeenLastCalledWith({ page: 1, pageSize: size, search: '#101',
        customerId: 'customer-1', dateFrom: '2026-10-01', dateTo: '2026-10-02' });
    }
    controller.selectCustomer(null);
    await controller.load();
    expect(repository.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 50, search: '#101',
      dateFrom: '2026-10-01', dateTo: '2026-10-02' });
  });

  it('suppresses a reversed date range without sending an invalid request and recovers when corrected', async () => {
    const { controller, repository } = setup();
    controller.setFilter('dateFrom', '2026-10-03');
    controller.setFilter('dateTo', '2026-10-02');
    expect(controller.invalidDateRange).toBe(true);
    await controller.load();
    expect(repository.list).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ data: null, loading: false });
    controller.setFilter('dateTo', '2026-10-03');
    await controller.load();
    expect(repository.list).toHaveBeenCalledWith({ page: 1, pageSize: 20, search: '',
      dateFrom: '2026-10-03', dateTo: '2026-10-03' });
  });

  it('drops stale list responses and never shows old rows while filters are loading', async () => {
    const { controller, repository } = setup();
    let resolve!: (value: RefinancingListResult) => void;
    vi.mocked(repository.list).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = controller.load();
    expect(controller.getSnapshot()).toMatchObject({ loading: true, data: null });
    controller.setFilter('search', 'new');
    resolve({ ...result, items: [{ refinancingId: 'stale' } as never] });
    await pending;
    expect(controller.getSnapshot()).toMatchObject({ loading: true, data: null });
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ loading: false, data: { total: 21 } });
    controller.setPage(2);
    expect(controller.getSnapshot()).toMatchObject({ loading: true, data: null });
  });

  it('stores an error without exposing stale data and succeeds on explicit retry', async () => {
    const { controller, repository } = setup();
    vi.mocked(repository.list).mockRejectedValueOnce(new Error('private SQL'));
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ data: null, error: expect.any(Error), loading: false });
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ data: { total: 21 }, error: null });
  });

  it('searches customer options by pages, ignores old responses and clears selection', async () => {
    const { controller, customers } = setup();
    controller.openCustomerSearch();
    await controller.loadCustomers();
    expect(customers.search).toHaveBeenCalledWith({ search: '', page: 1 });
    controller.setCustomerPage(2);
    controller.setCustomerSearch(' Ana  ');
    expect(controller.getSnapshot().customerPage).toBe(1);
    await controller.loadCustomers();
    expect(customers.search).toHaveBeenLastCalledWith({ search: 'Ana', page: 1 });
    let resolve!: (value: { items: typeof customer[]; total: number }) => void;
    vi.mocked(customers.search).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = controller.loadCustomers();
    controller.closeCustomerSearch();
    resolve({ items: [customer], total: 1 }); await pending;
    expect(controller.getSnapshot().customers).toBeNull();
    controller.selectCustomer(customer);
    expect(controller.getSnapshot().selectedCustomer).toEqual(customer);
    controller.selectCustomer(null);
    expect(controller.getSnapshot().selectedCustomer).toBeNull();
  });

  it('keeps customer lookup failures separate from list failures', async () => {
    const { controller, customers } = setup();
    vi.mocked(customers.search).mockRejectedValueOnce(new TypeError('network'));
    await controller.loadCustomers();
    expect(controller.getSnapshot()).toMatchObject({ customerError: expect.any(TypeError), error: null,
      loadingCustomers: false, customers: null });
    await controller.loadCustomers();
    expect(controller.getSnapshot()).toMatchObject({ customerError: null, customers: { total: 1 } });
  });
});
