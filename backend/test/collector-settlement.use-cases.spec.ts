import type { CurrentIdentity } from '../src/domain/security/security.types';
import type { CollectorSettlementStore } from '../src/application/collector-settlement/collector-settlement.ports';
import { ConfirmCollectorSettlementUseCase, CreateCollectorSettlementUseCase, GetCollectorSettlementUseCase,
  ListEligibleCollectorPrecollectionsUseCase, TransitionCollectorSettlementUseCase } from '../src/application/collector-settlement/collector-settlement.use-cases';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const identity = (permissions: string[] = [], superAdmin = false): CurrentIdentity => ({ id: uuid(1), username: 'user', fullName: 'User',
  role: { id: uuid(2), code: 'COLLECTOR', name: 'Collector', isSuperAdmin: superAdmin }, permissions, sessionId: uuid(3) });
const result = { id: uuid(9), status: 'DRAFT', items: [] } as never;
const store = (): jest.Mocked<CollectorSettlementStore> => ({ create: jest.fn().mockResolvedValue(result), list: jest.fn().mockResolvedValue([]),
  eligible: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0,
    summary: { availableCount: 0, availableAmount: '0.00', draftReservedCount: 0, draftReservedAmount: '0.00',
      submittedOrUnderReviewCount: 0, submittedOrUnderReviewAmount: '0.00' } }),
  detail: jest.fn().mockResolvedValue(result), transition: jest.fn().mockResolvedValue(result), confirm: jest.fn().mockResolvedValue(result) });

describe('collector settlement application rules', () => {
  it('derives self collector scope and creates a deterministic sorted command', async () => {
    const persistence = store();
    await new CreateCollectorSettlementUseCase(persistence).execute({ precollectionIds: [uuid(5), uuid(4)], idempotencyKey: ' key ' },
      identity(['collector-settlements.self.create']));
    expect(persistence.create).toHaveBeenCalledWith({ precollectionIds: [uuid(4), uuid(5)], idempotencyKey: 'key' }, uuid(1), false, expect.any(String));
  });

  it('requires global permission when a target collector is supplied and honors superadmin centrally', async () => {
    const persistence = store();
    const command = { collectorId: uuid(8), precollectionIds: [uuid(4)], idempotencyKey: 'key' };
    expect(() => new CreateCollectorSettlementUseCase(persistence).execute(command, identity(['collector-settlements.self.create'])))
      .toThrow('Solo puedes crear liquidaciones propias.');
    await new CreateCollectorSettlementUseCase(persistence).execute(command, identity([], true));
    expect(persistence.create).toHaveBeenCalledWith(expect.any(Object), uuid(1), true, expect.any(String));
  });

  it('scopes detail and lifecycle actions without role-name comparisons', async () => {
    const persistence = store();
    await new GetCollectorSettlementUseCase(persistence).execute(uuid(9), identity(['collector-settlements.self.view']));
    expect(persistence.detail).toHaveBeenCalledWith(uuid(9), uuid(1));
    await new TransitionCollectorSettlementUseCase(persistence).execute(uuid(9), 'cancel',
      { reason: ' Duplicate ', idempotencyKey: ' cancel ' }, identity(['collector-settlements.self.cancel']));
    expect(persistence.transition).toHaveBeenCalledWith(uuid(9), 'cancel', 'Duplicate', 'cancel', expect.any(String), uuid(1), false);
  });

  it('scopes paginated eligibility to the authenticated collector and honors superadmin', async () => {
    const persistence = store();
    const useCase = new ListEligibleCollectorPrecollectionsUseCase(persistence);
    await useCase.execute({ page: 2, pageSize: 20 }, identity(['collector-settlements.self.view']));
    await useCase.execute({ page: 1, pageSize: 50 }, identity([], true));
    expect(persistence.eligible).toHaveBeenNthCalledWith(1, uuid(1), { page: 2, pageSize: 20 });
    expect(persistence.eligible).toHaveBeenNthCalledWith(2, uuid(1), { page: 1, pageSize: 50 });
    expect(() => useCase.execute({ page: 1, pageSize: 20 }, identity())).toThrow('No tienes permiso');
    expect(() => useCase.execute({ page: 1, pageSize: 100 }, identity([], true))).toThrow('La paginación no es válida');
  });

  it('normalizes a partial delivery and requires its explicit method', async () => {
    const persistence = store();
    const useCase = new ConfirmCollectorSettlementUseCase(persistence, { today: () => '2026-10-12' });
    const actor = identity(['collector-settlements.confirm']);
    expect(() => useCase.execute(uuid(9), { amountDelivered: '5', deliveryDate: '2026-10-12', deliveryPaymentMethodId: null,
      deliveryReference: null, deliveryNotes: null, idempotencyKey: 'confirm' }, actor)).toThrow('Selecciona la forma de entrega');
    await useCase.execute(uuid(9), { amountDelivered: '5', deliveryDate: '2026-10-12', deliveryPaymentMethodId: uuid(7),
      deliveryReference: ' ref ', deliveryNotes: ' notes ', idempotencyKey: ' confirm ' }, actor);
    expect(persistence.confirm).toHaveBeenCalledWith(uuid(9), expect.objectContaining({ amountDelivered: '5.00',
      deliveryReference: 'ref', deliveryNotes: 'notes', idempotencyKey: 'confirm' }), expect.any(String), uuid(1));
  });

  it.each(['2026-02-30', '2026-10-13'])('rejects invalid or future delivery date %s', (deliveryDate) => {
    const persistence = store();
    const useCase = new ConfirmCollectorSettlementUseCase(persistence, { today: () => '2026-10-12' });
    expect(() => useCase.execute(uuid(9), { amountDelivered: '0', deliveryDate, deliveryPaymentMethodId: null,
      deliveryReference: null, deliveryNotes: null, idempotencyKey: 'confirm' }, identity(['collector-settlements.confirm'])))
      .toThrow('El monto o la fecha de entrega no son válidos.');
    expect(persistence.confirm).not.toHaveBeenCalled();
  });
});
