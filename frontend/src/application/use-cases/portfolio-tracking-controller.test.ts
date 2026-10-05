import { describe, expect, it, vi } from 'vitest';
import type { PortfolioTrackingRepository } from '../ports/portfolio-tracking.repository';
import type { PortfolioTrackingResult } from '../../domain/entities/portfolio-tracking';
import { PortfolioTrackingController } from './portfolio-tracking-controller';

const result = (position = 3, total = 7): PortfolioTrackingResult => ({
  position, total, hasPrevious: position > 1, hasNext: position < total,
  loan: { id: 'loan-1', status: 'ACTIVE', collectionStatus: 'OVERDUE', startDate: '2026-01-01', contractualDueDate: '2026-12-01',
    context: { summary: { loanId: 'loan-1', loanNumber: '9', status: 'ACTIVE', identification: '101', customerName: 'Ana', principal: '70.00', interestAmount: '30.00', totalAmount: '100.00' },
      balances: { outstandingPrincipal: '40.00', outstandingInterest: '20.00', financialBalance: '60.00' }, combinedPlan: [], validPayments: [], firstOperationalRow: null,
      lastValidPayment: null, refinanceEligibility: false, preferredMethod: { id: null, activeMethods: [], collectors: [] } }, },
});

describe('PortfolioTrackingController', () => {
  it('loads the first operational loan without filters', async () => {
    const locate = vi.fn().mockResolvedValue(result(1, 7));
    const controller = new PortfolioTrackingController({ locate });
    await controller.load();
    expect(locate).toHaveBeenCalledExactlyOnceWith({ search: '', status: 'ALL', collectionStatus: 'ALL', position: 1 });
  });

  it('loads server-side criteria and supports first, previous, next and last positions', async () => {
    const locate = vi.fn().mockImplementation(async ({ position }: { position: number }) => result(position, 7));
    const controller = new PortfolioTrackingController({ locate } as PortfolioTrackingRepository);
    controller.setFilter('search', ' María ');
    controller.setFilter('status', 'ACTIVE');
    controller.setFilter('collectionStatus', 'OVERDUE');
    await controller.load();
    expect(locate).toHaveBeenLastCalledWith({ search: 'María', status: 'ACTIVE', collectionStatus: 'OVERDUE', position: 1 });

    for (const position of [1, 2, 4, 7]) {
      controller.setPosition(position);
      await controller.load();
      expect(controller.getSnapshot().position).toBe(position);
    }
  });

  it.each([
    ['search', 'Ana'], ['status', 'UNCOLLECTIBLE'], ['collectionStatus', 'TERM_EXPIRED'],
  ] as const)('resets to the first position and clears stale data when %s changes', async (field, value) => {
    const controller = new PortfolioTrackingController({ locate: vi.fn().mockResolvedValue(result()) });
    await controller.load();
    controller.setPosition(5);
    await controller.load();
    expect(controller.getSnapshot().data?.loan).not.toBeNull();
    controller.setFilter(field, value);
    expect(controller.getSnapshot()).toMatchObject({ position: 1, data: null, loading: true, error: null,
      filters: { [field]: value } });
  });

  it('publishes the empty server response without retaining the previous loan or plan', async () => {
    const locate = vi.fn().mockResolvedValueOnce(result()).mockResolvedValueOnce({ position: 0, total: 0, hasPrevious: false, hasNext: false, loan: null });
    const controller = new PortfolioTrackingController({ locate });
    await controller.load();
    controller.setFilter('search', 'Nobody');
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ position: 1, loading: false,
      data: { position: 0, total: 0, hasPrevious: false, hasNext: false, loan: null } });
  });

  it('ignores a stale response after criteria change', async () => {
    let resolveFirst!: (value: PortfolioTrackingResult) => void;
    const locate = vi.fn().mockImplementationOnce(() => new Promise<PortfolioTrackingResult>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(result(1, 1));
    const controller = new PortfolioTrackingController({ locate });
    const first = controller.load();
    controller.setFilter('search', 'Ana');
    await controller.load();
    resolveFirst(result(3, 7));
    await first;
    expect(controller.getSnapshot().data).toMatchObject({ position: 1, total: 1 });
  });
});
