import 'reflect-metadata';
import { CollectorSettlementController } from '../src/presentation/collector-settlement/collector-settlement.controller';
import { CollectorCustodyController } from '../src/presentation/collector-custody/collector-custody.controller';
import { CollectorSettlementConflictError } from '../src/domain/collector-settlement/collector-settlement.errors';
import { CollectorCustodyValidationError } from '../src/domain/collector-custody/collector-custody.errors';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

describe('Stage 3A HTTP boundaries', () => {
  it('publishes dynamic self scope and authoritative global action permissions', () => {
    const settlements = CollectorSettlementController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, settlements.create)).toEqual([]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, settlements.mine)).toEqual([]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, settlements.eligible)).toEqual([]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, settlements.list)).toEqual(['collector-settlements.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, settlements.review)).toEqual(['collector-settlements.review']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, settlements.confirm)).toEqual(['collector-settlements.confirm']);
    const custody = CollectorCustodyController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, custody.remit)).toEqual([]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, custody.topup)).toEqual(['collector-custody.topup']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, custody.adjustment)).toEqual(['collector-custody.adjust']);
  });

  it('maps settlement conflicts and custody validation to the standard structured envelope', async () => {
    const settlements = new CollectorSettlementController({} as never, {} as never, {} as never, {} as never, {} as never,
      { execute: jest.fn().mockRejectedValue(new CollectorSettlementConflictError('Closed', 'CLOSED_FINANCIAL_PERIOD')) } as never);
    await expect(settlements.confirm('id', {} as never, {} as never)).rejects.toMatchObject({ status: 409,
      response: { errorCode: 'RESOURCE_STATE_CONFLICT', reasonCode: 'CLOSED_FINANCIAL_PERIOD' } });
    const custody = new CollectorCustodyController({} as never,
      { execute: jest.fn().mockRejectedValue(new CollectorCustodyValidationError('Invalid', 'MOVEMENT_INVALID', 'amount')) } as never);
    await expect(custody.remit({} as never, {} as never)).rejects.toMatchObject({ status: 400,
      response: { errorCode: 'VALIDATION_FAILED', reasonCode: 'MOVEMENT_INVALID', data: { fields: [{ field: 'amount' }] } } });
  });
});
