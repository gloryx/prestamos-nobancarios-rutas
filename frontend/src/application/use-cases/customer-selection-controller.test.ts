import { describe, expect, it, vi } from 'vitest';
import type { CustomerListResult } from '../ports/customer.repository';
import { CustomerSelectionController, type CustomerSelectionPort } from './customer-selection-controller';

const historicalCustomer = {
  id: 'historical-customer', identification: '1-1111-1111', fullName: 'Cliente Histórico',
  primaryPhone: '8888-1111', address: 'San José', isActive: false,
};
const result = (page = 1): CustomerListResult => ({
  items: [historicalCustomer], total: 21, page, pageSize: 10, totalPages: 3,
});

function setup() {
  const port: CustomerSelectionPort = { list: vi.fn(async (query) => result(query.page)) };
  return { port, controller: new CustomerSelectionController(port) };
}

describe('CustomerSelectionController', () => {
  it('uses the historical customer endpoint contract without requiring an active loan', async () => {
    const { port, controller } = setup();
    await controller.load();
    expect(port.list).toHaveBeenCalledExactlyOnceWith({
      search: '', status: 'ALL', page: 1, pageSize: 10, sortBy: 'name', sortOrder: 'asc',
    });
    expect(controller.getSnapshot()).toMatchObject({ loading: false, data: { items: [historicalCustomer], total: 21 } });
  });

  it('sends search to the server, returns to page one and removes rows from the previous query', async () => {
    const { port, controller } = setup();
    controller.setPage(3);
    await controller.load();
    controller.setSearch('  Ana  ');
    expect(controller.getSnapshot()).toMatchObject({ page: 1, data: null, loading: true });
    await controller.load();
    expect(port.list).toHaveBeenLastCalledWith({
      search: 'Ana', status: 'ALL', page: 1, pageSize: 10, sortBy: 'name', sortOrder: 'asc',
    });
  });

  it('paginates through server requests and does not retain rows while the next page loads', async () => {
    const { port, controller } = setup();
    await controller.load();
    controller.setPage(2);
    expect(controller.getSnapshot()).toMatchObject({ page: 2, data: null, loading: true });
    await controller.load();
    expect(port.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 10 }));
    expect(controller.getSnapshot().data?.page).toBe(2);
  });

  it('discards an obsolete response after search changes', async () => {
    const { port, controller } = setup();
    let resolve!: (value: CustomerListResult) => void;
    vi.mocked(port.list).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = controller.load();
    controller.setSearch('nuevo');
    resolve(result());
    await pending;
    expect(controller.getSnapshot()).toMatchObject({ search: 'nuevo', data: null, loading: true });
  });

  it('exposes loading and error states and supports retry', async () => {
    const { port, controller } = setup();
    vi.mocked(port.list).mockRejectedValueOnce(new TypeError('network'));
    const pending = controller.load();
    expect(controller.getSnapshot()).toMatchObject({ loading: true, data: null, error: null });
    await pending;
    expect(controller.getSnapshot()).toMatchObject({ loading: false, data: null, error: expect.any(TypeError) });
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ loading: false, error: null, data: { total: 21 } });
  });
});
