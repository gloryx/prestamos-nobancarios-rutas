import type { CurrentIdentity } from '../src/domain/security/security.types';
import type { CollectorCustodyStore } from '../src/application/collector-custody/collector-custody.ports';
import { RecordCollectorCustodyUseCase, ViewCollectorCustodyUseCase } from '../src/application/collector-custody/collector-custody.use-cases';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const actor = (permissions: string[] = [], superAdmin = false): CurrentIdentity => ({ id: uuid(1), username: 'u', fullName: 'U',
  role: { id: uuid(2), code: 'ANY', name: 'Any', isSuperAdmin: superAdmin }, permissions, sessionId: uuid(3) });
const store = (): jest.Mocked<CollectorCustodyStore> => ({ summary: jest.fn().mockResolvedValue({}), history: jest.fn().mockResolvedValue([]),
  record: jest.fn().mockResolvedValue({}) });
const command = { amount: '10', effectiveDate: '2026-10-12', paymentMethodId: uuid(4), reference: ' REF ', reason: ' Reason ', idempotencyKey: ' key ' };

describe('collector custody application rules', () => {
  it('keeps self and global reads centrally scoped', async () => {
    const persistence = store();
    await new ViewCollectorCustodyUseCase(persistence).summary(undefined, actor(['collector-custody.self.view']));
    expect(persistence.summary).toHaveBeenCalledWith(uuid(1), undefined, false);
    await new ViewCollectorCustodyUseCase(persistence).history(uuid(8), actor([], true));
    expect(persistence.history).toHaveBeenCalledWith(uuid(1), uuid(8), true);
  });

  it('allows an own remittance but reserves top-ups and adjustments for global permissions', async () => {
    const persistence = store();
    const useCase = new RecordCollectorCustodyUseCase(persistence, { today: () => '2026-10-12' });
    await useCase.execute('remittance', command, actor(['collector-custody.self.remit']));
    expect(persistence.record).toHaveBeenCalledWith('remittance', expect.objectContaining({ amount: '10.00', reference: 'REF', reason: 'Reason' }), expect.any(String), uuid(1), false);
    expect(() => useCase.execute('topup', command, actor(['collector-custody.self.remit']))).toThrow('No tienes permiso');
    await useCase.execute('adjustment', { ...command, direction: 'DEBIT' }, actor(['collector-custody.adjust']));
    expect(persistence.record).toHaveBeenLastCalledWith('adjustment', expect.objectContaining({ direction: 'DEBIT' }), expect.any(String), uuid(1), true);
  });

  it.each(['2026-02-30', '2026-10-13'])('rejects invalid or future effective date %s before persistence', (effectiveDate) => {
    const persistence = store();
    const useCase = new RecordCollectorCustodyUseCase(persistence, { today: () => '2026-10-12' });
    expect(() => useCase.execute('remittance', { ...command, effectiveDate }, actor(['collector-custody.self.remit'])))
      .toThrow('Revisa el monto, la fecha y la forma de pago.');
    expect(persistence.record).not.toHaveBeenCalled();
  });

  it('rejects every zero representation before persistence', () => {
    const persistence = store();
    const useCase = new RecordCollectorCustodyUseCase(persistence, { today: () => '2026-10-12' });
    for (const amount of ['0', '0.0', '0.00']) expect(() => useCase.execute('remittance', { ...command, amount },
      actor(['collector-custody.self.remit']))).toThrow('Revisa el monto, la fecha y la forma de pago.');
    expect(persistence.record).not.toHaveBeenCalled();
  });
});
