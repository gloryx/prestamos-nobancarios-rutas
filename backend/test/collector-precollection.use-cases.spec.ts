import type { CurrentIdentity } from '../src/domain/security/security.types';
import { CollectorPrecollectionForbiddenError, CollectorPrecollectionValidationError } from '../src/domain/collector-precollection/collector-precollection.errors';
import type { CollectorPrecollectionStore } from '../src/application/collector-precollection/collector-precollection.ports';
import {
  CancelCollectorPrecollectionUseCase,
  CreateCollectorPrecollectionUseCase,
  GetCollectorPrecollectionDetailUseCase,
  ListMyCollectorPrecollectionsUseCase,
} from '../src/application/collector-precollection/collector-precollection.use-cases';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const actor = (permissions: string[] = [], superAdmin = false): CurrentIdentity => ({ id: uuid(1), username: 'collector',
  fullName: 'Collector', role: { id: uuid(2), code: 'COLLECTOR', name: 'Collector', isSuperAdmin: superAdmin },
  permissions, sessionId: uuid(3) });
const detail = { id: uuid(9), collectorUserId: uuid(1), amount: '10.00', status: 'RECORDED' } as never;

function store(): jest.Mocked<CollectorPrecollectionStore> {
  return { create: jest.fn().mockResolvedValue(detail), list: jest.fn().mockResolvedValue({ items: [], total: 0,
    page: 1, pageSize: 20, totalPages: 0, indicators: { count: 0, total: '0.00', cash: '0.00', electronic: '0.00', pending: '0.00', cancelled: '0.00' } }),
  detail: jest.fn().mockResolvedValue(detail), cancel: jest.fn().mockResolvedValue(detail) };
}

describe('collector precollection application rules', () => {
  const clock = { today: () => '2026-10-12' };
  const input = { customerId: uuid(4), loanId: uuid(5), paymentMethodId: uuid(6), custodyTreatment: 'COLLECTOR_HELD' as const, amount: '10',
    effectiveDate: '2026-10-12', reference: '  ABC-1  ', idempotencyKey: ' create-1 ' };

  it('normalizes a create command and derives collector ownership only from the actor', async () => {
    const persistence = store();
    await new CreateCollectorPrecollectionUseCase(persistence, clock).execute(input, actor(['collector-precollections.create']));
    expect(persistence.create).toHaveBeenCalledWith(expect.objectContaining({ amount: '10.00', reference: 'ABC-1',
      idempotencyKey: 'create-1' }), uuid(1), expect.any(String));
    expect(persistence.create.mock.calls[0][0]).not.toHaveProperty('collectorId');
  });

  it('normalizes optional notes and includes them in idempotent capture identity', async () => {
    const persistence = store();
    await new CreateCollectorPrecollectionUseCase(persistence, clock).execute({ ...input, notes: '  Door receipt  ' }, actor());
    expect(persistence.create).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Door receipt' }), uuid(1),
      expect.stringContaining('Door receipt'));
  });

  it('rejects new precollections received directly by the company', () => {
    const persistence = store();
    expect(() => new CreateCollectorPrecollectionUseCase(persistence, clock).execute({
      ...input, custodyTreatment: 'COMPANY_RECEIVED',
    }, actor())).toThrow(expect.objectContaining({ reasonCode: 'CUSTODY_TREATMENT_INVALID', field: 'custodyTreatment' }));
    expect(persistence.create).not.toHaveBeenCalled();
  });

  it.each(['2026-02-30', '2026/10/12', '2026-10-13'])('rejects invalid or future effective date %s', async (effectiveDate) => {
    const persistence = store();
    expect(() => new CreateCollectorPrecollectionUseCase(persistence, clock).execute({ ...input, effectiveDate }, actor()))
      .toThrow(expect.objectContaining({ reasonCode: 'EFFECTIVE_DATE_INVALID', field: 'effectiveDate' }));
    expect(persistence.create).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '1.001', '10000000000000000.00'])('rejects non-positive or out-of-range amount %s', async (amount) => {
    expect(() => new CreateCollectorPrecollectionUseCase(store(), clock).execute({ ...input, amount }, actor()))
      .toThrow(CollectorPrecollectionValidationError);
  });

  it('defaults mine to Costa Rica today, rejects future dates, and preserves deterministic defaults', async () => {
    const persistence = store();
    const useCase = new ListMyCollectorPrecollectionsUseCase(persistence, clock);
    await useCase.execute({}, actor());
    expect(persistence.list).toHaveBeenCalledWith(expect.objectContaining({ fromDate: '2026-10-12', toDate: '2026-10-12', page: 1,
      pageSize: 20, sortBy: 'effectiveDate', sortDir: 'asc' }), uuid(1));
    await expect(useCase.execute({}, actor())).resolves.toMatchObject({ navigation: {
      selectedDate: '2026-10-12', today: '2026-10-12', previousDate: '2026-10-11', nextDate: null } });
    await expect(useCase.execute({ date: '2026-10-13' }, actor()))
      .rejects.toMatchObject({ reasonCode: 'QUERY_DATE_INVALID' });
  });

  it('supports compact server-side period and administrative scope filters', async () => {
    const persistence = store();
    const useCase = new ListMyCollectorPrecollectionsUseCase(persistence, clock);
    await useCase.execute({ fromDate: '2026-10-01', toDate: '2026-10-12', collectorId: uuid(7), routeId: uuid(8),
      page: 2, pageSize: 10 }, actor());
    expect(persistence.list).toHaveBeenCalledWith(expect.objectContaining({ fromDate: '2026-10-01', toDate: '2026-10-12',
      collectorId: uuid(7), routeId: uuid(8), page: 2, pageSize: 10 }), uuid(1));
    await expect(useCase.execute({ date: '2026-10-10', fromDate: '2026-10-01' }, actor())).rejects
      .toMatchObject({ reasonCode: 'QUERY_DATE_RANGE_CONFLICT' });
  });

  it('scopes detail to the actor unless global view or superadmin access applies', async () => {
    const persistence = store();
    const useCase = new GetCollectorPrecollectionDetailUseCase(persistence);
    await useCase.execute(uuid(9), actor(['collector-precollections.assigned.view']));
    expect(persistence.detail).toHaveBeenLastCalledWith(uuid(9), uuid(1));
    await useCase.execute(uuid(9), actor(['collector-precollections.view']));
    expect(persistence.detail).toHaveBeenLastCalledWith(uuid(9), undefined);
    await useCase.execute(uuid(9), actor([], true));
    expect(persistence.detail).toHaveBeenLastCalledWith(uuid(9), undefined);
  });

  it('rejects receipt detail access without assigned or global view permission', async () => {
    const persistence = store();
    await expect(new GetCollectorPrecollectionDetailUseCase(persistence).execute(uuid(9), actor()))
      .rejects.toBeInstanceOf(CollectorPrecollectionForbiddenError);
    expect(persistence.detail).not.toHaveBeenCalled();
  });

  it('normalizes cancellation audit data and grants global scope only with global view', async () => {
    const persistence = store();
    const useCase = new CancelCollectorPrecollectionUseCase(persistence);
    await useCase.execute(uuid(9), '  Duplicate capture  ', ' cancel-1 ', actor());
    expect(persistence.cancel).toHaveBeenLastCalledWith(uuid(9), 'Duplicate capture', 'cancel-1', expect.any(String), uuid(1), false);
    await useCase.execute(uuid(9), 'Duplicate capture', 'cancel-2', actor(['collector-precollections.view']));
    expect(persistence.cancel).toHaveBeenLastCalledWith(uuid(9), 'Duplicate capture', 'cancel-2', expect.any(String), uuid(1), true);
  });
});
