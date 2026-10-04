import { describe, expect, it, vi } from 'vitest';
import type { LoanRefinancingChains, RefinancingCustomerLookup } from '../ports/loan-refinancing.repository';
import type { CustomerRefinancingChains, RefinancingChain } from '../../domain/entities/loan-refinancing';
import { RefinancingChainController } from './refinancing-chain-controller';

const chain = (id: string) => ({ rootLoanId: id } as RefinancingChain);
const customerChains = (id: string) => ({ customer: { id }, chains: [] } as unknown as CustomerRefinancingChains);
const lookup: RefinancingCustomerLookup = { search: vi.fn(async () => ({ items: [], total: 0 })) };

describe('refinancing chain controller', () => {
  it('accepts root, intermediate and terminal loan identifiers without changing the backend chain order', async () => {
    const complete = { rootLoanId: 'root', loans: [{ loanId: 'root' }, { loanId: 'middle' }, { loanId: 'terminal' }] } as RefinancingChain;
    const repository: LoanRefinancingChains = { byLoan: vi.fn(async () => complete), byCustomer: vi.fn() };
    const controller = new RefinancingChainController(repository, lookup);
    for (const id of ['root', 'middle', 'terminal']) {
      await controller.loadLoan(id);
      expect(controller.getSnapshot().chain?.loans.map((loan) => loan.loanId)).toEqual(['root', 'middle', 'terminal']);
    }
    expect(repository.byLoan).toHaveBeenNthCalledWith(1, 'root');
    expect(repository.byLoan).toHaveBeenNthCalledWith(2, 'middle');
    expect(repository.byLoan).toHaveBeenNthCalledWith(3, 'terminal');
  });

  it('clears stale data immediately and ignores an older loan response', async () => {
    let resolveFirst!: (value: RefinancingChain) => void;
    const first = new Promise<RefinancingChain>((resolve) => { resolveFirst = resolve; });
    const repository: LoanRefinancingChains = {
      byLoan: vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(chain('terminal')),
      byCustomer: vi.fn(),
    };
    const controller = new RefinancingChainController(repository, lookup);
    const older = controller.loadLoan('root');
    const current = controller.loadLoan('terminal');
    expect(controller.getSnapshot()).toMatchObject({ chain: null, loading: true, error: null });
    await current;
    resolveFirst(chain('root'));
    await older;
    expect(controller.getSnapshot()).toMatchObject({ chain: { rootLoanId: 'terminal' }, loading: false, error: null });
    expect(repository.byLoan).toHaveBeenCalledTimes(2);
  });

  it('loads a selected customer once, clears it without a request and protects lookup races', async () => {
    const repository: LoanRefinancingChains = { byLoan: vi.fn(), byCustomer: vi.fn(async (id) => customerChains(id)) };
    const customerLookup: RefinancingCustomerLookup = { search: vi.fn(async ({ search }) => ({
      items: [{ id: search, fullName: search, identification: search }], total: 1,
    })) };
    const controller = new RefinancingChainController(repository, customerLookup);
    controller.selectCustomer({ id: 'customer-1', fullName: 'Customer', identification: '1' });
    expect(controller.getSnapshot()).toMatchObject({ customerChains: null, loading: true });
    await controller.loadCustomer('customer-1');
    expect(controller.getSnapshot().customerChains?.customer.id).toBe('customer-1');
    controller.selectCustomer(null);
    expect(controller.getSnapshot()).toMatchObject({ selectedCustomer: null, customerChains: null, loading: false });
    expect(repository.byCustomer).toHaveBeenCalledOnce();
    controller.openCustomerSearch();
    controller.setCustomerSearch('Ana');
    await controller.loadCustomers();
    expect(controller.getSnapshot().customers?.items[0].id).toBe('Ana');
  });

  it('stores controlled failures without retaining the previous chain', async () => {
    const repository: LoanRefinancingChains = {
      byLoan: vi.fn().mockResolvedValueOnce(chain('root')).mockRejectedValueOnce(new Error('failed')),
      byCustomer: vi.fn(),
    };
    const controller = new RefinancingChainController(repository, lookup);
    await controller.loadLoan('root');
    await controller.loadLoan('other');
    expect(controller.getSnapshot()).toMatchObject({ chain: null, loading: false, error: expect.any(Error) });
  });
});
