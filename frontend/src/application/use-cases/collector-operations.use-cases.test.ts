import { describe, expect, it, vi } from 'vitest';
import type { CollectorCustodyRepository } from '../ports/collector-custody.repository';
import type { CollectorPrecollectionRepository } from '../ports/collector-precollection.repository';
import type { CollectorSettlementRepository } from '../ports/collector-settlement.repository';
import { CollectorCustodyService } from './collector-custody.use-cases';
import { CollectorPrecollectionService } from './collector-precollection.use-cases';
import { CollectorSettlementService } from './collector-settlement.use-cases';

describe('collector operation application services', () => {
  it('forward caller-owned idempotency keys unchanged and never generate replacements', async () => {
    const precollectionCancel = vi.fn().mockResolvedValue({});
    const settlementConfirm = vi.fn().mockResolvedValue({});
    const custodyAdjust = vi.fn().mockResolvedValue({});
    const precollections = new CollectorPrecollectionService({ cancel: precollectionCancel } as unknown as CollectorPrecollectionRepository);
    const settlements = new CollectorSettlementService({ confirm: settlementConfirm } as unknown as CollectorSettlementRepository);
    const custody = new CollectorCustodyService({ adjust: custodyAdjust } as unknown as CollectorCustodyRepository);

    const cancel = { reason: 'Duplicate', idempotencyKey: 'caller-cancel-key' };
    const confirm = { amountDelivered: '10.00', deliveryDate: '2026-10-12', deliveryPaymentMethodId: null,
      deliveryReference: null, deliveryNotes: null, idempotencyKey: 'caller-confirm-key' };
    const adjust = { amount: '5.00', effectiveDate: '2026-10-12', paymentMethodId: 'method', reference: 'reference',
      reason: 'Correction', direction: 'CREDIT' as const, idempotencyKey: 'caller-adjust-key' };
    await precollections.cancel('pre-1', cancel);
    await settlements.confirm('settlement-1', confirm);
    await custody.adjust(adjust);

    expect(precollectionCancel).toHaveBeenCalledWith('pre-1', cancel);
    expect(settlementConfirm).toHaveBeenCalledWith('settlement-1', confirm);
    expect(custodyAdjust).toHaveBeenCalledWith(adjust);
  });
});
