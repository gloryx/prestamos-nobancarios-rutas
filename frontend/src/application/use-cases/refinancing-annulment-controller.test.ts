import { describe, expect, it, vi } from 'vitest';
import type { LoanRefinancingAnnulments } from '../ports/loan-refinancing.repository';
import type { RefinancingAnnulmentCandidate } from '../../domain/entities/loan-refinancing';
import { RefinancingAnnulmentController } from './refinancing-annulment-controller';

const eligibility = { eligible: true, reasons: [], types: {
  DATA_CORRECTION: { eligible: true, requiresEffectiveDate: false, reasons: [] },
  CASH_REFUND: { eligible: true, requiresEffectiveDate: true, reasons: [] },
} };
const candidate: RefinancingAnnulmentCandidate = { refinancingId: 'ref-1', refinancingDate: '2026-10-01',
  originLoanId: 'origin-1', originLoanNumber: '100', successorLoanId: 'successor-1', successorLoanNumber: '101',
  customer: { id: 'customer-1', fullName: 'Ana Solís', identification: '1' },
  outstandingPrincipalTransferred: '80.00', capitalizedOutstandingInterest: '20.00', newMoneyDisbursed: '50.00',
  newContractualTotal: '150.00', eligibility };
const result = <T>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 20 as const, totalPages: items.length ? 1 : 0 });
const harness = (canAnnul = true) => {
  const api: LoanRefinancingAnnulments = { listAnnulled: vi.fn(async () => result([])),
    listCandidates: vi.fn(async () => result([candidate])), detail: vi.fn(),
    paymentMethods: vi.fn(async () => [{ id: 'cash', name: 'Efectivo' }]), annul: vi.fn() };
  return { api, controller: new RefinancingAnnulmentController(api, () => 'stable-key', () => canAnnul) };
};

describe('RefinancingAnnulmentController', () => {
  it('loads annulled by default and keeps candidate sorting server-side', async () => {
    const { api, controller } = harness();
    await controller.load();
    expect(api.listAnnulled).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'effectiveDate', sortDir: 'desc' }));
    controller.setActiveTab('CANDIDATES');
    await vi.waitFor(() => expect(api.listCandidates).toHaveBeenCalled());
    controller.sort('customer');
    await vi.waitFor(() => expect(api.listCandidates).toHaveBeenLastCalledWith(expect.objectContaining({
      sortBy: 'customer', sortDir: 'asc', page: 1,
    })));
    expect(api.paymentMethods).toHaveBeenCalledTimes(1);
  });

  it('requires permission and validated cash-refund facts, preserves one key and prevents double submission', async () => {
    const { api, controller } = harness();
    controller.setActiveTab('CANDIDATES');
    await vi.waitFor(() => expect(controller.getSnapshot().items).toHaveLength(1));
    expect(controller.begin(candidate)).toBe(true);
    controller.setType('CASH_REFUND'); controller.setEffectiveDate('2026-10-10');
    expect(await controller.validateEffectiveDate()).toBe(true);
    controller.setRefundPaymentMethod('cash'); controller.setResolutionConfirmed(true); controller.setReason('Devolución confirmada');
    let finish!: () => void;
    vi.mocked(api.annul).mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({} as never); }));
    const first = controller.submit(), second = controller.submit();
    expect(await second).toBe(false);
    expect(api.annul).toHaveBeenCalledTimes(1);
    expect(api.annul).toHaveBeenCalledWith('ref-1', { annulmentType: 'CASH_REFUND', effectiveDate: '2026-10-10',
      disbursementResolution: 'RETURNED_IN_FULL', refundPaymentMethodId: 'cash',
      reason: 'Devolución confirmada', idempotencyKey: 'stable-key' });
    finish(); expect(await first).toBe(true);
    expect(controller.getSnapshot().activeTab).toBe('ANNULLED');

    const denied = harness(false).controller;
    expect(denied.begin(candidate)).toBe(false);
  });

  it('refreshes eligibility after a conflict without leaking the backend message', async () => {
    const { api, controller } = harness();
    controller.setActiveTab('CANDIDATES');
    await vi.waitFor(() => expect(controller.getSnapshot().items).toHaveLength(1));
    controller.begin(candidate); controller.setType('DATA_CORRECTION'); controller.setResolutionConfirmed(true);
    controller.setReason('Corrección necesaria');
    vi.mocked(api.annul).mockRejectedValueOnce(Object.assign(new Error('SQL internals'), { status: 409 }));
    expect(await controller.submit()).toBe(false);
    expect(api.listCandidates).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().attempt?.error).toBe('La elegibilidad cambió mientras realizabas la operación. Revisa los datos actualizados.');
  });

  it('blocks a positive correction until non-delivery is confirmed and sends that exact resolution', async () => {
    const { api, controller } = harness();
    expect(controller.begin(candidate)).toBe(true);
    controller.setType('DATA_CORRECTION'); controller.setReason('Corrección necesaria');
    expect(await controller.submit()).toBe(false);
    expect(api.annul).not.toHaveBeenCalled();
    controller.setResolutionConfirmed(true);
    expect(await controller.submit()).toBe(true);
    expect(api.annul).toHaveBeenCalledWith('ref-1', expect.objectContaining({
      annulmentType: 'DATA_CORRECTION', disbursementResolution: 'NOT_DELIVERED',
    }));
  });
});
